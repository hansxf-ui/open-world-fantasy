import * as THREE from './vendor/three.module.js';
import { WORLD, BUDGETS } from './config.js';
import { KENNEY } from './vendor/kenney.js';
import { BLENDER_HOUSE } from './vendor/blender-house.js';
import { FANTASY_TREES } from './vendor/fantasy-trees.js';
import { buildUndergrowth } from './undergrowth.js';
import { AMBIENT, buildAmbient } from './ambient.js';
import { HOUSE_SET, HOUSE_ASSIGN } from './vendor/house-set.js';

// ---- Pure zone / terrain math (testable in Node, no DOM) ----

export function zoneAt(x, z) {
  if (z > WORLD.seaZ) return 'sea';
  if (z < WORLD.snowZ) return 'snow';
  if (z >= WORLD.shallowZ0 && z <= WORLD.seaZ) return 'beach';
  if (Math.abs(x) <= WORLD.cityHalf && Math.abs(z) <= WORLD.cityHalf) return 'city';
  if (x < WORLD.forestX) return 'forest';
  return 'desert';
}

export function waterDepth(x, z) {
  void x;
  if (z <= WORLD.shallowZ0) return 0;
  if (z >= WORLD.shallowZ1) return WORLD.shallowDepth;
  return ((z - WORLD.shallowZ0) / (WORLD.shallowZ1 - WORLD.shallowZ0)) * WORLD.shallowDepth;
}

export function groundHeight(x, z) {
  let h = 2 * Math.sin(x * 0.02) * Math.cos(z * 0.02);
  if (z < -140) {
    const t = Math.min(1, (-140 - z) / 60);
    h += t * t * (3 - 2 * t) * 12;
  }
  if (z > 110) {
    // Sea floor tapers below the waterline (y = 0.35): smoothstep from
    // the shoreline down to -1 m at z = 140, so no sand pokes through
    // the sea plane and there is no cliff at the shore.
    const u = Math.min(1, (z - 110) / 30);
    const t = u * u * (3 - 2 * u);
    h = h * (1 - t) + -1 * t;
  }
  // The city is flat. The old sine hills ran under the city too, so
  // every 3 m curb box stepped up or down from its neighbour and the
  // road edge read as teeth, and buildings floated or sank on their
  // plots. Flat out to 48 m (past the outermost plots at 42 + 5 m
  // half-width), then a smoothstep blend back to the natural hills
  // over 48-58 m so there is no cliff at the edge.
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m < 48) return 0;
  if (m >= 58) return h;
  const t = (m - 48) / 10;
  return h * t * t * (3 - 2 * t);
}

// Deterministic pseudo-random so the world layout is stable per load.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Canvas textures (browser only, called from buildWorld) ----

// Ground paint layers in world coordinates, lowest priority first:
// later layers paint over earlier ones. The order mirrors zoneAt's
// priority (sea has its own plane, so it needs no paint): snow must
// come AFTER forest/desert, otherwise the two north corners
// (x < -45 / x > 45, z < -120) read as forest/desert instead of snow.
// City paints last so it sits on top. No painted street lines:
// streets are real 3D ribbons now, and painted lines at different
// positions would clash with them.
export const GROUND_LAYERS = [
  { color: '#e0c8a0', x0: -200, x1: 200, z0: -200, z1: 200 }, // base sand
  { color: '#a8c3a0', x0: -200, x1: -45, z0: -200, z1: 200 }, // forest (west)
  { color: '#f2d98c', x0: 45, x1: 200, z0: -200, z1: 200 }, // desert (east)
  { color: '#fff4e8', x0: -200, x1: 200, z0: -200, z1: -120 }, // snow (north)
  { color: '#e8d0a0', x0: -200, x1: 200, z0: 110, z1: 200 }, // beach (south, under the sea plane)
  { color: '#e8c9a0', x0: -45, x1: 45, z0: -45, z1: 45 }, // city plaza (center)
];

