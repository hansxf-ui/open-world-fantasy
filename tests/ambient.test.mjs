import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDGETS } from '../js/config.js';
import {
  AMBIENT, fireflyBlink, butterflyOffset, butterflyVelocity, buildAmbient,
} from '../js/ambient.js';

test('ambient particle budget sums to BUDGETS.particles', () => {
  const total = AMBIENT.snow + AMBIENT.desert + AMBIENT.forestLeaves
    + AMBIENT.fireflies + AMBIENT.pollen;
  assert.equal(total, BUDGETS.particles);
  assert.equal(AMBIENT.fireflies, 50);
  assert.equal(AMBIENT.pollen, 40);
  assert.equal(AMBIENT.butterflies, 6);
});

test('firefly blink stays in range and varies over time', () => {
  let lo = 1;
  let hi = 0;
  for (let t = 0; t <= 10; t += 0.1) {
    const b = fireflyBlink(t, 1.2, 0.7);
    assert.ok(b >= 0.1 && b <= 1, `blink ${b} out of [0.1, 1]`);
    lo = Math.min(lo, b);
    hi = Math.max(hi, b);
  }
  assert.ok(hi - lo > 0.5, `blink must vary (range ${hi - lo})`);
});

test('butterfly pose is bounded, flaps, and moves', () => {
  let heading0 = null;
  let headingMoved = false;
  let pose0 = null;
  let poseMoved = false;
  for (let t = 0; t <= 5; t += 0.1) {
    const off = butterflyOffset(t, 1.3);
    const vel = butterflyVelocity(t, 1.3);
    assert.ok(Math.abs(off.dx) <= 3.01, `dx ${off.dx} beyond wander radius`);
    assert.ok(Math.abs(off.dz) <= 3.01, `dz ${off.dz} beyond wander radius`);
    assert.ok(off.dy >= 0.55 && off.dy <= 1.25, `dy ${off.dy} out of bob range`);
    assert.ok(off.flap >= -0.9 && off.flap <= 0.9, `flap ${off.flap} out of range`);
    const heading = Math.atan2(vel.vx, vel.vz);
    assert.ok(Number.isFinite(heading), 'heading must be finite');
    if (heading0 === null) heading0 = heading;
    else if (Math.abs(heading - heading0) > 0.1) headingMoved = true;
    if (pose0 === null) pose0 = off;
    else if (Math.abs(off.dx - pose0.dx) > 0.1 || Math.abs(off.dz - pose0.dz) > 0.1) poseMoved = true;
  }
  assert.ok(headingMoved, 'heading must change as the butterfly wanders');
  assert.ok(poseMoved, 'pose must change over time');
});

// Motion harness: step the real ambient updater and prove every
// animated thing actually moves (a static render cannot show this).
test('buildAmbient creates stage-2 objects and animates them', () => {
  const added = [];
  const scene = { add: (o) => added.push(o) };
  const forestTreeSpots = Array.from({ length: 130 }, (_, i) => [-100 - (i % 10), -50 + (i % 13)]);
  const flowerSpots = Array.from({ length: 260 }, (_, i) => [(i % 20) - 10, (i % 17) - 8]);
  const { updaters, objects } = buildAmbient(scene, {
    forestTreeSpots, flowerSpots, groundHeight: () => 0, zoneAt: (x) => (x < -45 ? 'forest' : 'city'),
  });
  assert.equal(updaters.length, 1);
  assert.equal(objects.fireflies.geometry.attributes.position.count, 50);
  assert.equal(objects.pollen.geometry.attributes.position.count, 40);
  assert.equal(objects.wings.count, 12);
  assert.equal(objects.bodies.count, 6);
  assert.equal(objects.fireflies.userData.ambient, 'fireflies');
  assert.equal(objects.pollen.userData.ambient, 'pollen');
  assert.equal(objects.wings.userData.ambient, 'butterflyWings');
  assert.equal(objects.bodies.userData.ambient, 'butterflyBodies');
  assert.equal(added.length, 4);

  const forestCam = { position: { x: -100, y: 3, z: 0 } };
  const cityCam = { position: { x: 0, y: 3, z: 0 } };
  const fireflyPos0 = objects.fireflies.geometry.attributes.position.array.slice();
  const fireflyCol0 = objects.fireflies.geometry.attributes.color.array.slice();
  const wings0 = objects.wings.instanceMatrix.array.slice();
  const bodies0 = objects.bodies.instanceMatrix.array.slice();
  for (let i = 0; i < 60; i++) updaters[0](0.016, forestCam);
  assert.equal(objects.fireflies.visible, true, 'fireflies show in the forest');
  assert.equal(objects.pollen.visible, false, 'pollen hides outside the city');
  assert.notDeepEqual(
    Array.from(objects.fireflies.geometry.attributes.position.array), Array.from(fireflyPos0),
    'firefly positions must drift');
  assert.notDeepEqual(
    Array.from(objects.fireflies.geometry.attributes.color.array), Array.from(fireflyCol0),
    'firefly colours must blink');
  assert.notDeepEqual(
    Array.from(objects.wings.instanceMatrix.array), Array.from(wings0),
    'wing matrices must flap');
  assert.notDeepEqual(
    Array.from(objects.bodies.instanceMatrix.array), Array.from(bodies0),
    'body matrices must wander');
  // Zone switch: fireflies off, pollen on and drifting.
  const pollen0 = objects.pollen.geometry.attributes.position.array.slice();
  for (let i = 0; i < 60; i++) updaters[0](0.016, cityCam);
  assert.equal(objects.fireflies.visible, false, 'fireflies hide outside the forest');
  assert.equal(objects.pollen.visible, true, 'pollen shows in the city');
  assert.notDeepEqual(
    Array.from(objects.pollen.geometry.attributes.position.array), Array.from(pollen0),
    'pollen positions must drift');
});
