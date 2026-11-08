// Fantasy undergrowth (stage 1: the game comes alive): grass tufts,
// glowing mushrooms, and small flowers. All instanced, all walkable
// (no colliders), all placed by a dedicated seeded rand so the main
// world's rand stream — and everything after it — is untouched.
//
// Placement rules (enforced by isClearSpot, unit-tested in
// tests/world.test.mjs):
// - never on a road strip (lines +-7/+-21/+-35, half-width 2.05 m),
// - never inside a house plot rect (plus a 0.3 m margin),
// - never on the plaza medallion (r 5.5 m) or the plaza block itself,
// - mushrooms cluster near forest trees (shady spots), flowers sit
//   next to grass tufts.
import * as THREE from './vendor/three.module.js';

export const ROAD_LINES = [-35, -21, -7, 7, 21, 35];

export function isClearSpot(x, z, rects) {
  for (const L of ROAD_LINES) {
    if (Math.abs(x - L) < 2.05 || Math.abs(z - L) < 2.05) return false;
  }
  for (const r of rects) {
    if (Math.abs(x - r.x) < r.hw + 0.3 && Math.abs(z - r.z) < r.hd + 0.3) return false;
  }
  if (Math.hypot(x, z) < 5.5) return false;
  if (Math.abs(x) < 14 && Math.abs(z) < 14) return false;
  return true;
}

// Deterministic pseudo-random, same algorithm as world.js
// (mulberry32) but its own stream, seeded for undergrowth only.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coloredGeometry(pos, nor, col, index) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  return geo;
}

// Grass tuft: two crossed tapered blades, 4 tris. Vertex colours
// run dark at the base to light at the tip; per-tuft tint comes from
// instanceColor. DoubleSide: the camera orbits, thin quads must read
// from every angle.
export function grassGeometry() {
  const pos = [
    -0.28, 0, 0, 0.28, 0, 0, 0.06, 0.65, 0, -0.06, 0.65, 0,
    0, 0, -0.28, 0, 0, 0.28, 0, 0.65, 0.06, 0, 0.65, -0.06,
  ];
  const nor = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ];
  const dark = [0.15, 0.35, 0.12];
  const light = [0.45, 0.75, 0.3];
  const col = [...dark, ...dark, ...light, ...light, ...dark, ...dark, ...light, ...light];
  return coloredGeometry(pos, nor, col, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
}

// Mushroom: cap and stem share one instance matrix (offsets are baked
// into the geometries). Caps use an unlit material at runtime so they
// glow without any new light (the game has no dynamic shadows).
// The cap is a custom cone (10 side tris + 10 base fan tris = 20):
// THREE.ConeGeometry would add 10 degenerate apex tris (its top row
// collapses to a point but still emits both halves of every quad).
export function mushroomGeometries() {
  const segs = 10;
  const r = 0.32;
  const yBase = 0.25;
  const yApex = 0.55;
  const pos = [0, yApex, 0, 0, yBase, 0];
  const nor = [0, 1, 0, 0, -1, 0];
  const col = [1, 1, 1, 1, 1, 1];
  const index = [];
  const h = yApex - yBase;
  const hyp = Math.hypot(r, h);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    pos.push(x, yBase, z);
    // Outward cone normal: radial part h/hyp, vertical part r/hyp.
    nor.push((x / r) * (h / hyp), r / hyp, (z / r) * (h / hyp));
    col.push(1, 1, 1);
    const b = 2 + i;
    const b2 = 2 + ((i + 1) % segs);
    index.push(0, b2, b); // side: apex, next base, base
    index.push(1, b, b2); // base fan: centre, base, next base
  }
  const cap = coloredGeometry(pos, nor, col, index);
  const stem = new THREE.CylinderGeometry(0.05, 0.09, 0.35, 6, 1, true);
  stem.translate(0, 0.175, 0);
  return { cap, stem };
}

// Flower: two small crossed quads, 4 tris, white vertex colours so
// the instanceColor is the petal colour. DoubleSide like grass.
export function flowerGeometry() {
  const pos = [
    -0.15, 0.05, 0, 0.15, 0.05, 0, 0.15, 0.4, 0, -0.15, 0.4, 0,
    0, 0.05, -0.15, 0, 0.05, 0.15, 0, 0.4, 0.15, 0, 0.4, -0.15,
  ];
  const nor = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ];
  const col = new Array(24).fill(1);
  return coloredGeometry(pos, nor, col, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
}

