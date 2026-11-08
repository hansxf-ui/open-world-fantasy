import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../js/vendor/three.module.js';
import { zoneAt, waterDepth, groundHeight, buildWorld, groundColorAt, GROUND_LAYERS } from '../js/world.js';
import { isClearSpot } from '../js/undergrowth.js';

test('zone priority: sea beats snow at the south edge', () => {
  assert.equal(zoneAt(0, 150), 'sea');
  assert.equal(zoneAt(0, -150), 'snow');
  assert.equal(zoneAt(0, 0), 'city');
  assert.equal(zoneAt(-100, 0), 'forest');
  assert.equal(zoneAt(100, 0), 'desert');
});

test('M2: beach strip z in [110, 120] is its own zone', () => {
  // The old label here was desert/forest while the player waded shallow
  // water over beach sand. Sea still starts above 120, and the strip
  // just north of it keeps its old zone.
  assert.equal(zoneAt(0, 115), 'beach');
  assert.equal(zoneAt(-100, 115), 'beach');
  assert.equal(zoneAt(100, 115), 'beach');
  assert.equal(zoneAt(0, 110), 'beach');
  assert.equal(zoneAt(0, 120), 'beach');
  assert.equal(zoneAt(0, 121), 'sea');
  assert.equal(zoneAt(0, 109), 'desert');
  assert.equal(zoneAt(-100, 109), 'forest');
});

test('M1: ground texture shows snow in both north corners', () => {
  // Regression guard for the old paint order (snow first, then
  // forest/desert over it): the snow layer must sit after forest and
  // desert so the corners read as snow, matching zoneAt.
  const snowIdx = GROUND_LAYERS.findIndex((l) => l.color === '#fff4e8');
  const forestIdx = GROUND_LAYERS.findIndex((l) => l.color === '#a8c3a0');
  const desertIdx = GROUND_LAYERS.findIndex((l) => l.color === '#f2d98c');
  assert.ok(snowIdx > forestIdx && snowIdx > desertIdx);
  assert.equal(groundColorAt(-100, -150), '#fff4e8');
  assert.equal(groundColorAt(100, -150), '#fff4e8');
  assert.equal(groundColorAt(0, -150), '#fff4e8');
  // Non-corner spots unchanged by the reorder.
  assert.equal(groundColorAt(-100, 0), '#a8c3a0');
  assert.equal(groundColorAt(100, 0), '#f2d98c');
  assert.equal(groundColorAt(0, 0), '#e8c9a0');
  assert.equal(groundColorAt(0, 150), '#e8d0a0');
  assert.equal(groundColorAt(-100, -100), '#a8c3a0');
});

test('shoreline: shallow then deep', () => {
  assert.ok(waterDepth(0, 115) > 0 && waterDepth(0, 115) < 0.8);
  assert.ok(waterDepth(0, 150) >= 0.8);
  assert.equal(waterDepth(0, 0), 0);
});

test('sea floor tapers below the waterline, no cliff at the shore', () => {
  assert.ok(groundHeight(0, 150) <= -1);
  assert.ok(groundHeight(0, 200) <= -1);
  // Continuous across the shoreline: no step at z = 110.
  const a = groundHeight(50, 109);
  const b = groundHeight(50, 111);
  assert.ok(Math.abs(a - b) < 0.5);
});

