// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ASHEN PROTOCOL: 5v5 round-based tactical FPS — Ash (you + 4 bots) attacks
// with the charge, Cinder (5 bots) defends two sites. First to 5 rounds wins.
// ?shot=menu|combat|buy|end with &seed=N sets up a deterministic capture frame.
// ?soak=1 plays a full match with an autopilot and logs it to window.__soakLog.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITE_A, SITE_B, SPAWN_ASH, nearestNode, navRoute, NAV_NODES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createMatch, feedEvent, award, ROUND_SECONDS, FREEZE_SECONDS, WIN_ROUNDS, MAX_ROUNDS, PLANT_SECONDS, DEFUSE_SECONDS, DETONATE_SECONDS, ECONOMY } from './state.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const soak = params.get('soak') === '1';
const testKind = params.get('test'); // 'plant' | 'detonate' — scripted self-test, no combat
const testMode = testKind === 'plant' || testKind === 'detonate';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const match = createMatch();
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders, SPAWN_ASH);
const weapon = createWeapon(camera);
const bots = createBots(scene, world, random);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// Invisible box the bots raycast against to hit the player.
const playerMarker = new THREE.Mesh(
  new THREE.BoxGeometry(0.68, 1.72, 0.68),
  new THREE.MeshBasicMaterial({ visible: false }),
);
playerMarker.position.set(0, 0.86, 0);
scene.add(playerMarker);

const body = player.state;
const shootables = world.shootables;
const hitMeshes = bots.hitMeshes;
const direction = new THREE.Vector3();
const noise = [];
let elapsed = 0;
let started = false;
let frozen = false;
let roundEndAt = -1;
let bannerAt = -1;
let grenades = [];
let damageTaken = 0;
let keys = input.state.keys;
const autopilotKeys = new Set();

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  playerMarker.position.set(body.position.x, body.position.y + 0.86, body.position.z);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function losClear(from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  const dist = d.length();
  raycaster.set(from, d.normalize());
  raycaster.far = dist;
  return !raycaster.intersectObjects(shootables, false)[0];
}

function shoot(spread) {
  if (!weapon.takeRound()) { audio.dry(); return false; }
  const def = weapon.def();
  camera.getWorldDirection(direction);
  let hitBot = null;
  let hitPart = null;
  for (let p = 0; p < def.pellets; p += 1) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, dir);
    const hit = raycaster.intersectObjects(shootables.concat(hitMeshes), false)[0];
    if (hit && hit.object.userData.bot) {
      // No friendly fire: a teammate in the line of fire blocks the shot.
      if (hit.object.userData.bot.team === 'ash') break;
      hitBot = hit.object.userData.bot;
      hitPart = hit.object.userData.part;
    }
  }
  if (hitBot && hitBot.alive) {
    const died = bots.damage(hitBot, def.damage, hitPart, body.position);
    hud.hitMarker(died);
    if (died) {
      audio.kill();
      match.kills += 1;
      award(match, ECONOMY.kill, `kill ${hitBot.name}`);
      feedEvent(match, `YOU ▸ ${hitBot.name}${hitPart === 'head' ? ' (headshot)' : ''}`);
      if (match.charge === 'carrier' && hitBot.name === 'Vex') dropChargeToNextCarrier();
    } else {
      audio.hit();
    }
  }
  weapon.pullTrigger();
  audio.shot(def.kind);
  noise.push({ x: body.position.x, z: body.position.z, radius: 26 });
  player.recoil(def.kick * 0.35 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
  return true;
}

function dropChargeToNextCarrier() {
  const alive = bots.bots.filter((b) => b.team === 'cinder' && b.alive);
  if (!alive.length) { match.charge = 'gone'; return; }
  const carrier = alive[0];
  carrier.state = 'plant';
  match.plantSite = random() < 0.5 ? 'A' : 'B';
  feedEvent(match, `${carrier.name} picked up the charge`);
}

