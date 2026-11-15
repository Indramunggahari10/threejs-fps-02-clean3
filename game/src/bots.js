// Nine bots: four Ash teammates and five Cinder opponents. Each bot is a small state
// machine — hold, patrol, push, plant, defuse, investigate — routed over the world's
// nav graph with BFS, seeing through a vision cone plus a line-of-sight raycast, and
// hearing gunfire as noise events. Bots shoot in bursts with distance-based error.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NAV_NODES, SITE_A, SITE_B, navRoute, nearestNode } from './world.js';

const BOT_NAMES_ASH = ['Rook', 'Iris', 'Moss', 'Pike'];
const BOT_NAMES_CINDER = ['Vex', 'Slag', 'Brine', 'Onyx', 'Tallow'];
const BOT_SPEED = 3.6;
const VISION_RANGE = 30;
const VISION_HALF_ANGLE = 1.15;
const BOT_HEALTH = 100;

function makeBody(scene, team, name) {
  const group = new THREE.Group();
  const mainColor = team === 'ash' ? PALETTE.teal : PALETTE.danger;
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(mainColor), roughness: 0.6, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), torsoMat);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), skinMat);
  head.position.y = 1.58;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.36), torsoMat);
  band.position.y = 1.68;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), darkMat);
  legL.position.set(-0.14, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
  gun.position.set(0.2, 1.18, -0.28);
  group.add(torso, head, band, legL, legR, gun);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  scene.add(group);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  group.add(flash);
  flash.position.set(0.2, 1.25, -0.7);
  return { group, torso, head, flash };
}

