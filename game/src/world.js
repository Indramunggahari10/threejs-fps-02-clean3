// The map: ASHEN YARD, an original dusk-lit freight yard. Two charge sites (A west,
// B east) at the north end, a mid lane with a broken gantry, and container cover so
// every lane has corners and sightlines. Every box is a collider and a bullet stop.
// The nav graph is a set of named waypoints with edges; bots route over it with BFS.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav waypoints: [x, z] on the yard floor. Edges are listed as index pairs.
export const NAV_NODES = [
  [0, 12], [-8, 12], [8, 12], // spawns row (south)
  [-8, 6], [0, 6], [8, 6], // mid-south
  [-13, 0], [-5, 0], [0, 0], [5, 0], [13, 0], // mid lane
  [-13, -6], [-5, -6], [0, -6], [5, -6], [13, -6], // mid-north
  [-14, -11], [-7, -11], [0, -11], [7, -11], [14, -11], // sites row
  [-14, -13.5], [14, -13.5], // deep sites A / B
];
const NAV_EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [2, 5], [3, 4], [4, 5], [3, 6], [4, 8],
  [5, 10], [6, 7], [7, 8], [8, 9], [9, 10], [6, 11], [7, 12], [8, 13],
  [9, 14], [10, 15], [11, 12], [12, 13], [13, 14], [14, 15], [11, 16],
  [12, 17], [13, 18], [14, 19], [15, 20], [16, 17], [17, 18], [18, 19],
  [19, 20], [16, 21], [20, 22], [17, 21], [19, 22],
];
export const SITE_A = { x: -14, z: -12.5, node: 21 };
export const SITE_B = { x: 14, z: -12.5, node: 22 };
export const SPAWN_ASH = { x: 0, z: 12.5 };
export const SPAWN_CINDER = { x: 0, z: -12.5 };

export function navRoute(fromNode, toNode) {
  if (fromNode === toNode) return [toNode];
  const prev = new Array(NAV_NODES.length).fill(-1);
  const queue = [fromNode];
  prev[fromNode] = fromNode;
  while (queue.length) {
    const cur = queue.shift();
    for (const [a, b] of NAV_EDGES) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next >= 0 && prev[next] === -1) {
        prev[next] = cur;
        if (next === toNode) {
          const path = [toNode];
          let n = toNode;
          while (n !== fromNode) { n = prev[n]; path.unshift(n); }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [toNode];
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NAV_NODES.length; i += 1) {
    const dx = NAV_NODES[i][0] - x;
    const dz = NAV_NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }
  const colliders = [];
  const shootables = [];
  function box(w, h, d, x, y, z, mat, shadow = true, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }
  // Floor and perimeter: 44 x 30 m yard, 5 m walls, open dusk sky above.
  box(44.4, 0.4, 30.4, 0, -0.2, 0, 'surface', false);
  box(0.4, 5, 30.4, -22.2, 2.5, 0, 'surface');
  box(0.4, 5, 30.4, 22.2, 2.5, 0, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, -15.2, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, 15.2, 'surface');
  // Site markers: painted floor plates for A (west) and B (east). Flat decals —
  // not solid, so players and bots walk straight onto a site to plant or defuse.
  box(7, 0.06, 6, -14, 0.03, -12.5, 'teal', false, false);
  box(7, 0.06, 6, 14, 0.03, -12.5, 'accent', false, false);
  // Mid gantry: two pillars and a broken beam the player can shoot under.
  box(1, 4.4, 1, -2.2, 2.2, 0, 'hairline');
  box(1, 4.4, 1, 2.2, 2.2, 0, 'hairline');
  box(5.4, 0.9, 1.2, 0, 4.4, 0, 'hairline');
  // Container cover: long crates forming lanes and corners. Placed clear of every
  // nav-graph edge, so bots and the autopilot can route through the whole yard.
  box(6, 2.4, 2.2, -14, 1.2, 6, 'hairline');
  box(6, 2.4, 2.2, 14, 1.2, 6, 'hairline');
  box(2.2, 1.1, 4, -16, 0.55, 2, 'surface');
  box(2.2, 1.1, 4, 16, 0.55, 2, 'surface');
  box(4, 1.1, 1.4, -9, 0.55, -3, 'hairline');
  box(4, 1.1, 1.4, 9, 0.55, -3, 'hairline');
  box(1.6, 2.2, 1.6, -8, 1.1, -9, 'surface');
  box(1.6, 2.2, 1.6, 8, 1.1, -9, 'surface');
  box(3, 0.8, 3, 3.5, 0.4, -8.5, 'hairline');
  box(2.4, 1.6, 2.4, -18, 0.8, -6, 'hairline');
  box(2.4, 1.6, 2.4, 18, 0.8, -6, 'hairline');
  box(1.2, 3.4, 1.2, -10, 1.7, -13.8, 'surface');
  box(1.2, 3.4, 1.2, 10, 1.7, -13.8, 'surface');
  box(5, 0.9, 1.6, -7, 0.45, 13.5, 'hairline');
  box(5, 0.9, 1.6, 7, 0.45, 13.5, 'hairline');

  // The charge: a small glowing device the carrier holds; planted it sits on a site.
  const chargeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  chargeMesh.visible = false;
  scene.add(chargeMesh);

  // Light: low dusk sun from the west, cool fill from the east, warm sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a4632'), new THREE.Color(PALETTE.canvas), 2.0);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 3.0);
  sun.position.set(-18, 16, 10);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.teal), 0.9);
  fill.position.set(14, 10, -12);
  scene.add(fill);
  const fill2 = new THREE.DirectionalLight(new THREE.Color('#e8a13a'), 0.45);
  fill2.position.set(0, 12, 14);
  scene.add(fill2);

  return { colliders, shootables, group, chargeMesh };
}
