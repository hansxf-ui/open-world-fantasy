// Per-house measurement audit for the Blender house set.
// Checks every plot (not just totals): rect presence, street and
// neighbour clearance, neighbour colour contrast, geometry sanity
// (no NaN / degenerate triangles / out-of-range indices), instance
// counts, and the sample + marker state. Exits non-zero on failure.
import * as THREE from '../js/vendor/three.module.js';
import { buildWorld } from '../js/world.js';
import { HOUSE_SET, HOUSE_ASSIGN } from '../js/vendor/house-set.js';

globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error('only canvas is stubbed');
    return {
      width: 0,
      height: 0,
      getContext: () => new Proxy({}, { get: () => () => {} }),
    };
  },
  createElementNS: () => ({ addEventListener() {} }),
};

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

const scene = new THREE.Scene();
const { colliders } = buildWorld(scene);

// 1. One rect per plot: the 7x7 grid minus the plaza (0,0).
const plots = [];
for (let gx = -42; gx <= 42; gx += 14) {
  for (let gz = -42; gz <= 42; gz += 14) {
    if (gx === 0 && gz === 0) continue;
    plots.push([gx, gz]);
  }
}
check(colliders.rects.length === 48, `48 rects (got ${colliders.rects.length})`);
const byPlot = new Map(colliders.rects.map((r) => [`${r.x},${r.z}`, r]));
const missing = plots.filter(([gx, gz]) => !byPlot.has(`${gx},${gz}`));
check(missing.length === 0, `every plot has a rect (missing: ${missing.join(' ') || 'none'})`);

// 2. Footprints within the curb-safe limits.
const oversize = colliders.rects.filter((r) => r.hw > 4.8 || r.hd > 4.8);
check(oversize.length === 0, `all rects hw<=4.8, hd<=4.8 (oversize: ${oversize.length})`);

// 3. No rect reaches a street zone (lines +-7,+-21,+-35, half-width 2.05).
const lines = [-35, -21, -7, 7, 21, 35];
const streetHits = [];
for (const r of colliders.rects) {
  for (const L of lines) {
    if (r.x - r.hw < L + 2.05 && r.x + r.hw > L - 2.05) streetHits.push(`${r.x},${r.z} x-line ${L}`);
    if (r.z - r.hd < L + 2.05 && r.z + r.hd > L - 2.05) streetHits.push(`${r.x},${r.z} z-line ${L}`);
  }
}
check(streetHits.length === 0, `no rect in a street zone (hits: ${streetHits.slice(0, 5).join('; ') || 'none'})`);

// 4. No two rects overlap.
let overlaps = 0;
for (let i = 0; i < colliders.rects.length; i++) {
  for (let j = i + 1; j < colliders.rects.length; j++) {
    const a = colliders.rects[i], b = colliders.rects[j];
    if (Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.z - b.z) < a.hd + b.hd) overlaps++;
  }
}
check(overlaps === 0, `no overlapping rects (pairs: ${overlaps})`);

// 5. Neighbour contrast: no 4-dir neighbour shares model + wall tint.
const assignByPlot = new Map(HOUSE_ASSIGN.map((a) => [`${a.x},${a.z}`, a]));
let clashes = 0;
for (const a of HOUSE_ASSIGN) {
  for (const [dx, dz] of [[-14, 0], [14, 0], [0, -14], [0, 14]]) {
    const n = assignByPlot.get(`${a.x + dx},${a.z + dz}`);
    if (n && n.model === a.model && n.wallTint === a.wallTint) clashes++;
  }
}
check(clashes === 0, `no neighbour shares model + wall tint (clashes: ${clashes})`);
const modelUses = new Map();
for (const a of HOUSE_ASSIGN) modelUses.set(a.model, (modelUses.get(a.model) || 0) + 1);
const maxUses = Math.max(...modelUses.values());
const minUses = Math.min(...modelUses.values());
check(maxUses <= 6, `balanced model use (min ${minUses}, max ${maxUses} per model)`);

// 6. Geometry sanity per model part + door on the +Z front.
const DOOR = [0.420, 0.259, 0.149];
for (const m of HOUSE_SET.models) {
  for (const part of ['walls', 'roof', 'details']) {
    const g = m[part];
    const pos = g.pos, nor = g.nor, col = g.col, idx = g.index;
    let nan = 0;
    for (const v of [...pos, ...nor, ...col]) if (!Number.isFinite(v)) nan++;
    let degen = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
      if (a >= pos.length / 3 || b >= pos.length / 3 || c >= pos.length / 3) degen++;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (area2 < 1e-9) degen++;
    }
    check(nan === 0 && degen === 0, `${m.name}/${part}: no NaN, no degenerate tris (nan ${nan}, degen ${degen})`);
    if (part === 'details') {
      let minZ = Infinity;
      for (let v = 0; v < pos.length / 3; v++) {
        if (Math.abs(col[v * 3] - DOOR[0]) < 0.02 && Math.abs(col[v * 3 + 1] - DOOR[1]) < 0.02
          && Math.abs(col[v * 3 + 2] - DOOR[2]) < 0.02) minZ = Math.min(minZ, pos[v * 3 + 2]);
      }
      check(minZ > 0, `${m.name}: door-coloured verts on +Z front (min z ${minZ.toFixed(2)})`);
    }
  }
}

// 7. Sample present, no marker left, 39 instanced meshes, and the
// instance total equals 47 plots x 3 parts.
let samples = 0, markers = 0;
const houseMeshes = [];
scene.traverse((o) => {
  if (o.userData.isSample) samples++;
  if (o.userData.isSampleMarker) markers++;
  if (o.isInstancedMesh && o.userData.isBuilding) houseMeshes.push(o);
});
check(samples === 1, `exactly one sample house (got ${samples})`);
check(markers === 0, `no temporary marker left (got ${markers})`);
check(houseMeshes.length === 39, `39 instanced house meshes (got ${houseMeshes.length})`);
const totalInstances = houseMeshes.reduce((s, m) => s + m.count, 0);
check(totalInstances === 47 * 3, `141 house instances (got ${totalInstances})`);

console.log(failures.length ? `\nAUDIT-HOUSES FAIL (${failures.length})` : '\nAUDIT-HOUSES PASS');
process.exit(failures.length ? 1 : 0);