function throwGrenade() {
  if (weapon.state.grenades <= 0) return;
  weapon.state.grenades -= 1;
  camera.getWorldDirection(direction);
  grenades.push({
    pos: new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z),
    vel: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4, 0)),
    t: 0,
  });
  audio.reload();
}

function explodeGrenade(g) {
  audio.boom();
  noise.push({ x: g.pos.x, z: g.pos.z, radius: 32 });
  const victims = [];
  for (const b of bots.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.group.position.x - g.pos.x, b.group.position.z - g.pos.z);
    if (d < 7) {
      const dmg = Math.round(90 * (1 - d / 7) + 10);
      if (bots.damage(b, dmg, 'torso', g.pos)) {
        victims.push(b);
        feedEvent(match, `Grenade ▸ ${b.name}`);
        if (b.team === 'cinder') { match.kills += 1; award(match, ECONOMY.kill, `grenade ${b.name}`); }
      }
    }
  }
  const pd = Math.hypot(body.position.x - g.pos.x, body.position.z - g.pos.z);
  if (pd < 7 && body.health > 0) {
    const dmg = Math.round(70 * (1 - pd / 7) + 5);
    if (player.damage(dmg)) { match.deaths += 1; feedEvent(match, 'You were caught by a blast'); }
    hud.damageFlash();
    audio.hurt();
  }
  return victims;
}

function startRound() {
  match.phase = 'freeze';
  match.timer = FREEZE_SECONDS;
  match.plantProgress = 0;
  match.defuseProgress = 0;
  match.charge = 'player';
  match.plantSite = 'A';
  grenades = [];
  player.reset();
  weapon.refillAll();
  bots.reset();
  hud.setHealth(100, 0);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setMoney(match.money);
  hud.setScore(match.round, match.wins.ash, match.wins.cinder);
  hud.setProgress(null, 0);
  hud.setBanner(`ROUND ${match.round}`);
  bannerAt = elapsed + 2;
  if (!soak && !shot) hud.showBuy(match.money, weapon.owned, weapon.state.grenades);
  if (shot === 'buy') hud.showBuy(4000, weapon.owned, 1);
}

function endRound(winner, reason) {
  if (match.phase === 'roundEnd' || match.phase === 'over') return;
  match.wins[winner] += 1;
  const playerWon = winner === 'ash';
  award(match, playerWon ? ECONOMY.win : ECONOMY.loss, `round ${match.round} ${reason}`);
  if (reason === 'planted') award(match, ECONOMY.plant, 'plant bonus');
  feedEvent(match, `${playerWon ? 'ASH' : 'CINDER'} wins round ${match.round} — ${reason}`);
  hud.setScore(match.round, match.wins.ash, match.wins.cinder);
  hud.setBanner(playerWon ? 'ROUND WON' : 'ROUND LOST');
  bannerAt = elapsed + 2.5;
  if (playerWon) audio.roundWin(); else audio.roundLose();
  if (match.wins[winner] >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
    match.phase = 'over';
    match.matchWinner = match.wins.ash > match.wins.cinder ? 'ash' : 'cinder';
    hud.setBanner(match.matchWinner === 'ash' ? 'ASH WINS THE MATCH' : 'CINDER WINS THE MATCH');
    if (!soak && !shot) hud.showOverlay('end', `Final score ${match.wins.ash} — ${match.wins.cinder}. ${match.kills} eliminations, ${match.deaths} deaths.`);
    match.log.push(`MATCH ${match.matchWinner} ${match.wins.ash}-${match.wins.cinder}`);
  } else {
    match.phase = 'roundEnd';
    roundEndAt = elapsed + 3.5;
    if (!soak && !shot) hud.showOverlay('round', `Round ${match.round} goes to ${winner === 'ash' ? 'ASH' : 'CINDER'} (${reason}). Score ${match.wins.ash} — ${match.wins.cinder}.`);
  }
  world.chargeMesh.visible = false;
}

