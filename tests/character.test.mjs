import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../js/vendor/three.module.js';
import { nextAnimState, buildHumanoid, poseHumanoid, recolorShirt, disposeObject3D } from '../js/character.js';
import { deadzoneLatch } from '../js/controls.js';

test('walk to swim at the shoreline, never sinks', () => {
  assert.equal(nextAnimState('walk', { mag: 0.5, depth: 1.0, airborne: false }), 'swim');
  assert.equal(nextAnimState('swim', { mag: 0.5, depth: 0.2, airborne: false }), 'walk');
});

test('idle, walk, run, jump thresholds', () => {
  assert.equal(nextAnimState('idle', { mag: 0, depth: 0, airborne: false }), 'idle');
  assert.equal(nextAnimState('idle', { mag: 0.5, depth: 0, airborne: false }), 'walk');
  assert.equal(nextAnimState('walk', { mag: 1.0, depth: 0, airborne: false }), 'run');
  assert.equal(nextAnimState('run', { mag: 1.0, depth: 0, airborne: true }), 'jump');
});

test('humanoid has named parts and walk pose moves a leg', () => {
  const g = buildHumanoid('#ff0000');
  const legL = g.getObjectByName('legL');
  assert.ok(legL);
  const before = legL.rotation.x;
  poseHumanoid(g, 'walk', 0.5);
  assert.notEqual(legL.rotation.x, before);
});

test('M4: disposeObject3D frees every geometry once and the shared material once', () => {
  const g = buildHumanoid('#ff0000');
  const geos = new Set();
  const mats = new Set();
  g.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) mats.add(o.material);
  });
  assert.equal(geos.size, 7);
  assert.equal(mats.size, 1); // one material shared across the 7 meshes
  let geoDisposed = 0;
  let matDisposed = 0;
  for (const geo of geos) geo.addEventListener('dispose', () => { geoDisposed++; });
  for (const mat of mats) mat.addEventListener('dispose', () => { matDisposed++; });
  disposeObject3D(g);
  assert.equal(geoDisposed, 7);
  assert.equal(matDisposed, 1);
});

test('M4: disposeObject3D also frees a sprite material and its map', () => {
  const tex = new THREE.Texture();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  let texDisposed = 0;
  let matDisposed = 0;
  tex.addEventListener('dispose', () => { texDisposed++; });
  sprite.material.addEventListener('dispose', () => { matDisposed++; });
  disposeObject3D(sprite);
  assert.equal(texDisposed, 1);
  assert.equal(matDisposed, 1);
});

test('upgraded humanoid: 7 meshes, vertex-colored, feet on the ground', () => {
  const g = buildHumanoid('#ff0000');
  const meshes = [];
  g.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.equal(meshes.length, 7);
  for (const m of meshes) {
    assert.ok(m.geometry.attributes.color, `${m.name}: merged vertex colors`);
  }
  // Feet touch the ground: the leg pivot sits at hip height (0.85) and
  // the leg geometry reaches 0.85 below it.
  g.updateMatrixWorld(true);
  const legL = g.getObjectByName('legL');
  const box = new THREE.Box3().setFromObject(legL);
  assert.ok(Math.abs(box.min.y) < 0.02, `feet at ground, got ${box.min.y}`);
});

test('legs are tapered, not capsules: thigh wider than ankle', () => {
  // Merged output is always BufferGeometry, so a type check would be
  // vacuous — measure the shape instead: vertices near the hip must
  // spread wider than vertices just above the shoe.
  const g = buildHumanoid('#ff0000');
  const mesh = g.getObjectByName('legL').children[0];
  const pos = mesh.geometry.attributes.position.array;
  let hipMax = 0;
  let ankleMax = 0;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1];
    const ax = Math.abs(pos[i]);
    // Top ring (y ≈ 0; epsilon covers float dust above zero).
    if (y > -0.05 && y <= 0.001) hipMax = Math.max(hipMax, ax);
    // Cylinder bottom ring (y ≈ -0.85); the |x|,|z| filter excludes
    // shoe-box corners, which share the same y but stick out further.
    if (y < -0.84 && ax <= 0.08 && Math.abs(pos[i + 2]) <= 0.08) {
      ankleMax = Math.max(ankleMax, ax);
    }
  }
  assert.ok(hipMax > 0.10, `thigh spread, got ${hipMax}`);
  assert.ok(ankleMax < 0.09, `ankle spread, got ${ankleMax}`);
  assert.ok(hipMax - ankleMax > 0.02, 'taper present');
});