// Pure mirror of the canvas paint: the color the ground texture shows
// at a world point (last covering layer wins, half-open intervals like
// fillRect). Testable in Node; groundTexture() paints this same list.
export function groundColorAt(x, z) {
  let color = null;
  for (const l of GROUND_LAYERS) {
    if (x >= l.x0 && x < l.x1 && z >= l.z0 && z < l.z1) color = l.color;
  }
  return color;
}

function groundTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  const px = (wx) => ((wx + 200) / 400) * S; // world x/z -> canvas px (canvas top = north, z = -200)
  for (const l of GROUND_LAYERS) {
    ctx.fillStyle = l.color;
    ctx.fillRect(px(l.x0), px(l.z0), px(l.x1) - px(l.x0), px(l.z1) - px(l.z0));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Merged vertex-color geometry (real 3D detail, 1 draw call) ----
// A box with painted windows reads flat because the windows have no
// depth. Buildings below merge real geometry (body + roof + proud
// window/door boxes) into ONE geometry with vertex colors, so each
// building stays a single draw call while its details catch light and
// show parallax when the camera orbits.
function paintBox(w, h, d, color, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return { geo: g, color };
}

function mergeParts(parts) {
  let total = 0;
  const geos = parts.map(({ geo, color }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    total += n;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---- Baked Kenney geometry (Nature Kit, CC0) ----
// The bake script (scripts/bake-kenney.py) converts each untextured GLB
// into indexed position/normal/color arrays; material colors become
// vertex colors, so the runtime needs no GLTFLoader and no textures.
// Models sink 0.05 below their origin, so placement adds 0.05 x scale.
function kenneyGeometry(entry) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(entry.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(entry.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(entry.col, 3));
  geo.setIndex(entry.index);
  return geo;
}

// ---- Scene build ----

export function buildWorld(scene) {
  const updaters = [];
  const cullables = []; // city meshes, distance-culled by main.js
  const colliders = { rects: [], circles: [] }; // solid objects: buildings + props

  // Ground with gentle height displacement.
  const groundGeo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 64, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ map: groundTexture() })
  );
  scene.add(ground);

  // Sea plane (south).
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, 90),
    new THREE.MeshLambertMaterial({ color: 0x7ec8d8, transparent: true, opacity: 0.8 })
  );
  sea.userData.isSea = true;
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.35, 155);
  scene.add(sea);

  const dummy = new THREE.Object3D();
  function scatter(mesh, count, place) {
    for (let i = 0; i < count; i++) {
      const p = place(i);
      if (!p) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot || 0, 0);
      dummy.scale.setScalar(p.s || 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(mesh.count, dummy.matrix);
      mesh.count++;
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }

  const rand = mulberry32(42);

  // Kenney vegetation helpers: one InstancedMesh per model variant,
  // spots cycle through variants, instance scale = variant base x the
  // spot's random factor, base resting on the ground.
  const kenneyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function kenneyMeshes(specs, capacity) {
    return specs.map(({ name, entry, base }) => {
      const m = new THREE.InstancedMesh(kenneyGeometry(entry), kenneyMat, capacity);
      m.count = 0;
      m.userData.kenney = name;
      m.userData.kenneyBase = base;
      return m;
    });
  }
  function scatterKenney(meshes, count, place) {
    // place(i) -> { x, z, s, rot } (s = random factor); colliders are
    // pushed by place() exactly once per spot, as before.
    const written = meshes.map(() => 0);
    for (let i = 0; i < count; i++) {
      const p = place(i);
      if (!p) continue;
      const vi = i % meshes.length;
      const mesh = meshes[vi];
      const scale = mesh.userData.kenneyBase * p.s;
      dummy.position.set(p.x, groundHeight(p.x, p.z) + 0.05 * scale, p.z);
      dummy.rotation.set(0, p.rot || 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(written[vi]++, dummy.matrix);
    }
    meshes.forEach((m, vi) => {
      m.count = written[vi];
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    });
  }

  // Blender fantasy trees: same instancing pattern as Kenney, but
  // models stand on y=0 exactly (no 0.05 sink — Kenney models sank
  // 0.05 below their origin) and carry userData.veg instead of
  // userData.kenney.
  const vegMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  function vegMeshes(specs, capacity) {
    return specs.map(({ name, entry, base }) => {
      const m = new THREE.InstancedMesh(kenneyGeometry(entry), vegMat, capacity);
      m.count = 0;
      m.userData.veg = name;
      m.userData.vegBase = base;
      return m;
    });
  }
  function scatterVeg(meshes, count, place) {
    const written = meshes.map(() => 0);
    for (let i = 0; i < count; i++) {
      const p = place(i);
      if (!p) continue;
      const vi = i % meshes.length;
      const mesh = meshes[vi];
      const scale = mesh.userData.vegBase * p.s;
      dummy.position.set(p.x, groundHeight(p.x, p.z), p.z);
      dummy.rotation.set(0, p.rot || 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(written[vi]++, dummy.matrix);
    }
    meshes.forEach((m, vi) => {
      m.count = written[vi];
      m.instanceMatrix.needsUpdate = true;
      scene.add(m);
    });
  }

  // Forest trees: Blender fantasy models (stage 1) instead of Kenney.
  // Same 130 spots, same rand consumption (x, z, s, rot per spot), so
  // every placement after this block is identical to before. Models
  // are built at final size (base 1.0); the ancient trunk base radius
  // 0.30 matches the 0.3*s circle collider exactly. Spots are kept
  // for the mushroom clusters (shady spots near trees).
  const forestTreeSpots = [];
  const forestTrees = vegMeshes([
    { name: 'ancient', entry: FANTASY_TREES.ancient, base: 1.0 },
    { name: 'bloom', entry: FANTASY_TREES.bloom, base: 1.0 },
    { name: 'birch', entry: FANTASY_TREES.birch, base: 1.0 },
  ], 44);
  scatterVeg(forestTrees, 130, () => {
    const x = -195 + rand() * 145;
    const z = -115 + rand() * 230;
    const s = 0.8 + rand() * 0.7;
    colliders.circles.push({ x, z, r: 0.3 * s });
    forestTreeSpots.push([x, z]);
    return { x, z, s, rot: rand() * Math.PI * 2 };
  });

  // Desert rocks + cacti: Kenney models, one mesh per rock/cactus
  // (no more assembled cylinders for saguaros — the models have arms).
  const desertRocks = kenneyMeshes([
    { name: 'rockLarge', entry: KENNEY.rockLarge, base: 1.8 },
    { name: 'rockSmall', entry: KENNEY.rockSmall, base: 1.8 },
  ], 30);
  scatterKenney(desertRocks, 60, () => {
    const x = 50 + rand() * 145;
    const z = -115 + rand() * 230;
    const s = 0.5 + rand() * 1.0;
    colliders.circles.push({ x, z, r: 0.9 * s });
    return { x, z, s, rot: rand() * Math.PI * 2 };
  });
  const cacti = kenneyMeshes([
    { name: 'cactusTall', entry: KENNEY.cactusTall, base: 2.6 },
    { name: 'cactusShort', entry: KENNEY.cactusShort, base: 2.6 },
  ], 20);
  scatterKenney(cacti, 40, () => {
    const x = 50 + rand() * 145;
    const z = -115 + rand() * 230;
    const s = 0.8 + rand() * 0.8;
    colliders.circles.push({ x, z, r: 0.4 * s });
    return { x, z, s, rot: rand() * Math.PI * 2 };
  });

  // Snow pines: one Blender fantasy pine (teal tiers + snow cap)
  // replacing both Kenney pine variants at the same 100 spots.
  const snowPines = vegMeshes([
    { name: 'pine', entry: FANTASY_TREES.pine, base: 1.0 },
  ], 100);
  scatterVeg(snowPines, 100, () => {
    const x = -195 + rand() * 390;
    const z = -195 + rand() * 70;
    const s = 0.8 + rand() * 0.7;
    colliders.circles.push({ x, z, r: 0.4 * s });
    return { x, z, s, rot: rand() * Math.PI * 2 };
  });

  // City buildings: the Blender sample (plot 0,-14, kept as the
  // judged reference) plus the 13-model Blender house set instanced
  // over the other 47 plots. Each model splits into three meshes
  // (walls / roof / details): walls and roof carry white vertex
  // colours and take a per-plot tint via instanceColor, details
  // carry their modelled colours. One model per plot would cost 47
  // draw calls and ~103k tris of unique geometry; instancing costs
  // 39 calls and ~30k tris, and the per-plot tint + scale + a
  // neighbour-contrast rule in the bake keep no two adjacent plots
  // sharing model + wall colour. Instanced meshes sit at the origin
  // with plot positions in their instance matrices, so distance
  // culling (camera-to-origin) hides the whole set together when the
  // player is far from the city and shows it in the city.
  const cityMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Sample Blender house (walker scale, modeled in meters):
  // keeps plot (0,-14) directly ahead of spawn. Collider: hw covers
  // the bay (x 4.04); hd 2.8 covers the flower boxes (2.77) but NOT
  // the awning overhang, or the collider would stop the player
  // before they can reach the door. The stepping-stone path stays
  // walkable (no collider).
  const sm = new THREE.Mesh(kenneyGeometry(BLENDER_HOUSE), cityMat);
  sm.userData.isBuilding = true;
  sm.userData.isSample = true;
  colliders.rects.push({ x: 0, z: -14, hw: 4.1, hd: 2.8 });
  sm.position.set(0, groundHeight(0, -14), -14);
  scene.add(sm);
  cullables.push(sm);
  // The sample's bushes are part of its mesh, so they get their
  // own circle colliders here (bush centres at plot-relative
  // (±2.0, +3.15)); the door approach at x = 0 stays clear
  // between them.
  colliders.circles.push({ x: 0 - 2.0, z: -14 + 3.15, r: 0.45 });
  colliders.circles.push({ x: 0 + 2.0, z: -14 + 3.15, r: 0.45 });

  // House set: one InstancedMesh per model per part, sized by use
  // count so no capacity is wasted.
  const uses = new Map();
  for (const a of HOUSE_ASSIGN) uses.set(a.model, (uses.get(a.model) || 0) + 1);
  const partMats = {
    walls: new THREE.MeshLambertMaterial({ vertexColors: true }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true }),
    details: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };
  const houseMeshes = new Map();
  const nextIdx = new Map();
  const houseDummy = new THREE.Object3D();
  for (const a of HOUSE_ASSIGN) {
    const model = HOUSE_SET.models[a.model];
    for (const part of ['walls', 'roof', 'details']) {
      const key = `${model.name}-${part}`;
      let mesh = houseMeshes.get(key);
      if (!mesh) {
        mesh = new THREE.InstancedMesh(
          kenneyGeometry(model[part]), partMats[part], uses.get(a.model));
        mesh.userData.isBuilding = true;
        mesh.userData.part = part;
        if (model.type === 'shop') mesh.userData.isShop = true;
        if (model.type === 'tall') mesh.userData.isTower = true;
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        scene.add(mesh);
        cullables.push(mesh);
        houseMeshes.set(key, mesh);
        nextIdx.set(key, 0);
      }
      const idx = nextIdx.get(key);
      nextIdx.set(key, idx + 1);
      houseDummy.position.set(a.x, groundHeight(a.x, a.z), a.z);
      houseDummy.scale.setScalar(a.s);
      houseDummy.rotation.set(0, 0, 0);
      houseDummy.updateMatrix();
      mesh.setMatrixAt(idx, houseDummy.matrix);
      if (part !== 'details') {
        mesh.setColorAt(idx, new THREE.Color(part === 'walls' ? a.wallTint : a.roofTint));
      }
    }
    colliders.rects.push({ x: a.x, z: a.z, hw: model.hw * a.s, hd: model.hd * a.s });
  }
  for (const mesh of houseMeshes.values()) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // City streets: asphalt ribbons following the terrain, one merged
  // mesh. Streets run down the gaps between plots (lines -35..35 step
  // 14); the plaza center stays open. No colliders: streets are
  // walkable, 0.06 above ground so feet barely sink. Raised concrete
  // curbs run along both edges of every street, merged into the same
  // mesh (+0 draw calls): without them the asphalt reads as paint
  // from the low third-person camera — the curb's vertical face is
  // what makes the road look 3D.
  {
    const asphalt = new THREE.Color(0x6a655e);
    const pos = [];
    const col = [];
    const idx = [];
    const HALF = 1.75;
    const STATIONS = 31; // -45..45 step 3
    function addStreet(fixed, horizontal) {
      const base = pos.length / 3;
      for (let s = -45; s <= 45; s += 3) {
        // Edge order is chosen so both orientations wind +y (up).
        const a = horizontal ? [s, fixed - HALF] : [fixed + HALF, s];
        const bb = horizontal ? [s, fixed + HALF] : [fixed - HALF, s];
        pos.push(a[0], groundHeight(a[0], a[1]) + 0.06, a[1]);
        pos.push(bb[0], groundHeight(bb[0], bb[1]) + 0.06, bb[1]);
        col.push(asphalt.r, asphalt.g, asphalt.b, asphalt.r, asphalt.g, asphalt.b);
      }
      for (let i = 0; i < STATIONS - 1; i++) {
        const v = base + i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    for (const l of [-35, -21, -7, 7, 21, 35]) {
      addStreet(l, true);
      addStreet(l, false);
    }
    // Curbs: one axis-aligned box per 3 m segment per side, flush
    // with the street edge (1.75) and 0.3 wide, 0.15 tall, sitting on
    // the terrain at the segment center.
    const curbCol = new THREE.Color(0x8a857e);
    const CURB_H = 0.15;
    const CURB_W = 0.3;
    function addCurbBox(cx, cy, cz, w, d) {
      const g = new THREE.BoxGeometry(w, CURB_H, d);
      g.translate(cx, cy, cz);
      const base = pos.length / 3;
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i++) pos.push(p[i]);
      for (let i = 0; i < p.length / 3; i++) col.push(curbCol.r, curbCol.g, curbCol.b);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx.push(base + gi[i]);
    }
    for (const l of [-35, -21, -7, 7, 21, 35]) {
      for (let s = -45; s < 45; s += 3) {
        const mid = s + 1.5;
        addCurbBox(mid, groundHeight(mid, l - 1.9) + CURB_H / 2, l - 1.9, 3.0, CURB_W);
        addCurbBox(mid, groundHeight(mid, l + 1.9) + CURB_H / 2, l + 1.9, 3.0, CURB_W);
        addCurbBox(l - 1.9, groundHeight(l - 1.9, mid) + CURB_H / 2, mid, CURB_W, 3.0);
        addCurbBox(l + 1.9, groundHeight(l + 1.9, mid) + CURB_H / 2, mid, CURB_W, 3.0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const streets = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    streets.userData.isStreet = true;
    scene.add(streets);
  }

  // Plaza medallion: concentric mosaic rings at the spawn plaza,
  // following the terrain. Radius 5 stops short of the ±7 streets
  // (their inner edge is 5.25), so nothing z-fights. Walkable, no
  // collider — a flat pattern, not a platform. Index order winds +y.
  {
    const cream = new THREE.Color(0xe8c9a0);
    const terra = new THREE.Color(0xb08060);
    const pos = [];
    const col = [];
    const idx = [];
    const SEG = 24;
    function ring(r, c) {
      const base = pos.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        pos.push(x, groundHeight(x, z) + 0.06, z);
        col.push(c.r, c.g, c.b);
      }
      return base;
    }
    const bands = [[0, 1.7, cream], [1.7, 3.4, terra], [3.4, 5.0, cream]];
    bands.forEach(([r0, r1, c]) => {
      if (r0 === 0) {
        pos.push(0, groundHeight(0, 0) + 0.06, 0);
        col.push(c.r, c.g, c.b);
        const center = pos.length / 3 - 1;
        const outer = ring(r1, c);
        for (let i = 0; i < SEG; i++) {
          idx.push(center, outer + i + 1, outer + i);
        }
      } else {
        const inner = ring(r0, c);
        const outer = ring(r1, c);
        for (let i = 0; i < SEG; i++) {
          const a = inner + i;
          const b2 = outer + i;
          idx.push(a, a + 1, b2, b2, a + 1, b2 + 1);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const medallion = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    medallion.userData.isMedallion = true;
    scene.add(medallion);
  }

  // City + zone props: real geometry scattered around, so the world
  // reads 3D even where the player just walks (5 extra draw calls).
  const benchGeo = mergeParts([
    paintBox(1.8, 0.12, 0.5, 0xa08050, 0, 0.45, 0),
    paintBox(0.12, 0.45, 0.45, 0x6b4a30, -0.8, 0.22, 0),
    paintBox(0.12, 0.45, 0.45, 0x6b4a30, 0.8, 0.22, 0),
    paintBox(1.8, 0.5, 0.12, 0xa08050, 0, 0.75, -0.22),
  ]);
  const benches = new THREE.InstancedMesh(benchGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 4);
  benches.count = 0;
  // Plaza benches only: four on the diagonals around the medallion,
  // seats facing the centre. The old twelve sat on roads, inside
  // building footprints, or across the sample house's path. At (4,4)
  // the tangentially-oriented bench stays clear of both the
  // medallion (radius 5) and the curbs (from 4.95).
  [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(([x, z]) => {
    colliders.circles.push({ x, z, r: 1.0 });
    houseDummy.position.set(x, groundHeight(x, z), z);
    houseDummy.rotation.set(0, Math.atan2(-x, -z), 0);
    houseDummy.scale.setScalar(1);
    houseDummy.updateMatrix();
    benches.setMatrixAt(benches.count++, houseDummy.matrix);
  });
  benches.instanceMatrix.needsUpdate = true;
  scene.add(benches);
  const lampGeo = mergeParts([
    { geo: new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6).translate(0, 1.3, 0), color: 0x4a4a4a },
    { geo: new THREE.SphereGeometry(0.28, 8, 6).translate(0, 2.75, 0), color: 0xffd98a },
  ]);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 4);
  lamps.count = 0;
  // Street lamps stand on the curbs ringing the plaza (the old eight
  // sat dead-centre on building plots, hidden inside houses). The
  // +0.15 lifts the post onto the curb top instead of sinking into it.
  [[5.1, 0], [-5.1, 0], [0, 5.1], [0, -5.1]].forEach(([x, z]) => {
    colliders.circles.push({ x, z, r: 0.25 });
    houseDummy.position.set(x, groundHeight(x, z) + 0.15, z);
    houseDummy.rotation.set(0, 0, 0);
    houseDummy.scale.setScalar(1);
    houseDummy.updateMatrix();
    lamps.setMatrixAt(lamps.count++, houseDummy.matrix);
  });
  lamps.instanceMatrix.needsUpdate = true;
  scene.add(lamps);
  const bushes = kenneyMeshes([{ name: 'bush', entry: KENNEY.bush, base: 3.5 }], 40);
  scatterKenney(bushes, 40, () => {
    const x = -195 + rand() * 145;
    const z = -115 + rand() * 230;
    const s = 0.6 + rand() * 0.8;
    colliders.circles.push({ x, z, r: 0.7 * s });
    return { x, z, s, rot: rand() * Math.PI * 2 };
  });
  const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.4, 0), new THREE.MeshLambertMaterial({ color: 0xcbb890 }), 40);
  pebbles.count = 0;
  scatter(pebbles, 40, () => {
    const x = 50 + rand() * 145;
    const z = -115 + rand() * 230;
    const s = 0.5 + rand() * 1.0;
    colliders.circles.push({ x, z, r: 0.4 * s });
    return { x, z, y: groundHeight(x, z) + 0.2 * s, s, rot: rand() * Math.PI * 2 };
  });
  const mounds = new THREE.InstancedMesh(new THREE.SphereGeometry(1.0, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), 30);
  mounds.count = 0;
  scatter(mounds, 30, () => {
    const x = -195 + rand() * 390;
    const z = -195 + rand() * 70;
    const s = 0.8 + rand() * 1.2;
    colliders.circles.push({ x, z, r: 1.0 * s });
    return { x, z, y: groundHeight(x, z) + 0.2 * s, s, rot: 0 };
  });

  // Fantasy undergrowth (stage 1): grass, glowing mushrooms, flowers.
  // Own seeded rand inside; the main rand stream is untouched.
  const ug = buildUndergrowth(scene, { rects: colliders.rects, forestTreeSpots, groundHeight });

  // Stage 2 ambient life (fireflies, butterflies, pollen): own
  // module, own rand stream; its updaters join the world's.
  const ambient = buildAmbient(scene, {
    forestTreeSpots, flowerSpots: ug.flowerSpots, groundHeight, zoneAt,
  });
  updaters.push(...ambient.updaters);

  // Zone particles: snow / dust / leaves. Rebalanced 100 -> 70 each
  // in stage 2 so fireflies (50) + pollen (40) keep the grand total
  // at BUDGETS.particles (300). Leaves get per-point green/yellow
  // tints (same object, same count) so the drifting canopy reads
  // less uniform; snow and dust keep their single colour.
  function makeParticles(color, count, tints) {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 120;
      arr[i * 3 + 1] = rand() * 12;
      arr[i * 3 + 2] = (rand() - 0.5) * 120;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.45, transparent: true, opacity: 0.85, depthWrite: false });
    if (tints) {
      mat.vertexColors = true;
      mat.color.set(0xffffff);
      const col = new Float32Array(count * 3);
      const tc = new THREE.Color();
      for (let i = 0; i < count; i++) {
        tc.set(tints[i % tints.length]);
        col[i * 3] = tc.r;
        col[i * 3 + 1] = tc.g;
        col[i * 3 + 2] = tc.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  }
  const snowPts = makeParticles(0xffffff, AMBIENT.snow);
  const dustPts = makeParticles(0xe8d0a0, AMBIENT.desert);
  const leafPts = makeParticles(0x7fb069, AMBIENT.forestLeaves,
    ['#7fb069', '#9ac07a', '#6a9a4a', '#a0c060']);
  const particleSets = [
    { pts: snowPts, zone: 'snow', fall: 1.2 },
    { pts: dustPts, zone: 'desert', fall: 0.4 },
    { pts: leafPts, zone: 'forest', fall: 0.8 },
  ];
  for (const s of particleSets) s.pts.userData.zoneParticle = s.zone;
  updaters.push((dt, camera) => {
    const zone = zoneAt(camera.position.x, camera.position.z);
    for (const s of particleSets) {
      s.pts.visible = s.zone === zone;
      if (!s.pts.visible) continue;
      s.pts.position.set(camera.position.x, 0, camera.position.z);
      const arr = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= s.fall * dt;
        arr[i] += Math.sin(arr[i + 1] * 0.5) * dt * 0.3;
        if (arr[i + 1] < 0) arr[i + 1] = 12;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
    }
  });

  // Sea shimmer (stage 2): slow opacity pulse on the existing sea
  // material — 0 new draw calls, no geometry motion (no z-fight
  // risk with the beach underneath).
  let seaT = 0;
  updaters.push((dt) => {
    seaT += dt;
    sea.material.opacity = 0.8 + 0.06 * Math.sin(seaT * 0.8);
  });

  return { updaters, cullables, colliders };
}