function restartMatch() {
  match.round = 1;
  match.wins.ash = 0;
  match.wins.cinder = 0;
  match.kills = 0;
  match.deaths = 0;
  match.money = ECONOMY.start;
  match.matchWinner = null;
  weapon.resetToPistol();
  startRound();
}

function onLockChange(locked) {
  if (shot || soak) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.hideBuy();
    audio.unlock();
  } else if (match.phase !== 'over' && match.phase !== 'roundEnd') {
    hud.showOverlay(started ? 'paused' : 'start', undefined);
  }
}

function buy(key) {
  if (match.phase !== 'freeze' && shot !== 'buy') return;
  if (key === 'grenade') {
    if (weapon.state.grenades < 2 && match.money >= GRENADE_PRICE) {
      match.money -= GRENADE_PRICE;
      weapon.state.grenades += 1;
      hud.setMoney(match.money);
      hud.showBuy(match.money, weapon.owned, weapon.state.grenades);
    }
    return;
  }
  if (key === 'armor') {
    if (match.money >= ARMOR_PRICE && body.armor < 50) {
      match.money -= ARMOR_PRICE;
      body.armor = 50;
      hud.setMoney(match.money);
      hud.setHealth(body.health, body.armor);
      hud.showBuy(match.money, weapon.owned, weapon.state.grenades);
    }
    return;
  }
  const def = WEAPONS[key];
  if (!def) return;
  if (weapon.owned[key]) {
    weapon.switchTo(key);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
    return;
  }
  if (match.money >= def.price) {
    match.money -= def.price;
    weapon.buy(key);
    weapon.switchTo(key);
    hud.setMoney(match.money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name);
    hud.showBuy(match.money, weapon.owned, weapon.state.grenades);
  }
}

hud.onBuy(buy);
hud.onPlay(() => {
  if (shot || soak) return;
  if (match.phase === 'over') restartMatch();
  input.requestLock();
});

const botCtx = {
  match,
  player,
  raycaster,
  shootables,
  hitMeshes,
  colliders: world.colliders,
  noise,
  playerMarker,
  testMode,
  onBotShot(shooter, victim, died, part) {
    if (!died) return;
    feedEvent(match, `${shooter.name} ▸ ${victim.name} †${part === 'head' ? ' (headshot)' : ''}`);
    if (died && victim.team === 'ash') {
      // A dead Ash bot cannot carry the fight; nothing else to do.
    }
    if (died && match.charge === 'carrier' && victim.name === 'Vex') dropChargeToNextCarrier();
  },
  onPlayerShot(shooterBot, dmg) {
    if (body.health <= 0) return;
    damageTaken += dmg;
    const died = player.damage(dmg);
    hud.setHealth(body.health, body.armor);
    hud.damageFlash();
    audio.hurt();
    if (died) {
      match.deaths += 1;
      feedEvent(match, `${shooterBot.name} ▸ YOU`);
      if (match.charge === 'player') {
        match.charge = 'carrier';
        dropChargeToNextCarrier();
      }
    }
  },
  onPlanted(bot, site) {
    match.phase = 'planted';
    match.charge = 'planted';
    match.detonateLeft = DETONATE_SECONDS;
    match.plantSite = site;
    feedEvent(match, `Charge planted at site ${site} by ${bot.name}`);
    audio.plant();
    world.chargeMesh.visible = true;
    world.chargeMesh.position.set(site === 'A' ? SITE_A.x : SITE_B.x, 0.35, site === 'A' ? SITE_A.z : SITE_B.z);
  },
  onDefused(bot) {
    feedEvent(match, `Charge defused by ${bot.name}`);
    endRound('cinder', 'defused');
  },
};