test('assets are real 3D geometry, not painted flats', () => {
  // Same minimal canvas stub the headless audit uses: buildWorld only
  // needs a no-op 2D context for the ground texture.
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('only canvas is stubbed');
      return {
        width: 0,
        height: 0,
        getContext: () => new Proxy({}, { get: () => () => {} }),
      };
    },
  };
  const scene = new THREE.Scene();
  const { cullables } = buildWorld(scene);
  // Buildings: the Blender sample (one merged mesh) plus the house
  // set: 13 models x 3 tinted/shared parts, instanced over 47 plots.
  // Every building mesh is vertex-colored with more vertices than a
  // bare box; walls/roof meshes carry a per-instance tint, details
  // meshes carry their modelled colours and no instance tint.
  const buildings = [];
  let instanced = 0;
  const vegTrees = [];
  const undergrowth = [];
  const ambient = [];
  const zonePts = [];
  scene.traverse((o) => {
    if (o.userData.isBuilding) buildings.push(o);
    if (o.userData.ambient) ambient.push(o);
    if (o.userData.zoneParticle) zonePts.push(o);
    if (o.isInstancedMesh) {
      instanced++;
      if (['ancient', 'bloom', 'birch', 'pine'].includes(o.userData.veg)) vegTrees.push(o);
      if (['grass', 'shroomCap', 'shroomStem', 'flower'].includes(o.userData.veg)) {
        undergrowth.push(o);
      }
    }
  });
  assert.equal(buildings.length, 40);
  for (const b of buildings) {
    assert.ok(b.geometry.attributes.color, 'building must be vertex-colored');
    assert.ok(b.geometry.attributes.position.count > 36, 'building must be more than a bare box');
    if (b.isInstancedMesh) {
      if (b.userData.part === 'details') {
        assert.equal(b.instanceColor, null, 'details mesh must not be tinted');
      } else {
        assert.ok(b.instanceColor, 'walls/roof mesh must carry a per-plot tint');
        assert.equal(b.instanceColor.count, b.count, 'one tint per instance');
      }
    }
  }
  assert.equal(cullables.length, 40);
  // Trees: 4 Blender fantasy models replacing the Kenney trees —
  // ancient/bloom/birch alternating over the same 130 forest spots,
  // one pine over the same 100 snow spots (same spot counts, same
  // colliders, only the geometry changed).
  assert.equal(vegTrees.length, 4);
  const treeCounts = Object.fromEntries(vegTrees.map((t) => [t.userData.veg, t.count]));
  assert.deepEqual(treeCounts, { ancient: 44, bloom: 43, birch: 43, pine: 100 });
  for (const t of vegTrees) {
    assert.ok(t.geometry.attributes.color, 'fantasy tree must be vertex-colored');
    assert.ok(t.geometry.attributes.position.count > 0);
  }
  // Undergrowth: grass + glowing mushroom caps + stems + flowers.
  // Counts are pinned to the deterministic seeded run; some grass /
  // mushroom candidates are dropped by isClearSpot (road strips).
  assert.equal(undergrowth.length, 4);
  const ugCounts = Object.fromEntries(undergrowth.map((m) => [m.userData.veg, m.count]));
  assert.deepEqual(ugCounts, { grass: 1845, shroomCap: 92, shroomStem: 92, flower: 260 });
  assert.equal(ugCounts.shroomCap, ugCounts.shroomStem, 'every mushroom has a cap and a stem');
  // trees(4), rocks(2), cacti(2), benches, lamps, bushes, pebbles,
  // mounds, undergrowth(4), butterfly wings + bodies (2), plus the
  // house set (13 models x 3 parts).
  assert.equal(instanced, 58);
  // Stage 2 ambient: fireflies + pollen Points, butterfly wings (12
  // instances) + bodies (6); zone particles rebalanced 100 -> 70 so
  // the grand particle total stays at 300.
  const ambCounts = Object.fromEntries(ambient.map((o) => [
    o.userData.ambient,
    o.isInstancedMesh ? o.count : o.geometry.attributes.position.count,
  ]));
  assert.deepEqual(ambCounts, {
    fireflies: 50, pollen: 40, butterflyWings: 12, butterflyBodies: 6,
  });
  const zoneCounts = Object.fromEntries(zonePts.map((o) => [
    o.userData.zoneParticle, o.geometry.attributes.position.count,
  ]));
  assert.deepEqual(zoneCounts, { snow: 70, desert: 70, forest: 70 });
  assert.equal(
    ambCounts.fireflies + ambCounts.pollen
    + zoneCounts.snow + zoneCounts.desert + zoneCounts.forest, 300);
});