export function createBots(scene, world, rng) {
  const bots = [];
  const ashSpawns = [[-4, 12], [-1.5, 13], [1.5, 13], [4, 12]];
  const cinderSpawns = [[-14, -11], [-6, -12], [0, -13], [6, -12], [14, -11]];
  function addBot(team, name, spawn, skill) {
    const parts = makeBody(scene, team, name);
    const bot = {
      team, name, skill,
      group: parts.group,
      torso: parts.torso,
      head: parts.head,
      flash: parts.flash,
      home: new THREE.Vector3(spawn[0], 0, spawn[1]),
      health: BOT_HEALTH,
      alive: true,
      yaw: team === 'ash' ? Math.PI : 0,
      state: 'hold',
      path: [],
      node: nearestNode(spawn[0], spawn[1]),
      targetNode: nearestNode(spawn[0], spawn[1]),
      wait: 0,
      fireCooldown: 0,
      burstLeft: 0,
      burstPause: 0,
      aimTarget: null,
      channel: 0, // plant/defuse progress while standing in place
      channelKind: null,
      fall: 0,
      speed: BOT_SPEED * (0.9 + rng() * 0.25),
      strafe: 0,
    };
    parts.torso.userData.bot = bot;
    parts.torso.userData.part = 'torso';
    parts.head.userData.bot = bot;
    parts.head.userData.part = 'head';
    bots.push(bot);
    return bot;
  }
  for (let i = 0; i < 4; i += 1) addBot('ash', BOT_NAMES_ASH[i], ashSpawns[i], 0.5 + rng() * 0.3);
  for (let i = 0; i < 5; i += 1) addBot('cinder', BOT_NAMES_CINDER[i], cinderSpawns[i], 0.5 + rng() * 0.35);
  const hitMeshes = [];
  for (const b of bots) hitMeshes.push(b.torso, b.head);
  let now = 0;

  function reset(roundCarrier) {
    for (const b of bots) {
      b.group.position.copy(b.home);
      b.group.rotation.set(0, b.team === 'ash' ? Math.PI : 0, 0);
      b.health = BOT_HEALTH;
      b.alive = true;
      b.yaw = b.team === 'ash' ? Math.PI : 0;
      b.path = [];
      b.wait = 0.5 + rng() * 1.5;
      b.channel = 0;
      b.channelKind = null;
      b.alert = null;
      b.fall = 0;
      b.burstLeft = 0;
      b.fireCooldown = 0;
      b.flash.visible = false;
      b.state = b.team === 'ash' ? 'push' : 'hold';
      b.targetNode = b.node;
    }
    // Cinder holds the sites; Ash pushes up mid.
    const cinder = bots.filter((b) => b.team === 'cinder');
    cinder[0].targetNode = SITE_A.node; cinder[0].state = 'hold';
    cinder[1].targetNode = SITE_A.node; cinder[1].state = 'hold';
    cinder[2].targetNode = 18; cinder[2].state = 'patrol';
    cinder[3].targetNode = SITE_B.node; cinder[3].state = 'hold';
    cinder[4].targetNode = SITE_B.node; cinder[4].state = 'hold';
    const ash = bots.filter((b) => b.team === 'ash');
    ash[0].targetNode = 8; ash[1].targetNode = 7; ash[2].targetNode = 9; ash[3].targetNode = 8;
    if (roundCarrier) roundCarrier.state = 'push';
  }

  function damage(bot, amount, part, fromPos) {
    if (!bot.alive) return false;
    bot.health -= amount * (part === 'head' ? 2 : 1);
    if (fromPos) bot.alert = { x: fromPos.x, z: fromPos.z, until: now + 2.5 };
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.flash.visible = false;
    return true;
  }

  function canSee(bot, targetPos, ctx) {
    const eye = new THREE.Vector3(bot.group.position.x, 1.55, bot.group.position.z);
    const to = new THREE.Vector3().subVectors(targetPos, eye);
    const dist = to.length();
    if (dist > VISION_RANGE) return false;
    const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
    if (forward.dot(flat) < Math.cos(VISION_HALF_ANGLE)) return false;
    ctx.raycaster.set(eye, to.normalize());
    ctx.raycaster.far = dist;
    const hit = ctx.raycaster.intersectObjects(ctx.shootables, false)[0];
    return !hit;
  }

  function moveAlongPath(bot, dt, ctx) {
    if (!bot.path.length) return true;
    const [nx, nz] = NAV_NODES[bot.path[0]];
    const dx = nx - bot.group.position.x;
    const dz = nz - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      bot.path.shift();
      return bot.path.length === 0;
    }
    const stepLen = bot.speed * dt;
    const mx = (dx / dist) * stepLen;
    const mz = (dz / dist) * stepLen;
    // Slide: if the next step lands inside a collider, stop and re-route.
    const probe = new THREE.Box3(
      new THREE.Vector3(bot.group.position.x + mx - 0.34, 0.05, bot.group.position.z + mz - 0.34),
      new THREE.Vector3(bot.group.position.x + mx + 0.34, 1.7, bot.group.position.z + mz + 0.34),
    );
    let blocked = false;
    for (const c of ctx.colliders) if (probe.intersectsBox(c)) { blocked = true; break; }
    if (!blocked) {
      bot.group.position.x += mx;
      bot.group.position.z += mz;
    } else {
      bot.path = [];
      return true;
    }
    bot.yaw = Math.atan2(-dx, -dz);
    return false;
  }

  function setRoute(bot, node) {
    bot.node = nearestNode(bot.group.position.x, bot.group.position.z);
    bot.path = navRoute(bot.node, node);
    bot.targetNode = node;
  }

  function step(dt, ctx) {
    now += dt;
    const { match, player, raycaster } = ctx;
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.5);
        bot.group.rotation.x = -bot.fall * 1.4;
        continue;
      }
      bot.group.rotation.x = 0;
      bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
      bot.burstPause = Math.max(0, bot.burstPause - dt);
      bot.flash.visible = false;
      // --- perception: nearest visible enemy (player or opposite bot) ---
      let enemy = null;
      let enemyPos = null;
      let enemyDist = Infinity;
      const candidates = [];
      if (player.state.health > 0 && bot.team === 'cinder') {
        candidates.push({ kind: 'player', pos: new THREE.Vector3(player.state.position.x, player.state.position.y + 1.3, player.state.position.z), ref: player });
      }
      if (bot.team === 'cinder') {
        for (const other of bots) {
          if (other.team === 'ash' && other.alive) {
            candidates.push({ kind: 'bot', pos: new THREE.Vector3(other.group.position.x, other.group.position.y + 1.3, other.group.position.z), ref: other });
          }
        }
      } else {
        for (const other of bots) {
          if (other.team === 'cinder' && other.alive) {
            candidates.push({ kind: 'bot', pos: new THREE.Vector3(other.group.position.x, other.group.position.y + 1.3, other.group.position.z), ref: other });
          }
        }
      }
      for (const c of candidates) {
        const d = Math.hypot(c.pos.x - bot.group.position.x, c.pos.z - bot.group.position.z);
        if (d < enemyDist && canSee(bot, c.pos, ctx)) {
          enemy = c;
          enemyPos = c.pos;
          enemyDist = d;
        }
      }
      // --- hearing / pain: a loud noise or a hit pulls the bot to investigate ---
      if (!enemy && bot.alert && now < bot.alert.until) {
        bot.yaw = Math.atan2(-(bot.alert.x - bot.group.position.x), -(bot.alert.z - bot.group.position.z));
        if (bot.state !== 'defuse' && bot.state !== 'plant' && bot.state !== 'investigate') {
          bot.state = 'investigate';
          setRoute(bot, nearestNode(bot.alert.x, bot.alert.z));
        }
      }
      if (!enemy && ctx.noise) {
        for (const n of ctx.noise) {
          const d = Math.hypot(n.x - bot.group.position.x, n.z - bot.group.position.z);
          if (d < n.radius && bot.state !== 'defuse' && bot.state !== 'plant') {
            bot.state = 'investigate';
            setRoute(bot, nearestNode(n.x, n.z));
            break;
          }
        }
      }
      // --- objective behaviour ---
      const inSiteA = Math.abs(bot.group.position.x - SITE_A.x) < 3.4 && Math.abs(bot.group.position.z - SITE_A.z) < 2.9;
      const inSiteB = Math.abs(bot.group.position.x - SITE_B.x) < 3.4 && Math.abs(bot.group.position.z - SITE_B.z) < 2.9;
      const onSite = inSiteA || inSiteB;
      if (match.phase === 'planted' && bot.team === 'cinder' && onSite && match.charge === 'planted') {
        bot.state = 'defuse';
      }
      if (match.phase === 'live' && bot.team === 'cinder' && match.charge === 'carrier' && bot.name === 'Vex' && bot.alive) {
        bot.state = 'plant';
        setRoute(bot, match.plantSite === 'A' ? SITE_A.node : SITE_B.node);
      }
      // --- combat: burst fire at a visible enemy ---
      if (enemy && enemyDist < 34 && !ctx.testMode) {
        const toEnemy = new THREE.Vector3().subVectors(enemyPos, new THREE.Vector3(bot.group.position.x, 1.55, bot.group.position.z));
        bot.yaw = Math.atan2(-toEnemy.x, -toEnemy.z);
        if (bot.fireCooldown === 0 && bot.burstPause === 0) {
          if (bot.burstLeft === 0) bot.burstLeft = 3 + Math.floor(rng() * 3);
          bot.burstLeft -= 1;
          bot.fireCooldown = 0.11;
          if (bot.burstLeft === 0) bot.burstPause = 0.5 + rng() * 0.7;
          bot.flash.visible = true;
          ctx.noise.push({ x: bot.group.position.x, z: bot.group.position.z, radius: 22 });
          // Aim error grows with distance and falls with skill; headshots are rare.
          const err = (0.006 + enemyDist * 0.0009) * (1.25 - bot.skill * 0.5);
          const dir = toEnemy.normalize();
          dir.x += (rng() * 2 - 1) * err;
          dir.y += (rng() * 2 - 1) * err * 0.7;
          dir.z += (rng() * 2 - 1) * err;
          dir.normalize();
          const eye = new THREE.Vector3(bot.group.position.x, 1.55, bot.group.position.z);
          raycaster.set(eye, dir);
          raycaster.far = 60;
          const hits = raycaster.intersectObjects(ctx.shootables.concat(ctx.hitMeshes, [ctx.playerMarker]), false);
          const first = hits[0];
          if (first) {
            if (first.object.userData.bot && first.object.userData.bot !== bot) {
              const victim = first.object.userData.bot;
              const died = damage(victim, 26, first.object.userData.part, bot.group.position);
              ctx.onBotShot(bot, victim, died, first.object.userData.part);
            } else if (enemy.kind === 'player' && first.object === ctx.playerMarker) {
              ctx.onPlayerShot(bot, 26);
            }
          }
        }
      }
      // --- plant / defuse channels (stand still, hold the channel) ---
      if (bot.state === 'plant' && onSite && match.charge === 'carrier' && bot.name === 'Vex') {
        bot.channel += dt;
        if (bot.channel >= 3) {
          bot.channel = 0;
          bot.state = 'hold';
          ctx.onPlanted(bot, inSiteA ? 'A' : 'B');
        }
        continue;
      }
      if (bot.state === 'defuse' && onSite && match.phase === 'planted') {
        bot.channel += dt;
        if (bot.channel >= 4) {
          bot.channel = 0;
          bot.state = 'hold';
          ctx.onDefused(bot);
        }
        continue;
      }
      bot.channel = 0;
      // --- movement ---
      if (enemy) {
        // Strafe a little while fighting instead of standing still.
        bot.strafe += (rng() - 0.5) * dt * 2;
        bot.strafe = Math.max(-1, Math.min(1, bot.strafe));
        bot.group.position.x += Math.cos(bot.yaw) * bot.strafe * dt * 1.2;
        bot.group.position.z -= Math.sin(bot.yaw) * bot.strafe * dt * 1.2;
      } else if (bot.wait > 0) {
        bot.wait -= dt;
        // Holders sweep their view instead of staring at one wall.
        if (bot.state === 'hold' && !enemy) bot.yaw += dt * 0.45;
      } else if (bot.path.length) {
        if (moveAlongPath(bot, dt, ctx)) {
          bot.wait = bot.state === 'hold' ? 2 + rng() * 3 : 0.4;
          if (bot.state === 'patrol') {
            const next = bot.targetNode === 18 ? 13 : 18;
            setRoute(bot, next);
          } else if (bot.state === 'investigate') {
            bot.state = bot.team === 'ash' ? 'push' : 'hold';
          }
        }
      } else if (bot.state === 'push' || bot.state === 'patrol') {
        // Pick a fresh waypoint: Ash pushes toward a site, Cinder patrols its half.
        const pool = bot.team === 'ash' ? [7, 8, 9, 12, 13, 14, 17, 18, 19] : [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        const pick = pool[Math.floor(rng() * pool.length)];
        setRoute(bot, pick);
      }
      bot.group.rotation.y = bot.yaw;
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    damage,
    step,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
  };
}