function checkRoundEnd() {
  if (match.phase !== 'live' && match.phase !== 'planted') return;
  const ashAlive = bots.aliveCount('ash') + (body.health > 0 ? 1 : 0);
  const cinderAlive = bots.aliveCount('cinder');
  if (cinderAlive === 0) { endRound('ash', 'elimination'); return; }
  if (ashAlive === 0) { endRound('cinder', 'elimination'); return; }
  if (match.phase === 'live' && match.timer <= 0) { endRound('cinder', 'time'); return; }
  if (match.phase === 'planted' && match.detonateLeft <= 0) {
    audio.boom();
    endRound('ash', 'detonation');
  }
}

function step(dt) {
  elapsed += dt;
  noise.length = 0;
  if (bannerAt > 0 && elapsed > bannerAt) { hud.setBanner(''); bannerAt = -1; }
  // Phase timers.
  if (match.phase === 'freeze') {
    match.timer -= dt;
    if (match.timer <= 0) {
      match.phase = 'live';
      match.timer = ROUND_SECONDS;
      hud.hideBuy();
      feedEvent(match, `Round ${match.round} — go`);
    }
  } else if (match.phase === 'live') {
    match.timer -= dt;
  } else if (match.phase === 'planted') {
    match.detonateLeft -= dt;
    match.timer = match.detonateLeft;
  } else if (match.phase === 'roundEnd' && elapsed >= roundEndAt) {
    match.round += 1;
    hud.hideOverlay();
    startRound();
  }
  if (match.phase === 'live' || match.phase === 'planted') {
    // Player movement + actions.
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (soak || testMode) autopilot(dt);
    else {
      if (input.state.firing && weapon.ready()) shoot(weapon.spread(player.groundSpeed()));
      if (keys.has('KeyR')) weapon.reload();
      if (keys.has('KeyB') && match.phase === 'freeze') hud.showBuy(match.money, weapon.owned, weapon.state.grenades);
      if (keys.has('KeyG')) { throwGrenade(); keys.delete('KeyG'); }
      if (keys.has('Digit1')) buy('kestrel');
      if (keys.has('Digit2')) buy('hornet');
      if (keys.has('Digit3')) buy('longbow');
      if (keys.has('Digit4')) buy('needle');
      if (keys.has('Digit5')) buy('mauler');
      if (keys.has('Digit6')) buy('anvil');
      if (keys.has('Digit7')) buy('grenade');
      if (keys.has('Digit8')) buy('armor');
    }
    player.step(dt, soak || testMode ? autopilotKeys : keys);
    weapon.step(dt);
    // Scope: right mouse while holding the Needle.
    if (!soak) {
      const wantScope = weapon.state.current === 'needle' && input.state.locked && mouseRight;
      if (wantScope !== weapon.state.scoped) {
        weapon.state.scoped = wantScope;
        camera.fov = wantScope ? 30 : 74;
        camera.updateProjectionMatrix();
      }
    }
    // Plant / defuse channel (hold E).
    const nearSiteA = Math.abs(body.position.x - SITE_A.x) < 3.4 && Math.abs(body.position.z - SITE_A.z) < 2.9;
    const nearSiteB = Math.abs(body.position.x - SITE_B.x) < 3.4 && Math.abs(body.position.z - SITE_B.z) < 2.9;
    const onSite = nearSiteA || nearSiteB;
    const holdingE = soak || testMode ? autopilotKeys.has('KeyE') : keys.has('KeyE');
    if (holdingE && match.charge === 'player' && match.phase === 'live' && onSite && body.health > 0) {
      match.plantProgress += dt;
      hud.setProgress('Planting charge', match.plantProgress / PLANT_SECONDS);
      if (match.plantProgress >= PLANT_SECONDS) {
        match.phase = 'planted';
        match.charge = 'planted';
        match.detonateLeft = DETONATE_SECONDS;
        match.plantSite = nearSiteA ? 'A' : 'B';
        feedEvent(match, `Charge planted at site ${match.plantSite} by YOU`);
        audio.plant();
        world.chargeMesh.visible = true;
        world.chargeMesh.position.set(nearSiteA ? SITE_A.x : SITE_B.x, 0.35, nearSiteA ? SITE_A.z : SITE_B.z);
        hud.setProgress(null, 0);
      }
    } else if (holdingE && match.phase === 'planted' && body.health > 0) {
      const chargePos = match.plantSite === 'A' ? SITE_A : SITE_B;
      const d = Math.hypot(body.position.x - chargePos.x, body.position.z - chargePos.z);
      if (d < 2.5) {
        match.defuseProgress += dt;
        hud.setProgress('Defusing charge', match.defuseProgress / DEFUSE_SECONDS);
        if (match.defuseProgress >= DEFUSE_SECONDS) {
          hud.setProgress(null, 0);
          feedEvent(match, 'Charge defused by YOU');
          endRound('cinder', 'defused');
        }
      } else {
        match.defuseProgress = 0;
        hud.setProgress(null, 0);
      }
    } else {
      match.plantProgress = Math.max(0, match.plantProgress - dt * 2);
      match.defuseProgress = 0;
      hud.setProgress(null, 0);
    }
    // Grenades in flight.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.t += dt;
      g.vel.y -= 18 * dt;
      g.pos.addScaledVector(g.vel, dt);
      if (g.pos.y <= 0.1 || g.t > 1.4) {
        explodeGrenade(g);
        grenades.splice(i, 1);
      }
    }
    // Bots.
    botCtx.noise = noise;
    bots.step(dt, botCtx);
    // Charge mesh follows the carrier.
    if (match.charge === 'carrier') {
      const carrier = bots.bots.find((b) => b.state === 'plant' && b.alive);
      if (carrier) {
        world.chargeMesh.visible = true;
        world.chargeMesh.position.set(carrier.group.position.x, 1.2, carrier.group.position.z);
      }
    }
    checkRoundEnd();
    // HUD.
    hud.setHealth(body.health, body.armor);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setMoney(match.money);
    hud.setTimer(match.phase === 'planted' ? match.detonateLeft : match.timer, match.phase);
    hud.setScore(match.round, match.wins.ash, match.wins.cinder);
    hud.setFeed(match.feed);
    hud.setCrosshairSpread(4 + weapon.spread(player.groundSpeed()) * 900);
    const chargePos = match.charge === 'planted' ? (match.plantSite === 'A' ? SITE_A : SITE_B) : null;
    hud.drawMinimap(body.position, body.yaw, bots.bots, chargePos, { A: SITE_A, B: SITE_B });
  }
  syncCamera();
}