test('city has 3D streets, a plaza medallion, shops, and towers', () => {
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('only canvas is stubbed');
      return {
        width: 0,
        height: 0,
        getContext: () => new Proxy({}, { get: () => () => {} }),
      };
    },
  };
  const scene = new THREE.Scene();
  buildWorld(scene);
  let streets = null;
  let medallion = null;
  const buildings = [];
  scene.traverse((o) => {
    if (o.userData.isStreet) streets = o;
    if (o.userData.isMedallion) medallion = o;
    if (o.userData.isBuilding) buildings.push(o);
  });
  assert.ok(streets, 'street ribbons expected');
  // Ribbons (12 x 31 x 2 = 744 verts) + curb boxes (720 x 24 verts).
  assert.ok(streets.geometry.attributes.position.count > 15000, 'ribbons + curbs');
  assert.ok(streets.geometry.attributes.color, 'streets are vertex-colored');
  assert.ok(medallion, 'plaza medallion expected');
  assert.ok(medallion.geometry.attributes.position.count > 100, 'medallion rings');
  assert.ok(buildings.some((b) => b.userData.isShop), 'shops on the inner ring');
  assert.ok(buildings.some((b) => b.userData.isTower), 'towers exist');
  assert.equal(buildings.length, 40, '1 sample + 13 models x 3 parts (48 plots via colliders)');
  assert.equal(buildings.filter((b) => b.userData.isSample).length, 1, 'exactly one Blender sample house');
  let markers = 0;
  scene.traverse((o) => { if (o.userData.isSampleMarker) markers++; });
  assert.equal(markers, 0, 'temporary sample marker removed after the verdict');
});

test('undergrowth never sits on roads, plots, or the plaza', () => {
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('only canvas is stubbed');
      return {
        width: 0,
        height: 0,
        getContext: () => new Proxy({}, { get: () => () => {} }),
      };
    },
  };
  const scene = new THREE.Scene();
  const { colliders } = buildWorld(scene);
  const vegKinds = ['grass', 'shroomCap', 'shroomStem', 'flower'];
  scene.traverse((o) => {
    if (!o.isInstancedMesh || !vegKinds.includes(o.userData.veg)) return;
    const m = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const x = m[i * 16 + 12];
      const z = m[i * 16 + 14];
      assert.ok(isClearSpot(x, z, colliders.rects),
        `${o.userData.veg} #${i} at (${x.toFixed(1)}, ${z.toFixed(1)}) must be clear`);
      if (o.userData.veg === 'shroomCap' || o.userData.veg === 'shroomStem') {
        assert.ok(x < -45, 'mushrooms live in the forest only');
      }
    }
  });
});

test('stage-2 ambient: sea shimmer pulses', () => {
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('only canvas is stubbed');
      return {
        width: 0,
        height: 0,
        getContext: () => new Proxy({}, { get: () => () => {} }),
      };
    },
  };
  const scene = new THREE.Scene();
  const { updaters } = buildWorld(scene);
  let sea = null;
  scene.traverse((o) => { if (o.userData.isSea) sea = o; });
  assert.ok(sea, 'sea mesh expected');
  assert.equal(sea.material.opacity, 0.8);
  const camera = { position: { x: 0, y: 3, z: 0 } };
  for (let i = 0; i < 10; i++) for (const u of updaters) u(0.1, camera);
  assert.ok(sea.material.opacity !== 0.8, 'shimmer must move opacity');
  assert.ok(sea.material.opacity >= 0.74 && sea.material.opacity <= 0.86,
    `pulse must stay subtle (got ${sea.material.opacity})`);
});

test('buildWorld exports colliders for buildings and props', () => {
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error('only canvas is stubbed');
      return {
        width: 0,
        height: 0,
        getContext: () => new Proxy({}, { get: () => () => {} }),
      };
    },
  };
  const scene = new THREE.Scene();
  const { colliders } = buildWorld(scene);
  assert.equal(colliders.rects.length, 48);
  assert.ok(colliders.circles.length > 100);
  assert.ok(colliders.rects.every((r) => r.hw > 0 && r.hd > 0));
});
