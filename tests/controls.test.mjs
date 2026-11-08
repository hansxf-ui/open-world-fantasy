import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampJoystick, clampCamera, stepVertical, moveVector, easeToward, zoomByPinch, zoomByWheel, collidesAt, turnToward, isTap, deadzoneLatch, resolveVertical } from '../js/controls.js';

test('joystick edge clamps to magnitude 1', () => {
  const j = clampJoystick(0.9, 0.9);
  assert.ok(Math.hypot(j.x, j.y) <= 1 + 1e-9);
});

test('joystick up with yaw 0 moves toward -z', () => {
  const m = moveVector({ x: 0, y: -1 }, 0);
  assert.ok(Math.abs(m.x) < 1e-9 && m.z < 0);
});

test('camera pitch clamps, gravity pulls down', () => {
  assert.equal(clampCamera(2.0), 1.1);
  assert.equal(clampCamera(-1.0), -0.15);
  assert.ok(stepVertical(6, 0.1) < 6);
});

test('easeToward glides toward the target without overshoot', () => {
  assert.ok(easeToward(1.8, 0.1, 0.1, 5) < 1.8 && easeToward(1.8, 0.1, 0.1, 5) > 0.1);
  assert.equal(easeToward(0.1, 0.1, 0.1, 5), 0.1);
});

test('pinch zoom: fingers apart zooms in, together zooms out, clamped', () => {
  assert.equal(zoomByPinch(6, 100, 200), 3);
  assert.equal(zoomByPinch(6, 100, 50), 12);
  assert.equal(zoomByPinch(6, 100, 100), 6);
  assert.ok(Math.abs(zoomByPinch(8, 100, 150) - 8 * 100 / 150) < 1e-9);
});

test('wheel zoom: scroll up zooms in, down zooms out, clamped', () => {
  assert.ok(zoomByWheel(6, -100) < 6);
  assert.ok(zoomByWheel(6, 100) > 6);
  assert.equal(zoomByWheel(3, -1000), 3);
  assert.equal(zoomByWheel(12, 1000), 12);
});

test('collision: circles and building rects block, clear space passes', () => {
  const col = {
    rects: [{ x: 10, z: 10, hw: 3, hd: 3 }],
    circles: [{ x: 0, z: 0, r: 1 }],
  };
  assert.equal(collidesAt(10, 10, col, 0.4), true);
  assert.equal(collidesAt(10, 13.3, col, 0.4), true);
  assert.equal(collidesAt(10, 14, col, 0.4), false);
  assert.equal(collidesAt(0.5, 0, col, 0.4), true);
  assert.equal(collidesAt(2, 0, col, 0.4), false);
  assert.equal(collidesAt(50, 50, col, 0.4), false);
});

test('touch drag is never stolen by the browser or invisible overlays', () => {
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  // The browser must not turn a drag into scroll/zoom (that fires
  // pointercancel mid-drag = choppy interaction).
  assert.match(css, /#game canvas\s*{[^}]*touch-action:\s*none/);
  assert.match(css, /#joystick\s*{[^}]*touch-action:\s*none/);
  // Invisible overlays must not swallow drags.
  assert.match(css, /#zoneToast\s*{[^}]*pointer-events:\s*none/);
  assert.match(css, /#fps\s*{[^}]*pointer-events:\s*none/);
});

test('turnToward moves partway and clamps alpha', () => {
  assert.equal(turnToward(0, 1, 0.5), 0.5);
  assert.equal(turnToward(0, -1, 0.5), -0.5);
  assert.equal(turnToward(0, 1, 0), 0);
  assert.equal(turnToward(0, 1, 2), 1);
});

test('turnToward takes the short way around the ±π seam', () => {
  // From 3.1 to -3.1 the short way goes through π, not back through 0.
  const r = turnToward(3.1, -3.1, 0.5);
  assert.ok(r > 3.0 && r < Math.PI + 0.01, `short way through π, got ${r}`);
});

test('isTap: quick small tap passes, drag / long press / wrong finger fail', () => {
  const down = { x: 100, y: 100, id: 1, t: 1000 };
  assert.equal(isTap(down, { x: 105, y: 103, id: 1, t: 1100 }), true);
  assert.equal(isTap(down, { x: 130, y: 100, id: 1, t: 1100 }), false); // dragged
  assert.equal(isTap(down, { x: 100, y: 100, id: 1, t: 2000 }), false); // long press
  assert.equal(isTap(down, { x: 100, y: 100, id: 2, t: 1100 }), false); // other finger
  assert.equal(isTap(null, { x: 100, y: 100, id: 1, t: 1100 }), false);
});

test('deadzoneLatch: start past 0.15, stop only below 0.08', () => {
  assert.deepEqual(deadzoneLatch(0.14, false), { mag: 0, moving: false });
  assert.deepEqual(deadzoneLatch(0.15, false), { mag: 0.15, moving: true });
  assert.deepEqual(deadzoneLatch(0.10, true), { mag: 0.10, moving: true });
  assert.deepEqual(deadzoneLatch(0.07, true), { mag: 0, moving: false });
});

test('resolveVertical: downhill step stays grounded (kejang fix)', () => {
  // Running down a diagonal dune: ground falls 0.0067 m/frame.
  let s = { y: 0, vy: 0, grounded: true, wasSwimming: false };
  for (let i = 0, ground = 0; i < 600; i++) {
    ground -= 0.0067;
    s = resolveVertical(s.y, s.vy, ground, s.grounded, s.wasSwimming, 1 / 60);
    assert.equal(s.grounded, true);
    assert.equal(s.y, ground);
  }
});

test('resolveVertical: jump goes airborne, cliff fall goes airborne, landing grounds', () => {
  let s = resolveVertical(0, 6, 0, false, false, 1 / 60);
  assert.equal(s.grounded, false); // jump button: vy > 0
  s = resolveVertical(0, 0, -1, true, false, 1 / 60);
  assert.equal(s.grounded, false); // 1 m cliff drop, not a step
  s = resolveVertical(1, 0, 0, false, false, 1 / 60);
  assert.equal(s.grounded, false); // falling from 1 m
  for (let i = 0; i < 120 && !s.grounded; i++) s = resolveVertical(s.y, s.vy, 0, s.grounded, s.wasSwimming, 1 / 60);
  assert.equal(s.grounded, true);
  assert.equal(s.y, 0);
});