let mouseRight = false;
window.addEventListener('mousedown', (e) => { if (e.button === 2) mouseRight = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) mouseRight = false; });

// --- Autopilot (soak mode): deterministic stand-in player -------------------
let autoPath = [];
let autoGoalKey = '';
function autopilot(dt) {
  autopilotKeys.clear();
  if (body.health <= 0) return;
  // Pick a goal point.
  let goal = null;
  let goalKind = 'site';
  if (match.phase === 'planted') {
    const site = match.plantSite === 'A' ? SITE_A : SITE_B;
    const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
    if (d < 2.2) { if (!testMode) autopilotKeys.add('KeyE'); goal = site; goalKind = 'defuse'; }
    else { goal = site; }
  } else if (match.charge === 'player') {
    const site = SITE_A;
    const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
    if (d < 2.5) { autopilotKeys.add('KeyE'); goal = site; goalKind = 'plant'; }
    else goal = site;
  } else {
    const carrier = bots.bots.find((b) => b.state === 'plant' && b.alive);
    goal = carrier ? { x: carrier.group.position.x, z: carrier.group.position.z } : { x: 0, z: -6 };
  }
  // Shoot the nearest visible enemy.
  let target = null;
  let targetDist = Infinity;
  for (const b of bots.bots) {
    if (b.team !== 'cinder' || !b.alive) continue;
    const d = Math.hypot(b.group.position.x - body.position.x, b.group.position.z - body.position.z);
    if (d >= targetDist) continue;
    const eye = new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
    const chest = new THREE.Vector3(b.group.position.x, b.group.position.y + 1.25, b.group.position.z);
    if (losClear(eye, chest)) { target = chest; targetDist = d; }
  }
  if (target && !testMode) {
    aimAt(target);
    if (weapon.state.mag === 0) weapon.reload();
    else if (weapon.ready()) shoot(weapon.spread(0));
  } else if (goal) {
    // Walk toward the goal over the nav graph so crates never block the route.
    const goalKey = `${goalKind}:${Math.round(goal.x)},${Math.round(goal.z)}`;
    if (autoGoalKey !== goalKey || autoPath.length === 0) {
      autoGoalKey = goalKey;
      autoPath = navRoute(nearestNode(body.position.x, body.position.z), nearestNode(goal.x, goal.z));
    }
    let dest = goal;
    if (autoPath.length) {
      const [nx, nz] = NAV_NODES[autoPath[0]];
      if (Math.hypot(nx - body.position.x, nz - body.position.z) < 0.6) autoPath.shift();
      if (autoPath.length) {
        const [ax, az] = NAV_NODES[autoPath[0]];
        dest = { x: ax, z: az };
      }
    }
    const dx = dest.x - body.position.x;
    const dz = dest.z - body.position.z;
    const wantYaw = Math.atan2(-dx, -dz);
    let diff = wantYaw - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += Math.max(-0.09, Math.min(0.09, diff));
    body.pitch = 0;
    if (Math.abs(diff) < 0.6) autopilotKeys.add('KeyW');
    if (weapon.state.mag === 0) weapon.reload();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

let accumulator = 0;
let lastTime = performance.now();

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  if (name === 'menu') {
    startRound();
    body.position.set(0, 0, 12.5);
    body.yaw = Math.PI;
    body.pitch = 0;
    syncCamera();
    hud.showOverlay('start', undefined);
    hud.setHealth(100, 0);
    hud.setAmmo(12, 48, 'Kestrel');
    hud.setMoney(800);
    hud.setTimer(100, 'live');
    hud.setScore(1, 0, 0);
  } else if (name === 'combat') {
    match.phase = 'live';
    match.timer = 87;
    match.money = 2350;
    body.position.set(-2, 0, 4);
    body.yaw = Math.PI;
    syncCamera();
    for (let i = 0; i < 30; i += 1) step(FIXED_STEP);
    const victim = bots.bots.find((b) => b.team === 'cinder' && b.alive);
    if (victim) {
      aimAt(new THREE.Vector3(victim.group.position.x, 1.3, victim.group.position.z));
      for (let r = 0; r < 4; r += 1) { shoot(0); step(FIXED_STEP); }
    }
    step(FIXED_STEP);
    hud.setFeed(match.feed);
  } else if (name === 'buy') {
    startRound();
    match.phase = 'freeze';
    match.timer = 3;
    match.money = 4000;
    body.position.set(0, 0, 12.5);
    body.yaw = Math.PI;
    syncCamera();
    hud.showBuy(4000, weapon.owned, 1);
    hud.setMoney(4000);
  } else if (name === 'end') {
    match.phase = 'over';
    match.wins.ash = 5;
    match.wins.cinder = 3;
    match.matchWinner = 'ash';
    match.kills = 14;
    match.deaths = 6;
    body.position.set(0, 0, 8);
    body.yaw = Math.PI;
    syncCamera();
    hud.setScore(9, 5, 3);
    hud.showOverlay('end', 'Final score 5 — 3. 14 eliminations, 6 deaths. ASH takes the match.');
  }
  paintTwiceThenReady();
}

function runTest(kind) {
  const log = [];
  startRound();
  const vex = bots.bots.find((b) => b.name === 'Vex');
  const tallow = bots.bots.find((b) => b.name === 'Tallow');
  function killAllExcept(keep) {
    for (const b of bots.bots) {
      if (b === keep) continue;
      b.alive = false;
      b.health = 0;
      b.fall = 1;
      b.group.rotation.x = -1.4;
    }
  }
  let steps = 0;
  const maxSteps = 60 * 60 * 4;
  let plantedAt = -1;
  if (kind === 'plant') {
    killAllExcept(vex);
    while (steps < maxSteps) {
      step(FIXED_STEP);
      steps += 1;
      if (steps % 600 === 0) log.push(`t=${(steps / 60).toFixed(0)}s pos=${body.position.x.toFixed(1)},${body.position.z.toFixed(1)} yaw=${body.yaw.toFixed(2)} phase=${match.phase} charge=${match.charge} plant=${match.plantProgress.toFixed(2)} keys=${[...autopilotKeys].join('+')}`);
      if (plantedAt < 0 && match.phase === 'planted') {
        plantedAt = steps;
        log.push(`planted at step ${steps} site=${match.plantSite}`);
        vex.group.position.set(SITE_A.x + 1, 0, SITE_A.z);
        vex.state = 'defuse';
      }
      if (plantedAt > 0 && match.phase === 'roundEnd') {
        log.push(`round ended winner=${match.wins.ash > 0 ? 'ash' : 'cinder'} wins=${match.wins.ash}-${match.wins.cinder}`);
        log.push(`defused=${match.log.some((l) => l.includes('defused'))}`);
        break;
      }
    }
  } else {
    // detonate: only Tallow stays alive, parked far from both sites; nobody defuses.
    killAllExcept(tallow);
    tallow.group.position.set(20, 0, 14);
    tallow.state = 'hold';
    tallow.path = [];
    while (steps < maxSteps) {
      step(FIXED_STEP);
      steps += 1;
      if (plantedAt < 0 && match.phase === 'planted') {
        plantedAt = steps;
        log.push(`planted at step ${steps} site=${match.plantSite}`);
      }
      if (plantedAt > 0 && match.phase === 'roundEnd') {
        log.push(`round ended winner=${match.wins.ash > 0 ? 'ash' : 'cinder'} wins=${match.wins.ash}-${match.wins.cinder}`);
        log.push(`detonated=${match.log.some((l) => l.includes('detonation'))}`);
        break;
      }
    }
  }
  log.push(`steps=${steps} phase=${match.phase}`);
  window.__testLog = log.concat(match.log);
  syncCamera();
  renderer.render(scene, camera);
  window.__shotReady = true;
}

function runSoak() {
  const log = [];
  let steps = 0;
  const maxSteps = 60 * 60 * 12; // 12 simulated minutes max
  startRound();
  while (match.phase !== 'over' && steps < maxSteps) {
    step(FIXED_STEP);
    steps += 1;
    if (match.phase === 'roundEnd') {
      // Auto-advance is handled by step(); log round results as they land.
    }
  }
  log.push(`steps=${steps}`);
  log.push(`score=${match.wins.ash}-${match.wins.cinder} winner=${match.matchWinner}`);
  log.push(`kills=${match.kills} deaths=${match.deaths} money=${match.money} damageTaken=${damageTaken} finalHp=${body.health}`);
  log.push(`planted=${match.log.some((l) => l.includes('planted'))} defused=${match.log.some((l) => l.includes('defused'))} detonated=${match.log.some((l) => l.includes('detonation'))}`);
  log.push(`rounds=${match.log.filter((l) => l.includes('wins round')).length}`);
  window.__soakLog = log.concat(match.log);
  syncCamera();
  renderer.render(scene, camera);
  window.__shotReady = true;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100, 0);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
hud.setMoney(match.money);
hud.setScore(1, 0, 0);
hud.setTimer(FREEZE_SECONDS, 'freeze');
if (soak) {
  runSoak();
} else if (testKind) {
  runTest(testKind);
} else if (shot) {
  runShot(shot);
} else {
  startRound();
  hud.showOverlay('start', undefined);
  requestAnimationFrame(frame);
}
