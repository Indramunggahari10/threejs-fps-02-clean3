// Six weapons and one grenade. The table owns every number; main.js owns the ray
// and the damage. Spread grows with movement speed, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  kestrel: { name: 'Kestrel', kind: 'pistol', price: 0, damage: 28, headMult: 2, gap: 0.16, auto: false, mag: 12, reserve: 48, pellets: 1, spreadStill: 0.002, spreadMove: 0.02, reload: 1.4, kick: 0.03 },
  hornet: { name: 'Hornet', kind: 'smg', price: 1200, damage: 22, headMult: 2, gap: 0.085, auto: true, mag: 25, reserve: 100, pellets: 1, spreadStill: 0.004, spreadMove: 0.03, reload: 2.0, kick: 0.022 },
  longbow: { name: 'Longbow', kind: 'rifle', price: 2700, damage: 34, headMult: 2, gap: 0.1, auto: true, mag: 30, reserve: 90, pellets: 1, spreadStill: 0.0022, spreadMove: 0.028, reload: 1.9, kick: 0.035 },
  needle: { name: 'Needle', kind: 'sniper', price: 4750, damage: 95, headMult: 4, gap: 1.25, auto: false, mag: 5, reserve: 15, pellets: 1, spreadStill: 0.0006, spreadMove: 0.05, reload: 2.8, kick: 0.09 },
  mauler: { name: 'Mauler', kind: 'shotgun', price: 1700, damage: 12, headMult: 2, gap: 0.8, auto: false, mag: 6, reserve: 24, pellets: 7, spreadStill: 0.02, spreadMove: 0.04, reload: 2.6, kick: 0.07 },
  anvil: { name: 'Anvil', kind: 'lmg', price: 3200, damage: 26, headMult: 2, gap: 0.12, auto: true, mag: 50, reserve: 100, pellets: 1, spreadStill: 0.005, spreadMove: 0.032, reload: 3.2, kick: 0.028 },
};
export const WEAPON_ORDER = ['kestrel', 'hornet', 'longbow', 'needle', 'mauler', 'anvil'];
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a3f33'), roughness: 0.55, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.2 });
  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
  sight.position.set(0, 0.075, -0.1);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.3, -0.26, -0.6);
  model.scale.setScalar(0.7);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.3, -0.23, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.3, -0.22, -0.75);
  camera.add(flashLight);

  const owned = { kestrel: { mag: 12, reserve: 48 } };
  const state = {
    current: 'kestrel',
    mag: 12,
    reserve: 48,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
    scoped: false,
  };

  function def() { return WEAPONS[state.current]; }
  function save() { owned[state.current] = { mag: state.mag, reserve: state.reserve }; }
  function load(key) {
    if (!owned[key]) owned[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
    state.mag = owned[key].mag;
    state.reserve = owned[key].reserve;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.6 + state.kick;
    model.rotation.x = state.kick * 2.2;
    // Sniper scope pulls the model in close and narrows the view; main.js sets FOV.
    const targetX = state.scoped ? 0 : 0.3;
    model.position.x += (targetX - model.position.x) * Math.min(1, dt * 10);
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 8;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        save();
      }
    }
  }

  return {
    state,
    owned,
    def,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = def().kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      save();
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def().mag || state.reserve === 0) return;
      state.reloadLeft = def().reload;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMove;
    },
    switchTo(key) {
      if (!WEAPONS[key] || !owned[key] || key === state.current) return false;
      save();
      state.current = key;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      load(key);
      return true;
    },
    buy(key) {
      if (owned[key]) return false;
      owned[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      return true;
    },
    refillAll() {
      for (const key of Object.keys(owned)) {
        owned[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      }
      load(state.current);
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.grenades = 0;
    },
    resetToPistol() {
      for (const key of Object.keys(owned)) delete owned[key];
      owned.kestrel = { mag: 12, reserve: 48 };
      state.current = 'kestrel';
      load('kestrel');
      state.grenades = 0;
    },
  };
}
