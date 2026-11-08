import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../js/vendor/three.module.js';
import { buildHumanoid, recolorShirt, poseHumanoid } from '../js/character.js';
import { isValidPosPayload, normalizeVariant } from '../js/net.js';

// Pair phase: both Blender variants share names, pivots, and the
// white-shirt-marker contract; only the styling differs.
const PARTS = ['legL', 'legR', 'body', 'torso', 'head', 'hat', 'armL', 'armR'];
const PIVOTS = {
  legL: [-0.14, 0.85, 0], legR: [0.14, 0.85, 0], body: [0, 0.85, 0],
  torso: [0, 0.35, 0], head: [0, 1.0, 0], hat: [0, 1.22, 0],
  armL: [-0.34, 0.65, 0], armR: [0.34, 0.65, 0],
};
// Pivots are parent-relative: legs to the group, the rest to the
// body group (which itself sits at y 0.85).

function meshOf(g, name) {
  const p = g.getObjectByName(name);
  return p && (p.isMesh ? p : p.children[0]);
}

function countTris(g) {
  let total = 0;
  g.traverse((o) => {
    if (o.isMesh) total += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  return total;
}

for (const variant of ['female', 'male']) {
  test(`pair: ${variant} humanoid has 7 meshes, all named parts, bake pivots`, () => {
    const g = buildHumanoid('#ff0000', variant);
    const meshes = [];
    g.traverse((o) => { if (o.isMesh) meshes.push(o); });
    assert.equal(meshes.length, 7);
    for (const name of PARTS) {
      const p = g.getObjectByName(name);
      assert.ok(p, `${variant} missing ${name}`);
      assert.deepEqual(
        [p.position.x, p.position.y, p.position.z],
        PIVOTS[name],
        `${variant} ${name} pivot`,
      );
    }
    // Feet touch the ground in world space.
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.getObjectByName('legL'));
    assert.ok(Math.abs(box.min.y) < 0.02, `${variant} feet at ground, got ${box.min.y}`);
    // Walk pose still swings a leg pivot.
    const before = g.getObjectByName('legL').rotation.x;
    poseHumanoid(g, 'walk', 0.5);
    assert.notEqual(g.getObjectByName('legL').rotation.x, before);
  });

  test(`pair: ${variant} recolor converts white markers, then the old color, leaves other parts alone`, () => {
    const g = buildHumanoid('#ff0000', variant);
    // After build, no white marker vertices remain in torso/arms.
    for (const name of ['torso', 'armL', 'armR']) {
      const col = meshOf(g, name).geometry.attributes.color.array;
      for (let i = 0; i < col.length; i += 3) {
        assert.ok(!(Math.abs(col[i] - 1) < 0.01 && Math.abs(col[i + 1] - 1) < 0.01 && Math.abs(col[i + 2] - 1) < 0.01),
          `${variant} ${name} still has a white marker after build`);
      }
    }
    // Recolor: new color present, old color gone, head skin untouched.
    recolorShirt(g, '#00ff00');
    const torso = meshOf(g, 'torso').geometry.attributes.color.array;
    let hasNew = false;
    let hasOld = false;
    for (let i = 0; i < torso.length; i += 3) {
      if (torso[i] === 0 && torso[i + 1] === 1 && torso[i + 2] === 0) hasNew = true;
      if (torso[i] === 1 && torso[i + 1] === 0 && torso[i + 2] === 0) hasOld = true;
    }
    assert.ok(hasNew, `${variant} new shirt color present`);
    assert.ok(!hasOld, `${variant} old shirt color gone`);
    const head = meshOf(g, 'head').geometry.attributes.color.array;
    const skinR = new THREE.Color(0xf2c9a0).r;
    let skin = false;
    for (let i = 0; i < head.length; i += 3) {
      if (Math.abs(head[i] - skinR) < 0.01) { skin = true; break; }
    }
    assert.ok(skin, `${variant} head skin vertices untouched`);
  });

  test(`pair: ${variant} geometries are fresh per humanoid (recolor never leaks)`, () => {
    const a = buildHumanoid('#ff0000', variant);
    const b = buildHumanoid('#0000ff', variant);
    recolorShirt(a, '#00ff00');
    const colB = meshOf(b, 'torso').geometry.attributes.color.array;
    let hasGreen = false;
    for (let i = 0; i < colB.length; i += 3) {
      if (colB[i] === 0 && colB[i + 1] === 1 && colB[i + 2] === 0) hasGreen = true;
    }
    assert.ok(!hasGreen, `${variant} recolor of one humanoid leaked into another`);
  });
}

test('pair: male is lighter than female, both inside the per-player budget', () => {
  const f = countTris(buildHumanoid('#ff0000', 'female'));
  const m = countTris(buildHumanoid('#ff0000', 'male'));
  assert.equal(f, 1878);
  assert.equal(m, 1766);
  assert.ok(m < f, 'male lighter than female');
  assert.ok(f <= 2640 && m <= 2640, 'inside 2640 budget');
});

test('pair: unknown variant falls back to female', () => {
  const g = buildHumanoid('#ff0000', 'robot');
  assert.equal(countTris(g), 1878, 'unknown variant builds the female geometry');
});

test('pair: normalizeVariant coerces missing/unknown to female', () => {
  assert.equal(normalizeVariant('male'), 'male');
  assert.equal(normalizeVariant('female'), 'female');
  assert.equal(normalizeVariant(undefined), 'female');
  assert.equal(normalizeVariant('robot'), 'female');
  assert.equal(normalizeVariant(''), 'female');
});

test('pair: pos validator accepts a string variant, rejects a non-string one', () => {
  const base = { id: 'owf-abc', x: 0, z: 0, yaw: 0 };
  assert.equal(isValidPosPayload({ ...base, variant: 'male' }), true);
  assert.equal(isValidPosPayload({ ...base }), true, 'old clients send no variant');
  assert.equal(isValidPosPayload({ ...base, variant: 7 }), false);
  assert.equal(isValidPosPayload({ ...base, variant: 'robot' }), true, 'unknown string coerced, not dropped');
});