test('recolorShirt swaps only the shirt vertices', () => {
  const g = buildHumanoid('#ff0000');
  recolorShirt(g, '#00ff00');
  const torso = g.getObjectByName('torso');
  const col = torso.geometry.attributes.color.array;
  let hasNew = false;
  let hasOld = false;
  for (let i = 0; i < col.length; i += 3) {
    if (col[i] === 0 && col[i + 1] === 1 && col[i + 2] === 0) hasNew = true;
    if (col[i] === 1 && col[i + 1] === 0 && col[i + 2] === 0) hasOld = true;
  }
  assert.ok(hasNew, 'new shirt color present');
  assert.ok(!hasOld, 'old shirt color gone');
  // Skin on the head is untouched by the shirt recolor.
  const head = g.getObjectByName('head');
  const hc = head.geometry.attributes.color.array;
  const skinR = new THREE.Color(0xf2c9a0).r; // linear working-space value
  let skin = false;
  for (let i = 0; i < hc.length; i += 3) {
    if (Math.abs(hc[i] - skinR) < 0.01) { skin = true; break; }
  }
  assert.ok(skin, 'head skin vertices untouched');
});

test('pose blending: repeated small-dt calls converge to the target', () => {
  const g = buildHumanoid('#ff0000');
  const legL = g.getObjectByName('legL');
  for (let i = 0; i < 120; i++) poseHumanoid(g, 'walk', Math.PI / 2, 1 / 60);
  assert.ok(Math.abs(legL.rotation.x - 0.6) < 0.01, `converged to walk target, got ${legL.rotation.x}`);
});

test('pose blending: a walk/run flip every frame never snaps limbs (kejang fix)', () => {
  const g = buildHumanoid('#ff0000');
  const legL = g.getObjectByName('legL');
  poseHumanoid(g, 'walk', Math.PI / 2, 1); // s = 1 -> leg 0.6
  let prev = legL.rotation.x;
  let maxJump = 0;
  for (let i = 0; i < 60; i++) {
    poseHumanoid(g, i % 2 === 0 ? 'run' : 'walk', Math.PI / 2, 1 / 60);
    maxJump = Math.max(maxJump, Math.abs(legL.rotation.x - prev));
    prev = legL.rotation.x;
  }
  // Snap code would jump 0.3 (0.6 -> 0.9) in one frame; blended stays small.
  assert.ok(maxJump < 0.2, `max per-frame leg jump ${maxJump}`);
});

test('walk/run hysteresis: run latches below 6, walk latches up to 6', () => {
  assert.equal(nextAnimState('run', { mag: 0.8, depth: 0, airborne: false }), 'run');
  assert.equal(nextAnimState('run', { mag: 0.7, depth: 0, airborne: false }), 'walk');
  assert.equal(nextAnimState('walk', { mag: 0.85, depth: 0, airborne: false }), 'walk');
  assert.equal(nextAnimState('walk', { mag: 0.95, depth: 0, airborne: false }), 'run');
  // Idle/swim/jump still override the latch.
  assert.equal(nextAnimState('run', { mag: 0, depth: 0, airborne: false }), 'idle');
  assert.equal(nextAnimState('run', { mag: 1.0, depth: 1, airborne: false }), 'swim');
});

test('kejang regression: noisy stick hovering at 0.15 / 0.9 never flips state', () => {
  // Chains deadzoneLatch + nextAnimState exactly as main.js does.
  const latch = deadzoneLatch;
  function flips(center, seed) {
    let s = seed, state = 'idle', moving = false, n = 0;
    for (let i = 0; i < 600; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const raw = center + 0.03 * ((s / 0x7fffffff) * 2 - 1);
      const l = latch(raw, moving); moving = l.moving;
      const next = nextAnimState(state, { mag: l.mag, depth: 0, airborne: false });
      if (i > 10 && next !== state) n++;
      state = next;
    }
    return n;
  }
  assert.equal(flips(0.15, 42), 0);
  assert.equal(flips(0.90, 7), 0);
});