const GRASS_TINTS = ['#6a9a4a', '#7fb069', '#5a8a3a', '#a0c060', '#4a7a30'];
const CAP_TINTS = ['#5ae0c0', '#c080ff', '#7ee0ff', '#a0ff70'];
const FLOWER_TINTS = ['#ff8ab0', '#ffd11a', '#ffffff', '#c080ff', '#ff6a6a'];

export function buildUndergrowth(scene, { rects, forestTreeSpots, groundHeight }) {
  const rand = mulberry32(20261025);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // Grass candidates: forest floor, city-edge ring, meadow strips.
  // Every candidate passes isClearSpot; the zones already avoid roads
  // and plots, so the filter is a guarantee, not a hope.
  const candidates = [];
  for (let i = 0; i < 1300; i++) {
    candidates.push([-195 + rand() * 145, -115 + rand() * 230]);
  }
  for (let i = 0; i < 450; i++) {
    const sign = rand() < 0.5 ? -1 : 1;
    if (rand() < 0.5) candidates.push([sign * (48 + rand() * 12), -60 + rand() * 120]);
    else candidates.push([-60 + rand() * 120, sign * (48 + rand() * 12)]);
  }
  for (let i = 0; i < 450; i++) {
    if (rand() < 0.5) candidates.push([-45 + rand() * 90, -115 + rand() * 55]);
    else candidates.push([-45 + rand() * 90, 60 + rand() * 45]);
  }
  const grassSpots = [];
  for (const [x, z] of candidates) {
    if (isClearSpot(x, z, rects)) grassSpots.push([x, z]);
  }
  const grass = new THREE.InstancedMesh(
    grassGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    grassSpots.length);
  grass.userData.veg = 'grass';
  grassSpots.forEach(([x, z], i) => {
    dummy.position.set(x, groundHeight(x, z), z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(0.7 + rand() * 0.6);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    grass.setColorAt(i, tint.set(GRASS_TINTS[Math.floor(rand() * GRASS_TINTS.length)]));
  });
  grass.instanceColor.needsUpdate = true;
  scene.add(grass);

  // Mushrooms: 15 clusters of 7 around forest tree spots (shade).
  const { cap, stem } = mushroomGeometries();
  const shroomSpots = [];
  const clusterIdx = [];
  for (let k = 0; k < 15; k++) clusterIdx.push(k * 9);
  for (const ci of clusterIdx) {
    const [cx, cz] = forestTreeSpots[ci];
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * Math.PI * 2 + rand() * 0.5;
      const r = 0.4 + rand() * 0.8;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (isClearSpot(x, z, rects)) shroomSpots.push([x, z]);
    }
  }
  const shroomCap = new THREE.InstancedMesh(
    cap, new THREE.MeshBasicMaterial({ vertexColors: true }), shroomSpots.length);
  shroomCap.userData.veg = 'shroomCap';
  const shroomStem = new THREE.InstancedMesh(
    stem, new THREE.MeshLambertMaterial({ color: 0xfff2dd }), shroomSpots.length);
  shroomStem.userData.veg = 'shroomStem';
  shroomSpots.forEach(([x, z], i) => {
    dummy.position.set(x, groundHeight(x, z), z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(0.7 + rand() * 0.6);
    dummy.updateMatrix();
    shroomCap.setMatrixAt(i, dummy.matrix);
    shroomStem.setMatrixAt(i, dummy.matrix);
    shroomCap.setColorAt(i, tint.set(CAP_TINTS[Math.floor(rand() * CAP_TINTS.length)]));
  });
  shroomCap.instanceColor.needsUpdate = true;
  scene.add(shroomCap);
  scene.add(shroomStem);

  // Flowers: every 7th grass tuft, nudged a little, still clear.
  const flowerSpots = [];
  for (let i = 0; i < grassSpots.length; i += 7) {
    const [gx, gz] = grassSpots[i];
    const x = gx + (rand() - 0.5) * 1.0;
    const z = gz + (rand() - 0.5) * 1.0;
    if (isClearSpot(x, z, rects)) flowerSpots.push([x, z]);
  }
  const flowers = new THREE.InstancedMesh(
    flowerGeometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    flowerSpots.length);
  flowers.userData.veg = 'flower';
  flowerSpots.forEach(([x, z], i) => {
    dummy.position.set(x, groundHeight(x, z), z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(0.8 + rand() * 0.5);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, tint.set(FLOWER_TINTS[Math.floor(rand() * FLOWER_TINTS.length)]));
  });
  flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);

  return {
    grass, shroomCap, shroomStem, flowers,
    counts: { grass: grassSpots.length, mushrooms: shroomSpots.length, flowers: flowerSpots.length },
    grassSpots, shroomSpots, flowerSpots,
  };
}
