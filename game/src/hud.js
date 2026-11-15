// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, round score,
// kill feed, minimap, plant/defuse progress, and the menu / buy / round overlays.
// It never touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, WEAPON_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './weapon.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const buyPanel = $('buy');
  const buyRows = $('buy-rows');
  const banner = $('banner');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const roundEl = $('round');
  const scoreAsh = $('score-ash');
  const scoreCinder = $('score-cinder');
  const feedEl = $('feed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const damageEl = $('damage');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');
  const weaponName = $('weapon-name');
  let hitTimer = 0;
  let damageTimer = 0;
  let last = {};
  let buyHandler = null;

  const COPY = {
    start: {
      title: 'ASHEN PROTOCOL',
      copy: 'A dusk-lit freight yard. Five against five, two charge sites, one charge to plant. Click to play — first to 5 rounds takes the match.',
      action: 'Click to play',
    },
    paused: { title: 'ASHEN PROTOCOL', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    round: { title: 'Round over', copy: '', action: 'Next round' },
    end: { title: 'Match over', copy: '', action: 'Play again' },
  };

  function setText(el, key, value) {
    if (last[key] !== value) { last[key] = value; el.textContent = value; }
  }

  return {
    setHealth(hp, armor) {
      setText(healthNum, 'hp', String(Math.ceil(hp)));
      setText(armorNum, 'armor', armor > 0 ? `+${Math.ceil(armor)}` : '');
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.style.background = hp > 50 ? '#4fae9d' : hp > 25 ? '#e8a13a' : '#d95b43';
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) { setText(moneyEl, 'money', `$${value}`); },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerEl, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      timerEl.style.color = phase === 'planted' ? '#d95b43' : '#efe7d8';
    },
    setScore(round, ash, cinder) {
      setText(roundEl, 'round', `ROUND ${round}`);
      setText(scoreAsh, 'sa', String(ash));
      setText(scoreCinder, 'sc', String(cinder));
    },
    setFeed(feed) {
      const html = feed.map((f) => `<div>${f.text}</div>`).join('');
      if (last.feed !== html) { last.feed = html; feedEl.innerHTML = html; }
    },
    setBanner(text) {
      if (last.banner !== text) { last.banner = text; banner.textContent = text; banner.style.opacity = text ? '1' : '0'; }
    },
    hitMarker(killed) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => { hitmarker.classList.remove('on'); hitmarker.style.transform = ''; }, 90);
    },
    damageFlash() {
      damageEl.style.opacity = '0.55';
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => { damageEl.style.opacity = '0'; }, 180);
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    setProgress(label, frac) {
      if (!label) { progress.hidden = true; return; }
      progress.hidden = false;
      setText(progressLabel, 'plabel', label);
      progressFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
    showBuy(money, owned, grenades) {
      buyPanel.hidden = false;
      const rows = WEAPON_ORDER.map((key, i) => {
        const w = WEAPONS[key];
        const has = !!owned[key];
        return `<button class="buy-row" data-key="${key}" ${has ? '' : `data-price="${w.price}"`}>
          <span class="buy-key">${i + 1}</span><span class="buy-name">${w.name} · ${w.kind}</span>
          <span class="buy-stat">${w.damage} dmg · ${w.mag} rnd</span>
          <span class="buy-price">${has ? 'OWNED' : `$${w.price}`}</span></button>`;
      }).join('');
      buyRows.innerHTML = rows
        + `<button class="buy-row" data-key="grenade"><span class="buy-key">7</span><span class="buy-name">Blast grenade</span><span class="buy-stat">x${grenades} held</span><span class="buy-price">$${GRENADE_PRICE}</span></button>`
        + `<button class="buy-row" data-key="armor"><span class="buy-key">8</span><span class="buy-name">Kevlar vest</span><span class="buy-stat">50 armor</span><span class="buy-price">$${ARMOR_PRICE}</span></button>`;
      buyRows.querySelectorAll('.buy-row').forEach((row) => {
        row.addEventListener('click', () => buyHandler && buyHandler(row.dataset.key));
      });
      setText(moneyEl, 'money', `$${money}`);
    },
    hideBuy() { buyPanel.hidden = true; },
    onBuy(handler) { buyHandler = handler; },
    drawMinimap(playerPos, yaw, bots, chargePos, sites) {
      const W = 168;
      const S = W / 46;
      mctx.clearRect(0, 0, W, W);
      mctx.fillStyle = 'rgba(23,19,15,0.85)';
      mctx.fillRect(0, 0, W, W);
      const px = (x) => (x + 23) * S;
      const pz = (z) => (z + 16) * S;
      // Walls as a border + site plates.
      mctx.strokeStyle = '#3a2f26';
      mctx.lineWidth = 3;
      mctx.strokeRect(px(-22), pz(-15), 44 * S, 30 * S);
      mctx.fillStyle = '#4fae9d';
      mctx.fillRect(px(sites.A.x - 3.5), pz(sites.A.z - 3), 7 * S, 6 * S);
      mctx.fillStyle = '#e8a13a';
      mctx.fillRect(px(sites.B.x - 3.5), pz(sites.B.z - 3), 7 * S, 6 * S);
      mctx.fillStyle = '#efe7d8';
      mctx.font = 'bold 11px sans-serif';
      mctx.fillText('A', px(sites.A.x) - 4, pz(sites.A.z) + 4);
      mctx.fillText('B', px(sites.B.x) - 4, pz(sites.B.z) + 4);
      if (chargePos) {
        mctx.fillStyle = '#e8a13a';
        mctx.beginPath();
        mctx.arc(px(chargePos.x), pz(chargePos.z), 4, 0, Math.PI * 2);
        mctx.fill();
      }
      for (const b of bots) {
        if (!b.alive) continue;
        mctx.fillStyle = b.team === 'ash' ? '#4fae9d' : '#d95b43';
        mctx.beginPath();
        mctx.arc(px(b.group.position.x), pz(b.group.position.z), 3.5, 0, Math.PI * 2);
        mctx.fill();
      }
      // Player arrow.
      const cx = px(playerPos.x);
      const cy = pz(playerPos.z);
      mctx.fillStyle = '#efe7d8';
      mctx.save();
      mctx.translate(cx, cy);
      mctx.rotate(Math.atan2(-Math.sin(yaw), -Math.cos(yaw)) + Math.PI / 2);
      mctx.beginPath();
      mctx.moveTo(0, -7);
      mctx.lineTo(5, 5);
      mctx.lineTo(-5, 5);
      mctx.closePath();
      mctx.fill();
      mctx.restore();
    },
  };
}
