import test from 'node:test';
import assert from 'node:assert/strict';
import { worldToMap, playerArrowPoints, drawMinimap } from '../js/minimap.js';

test('world corners and center map to the right fractions', () => {
  assert.deepEqual(worldToMap(-200, -200), [0, 0]);
  assert.deepEqual(worldToMap(200, 200), [1, 1]);
  assert.deepEqual(worldToMap(0, 0), [0.5, 0.5]);
  // North (snow, z = -200) is at the top of the map.
  assert.deepEqual(worldToMap(0, -200), [0.5, 0]);
});

test('player arrow points along facing: +z (yaw 0) is down on the map', () => {
  const [tip] = playerArrowPoints(70, 70, 0, 7);
  assert.ok(tip[1] > 70 && Math.abs(tip[0] - 70) < 0.01, 'yaw 0 faces down');
  const [tip2] = playerArrowPoints(70, 70, Math.PI, 7);
  assert.ok(tip2[1] < 70, 'yaw PI faces up');
  const [tip3] = playerArrowPoints(70, 70, Math.PI / 2, 7);
  assert.ok(tip3[0] > 70, 'yaw PI/2 faces right');
});

function stubCtx() {
  const calls = [];
  const ctx = {
    calls,
    fillRect(x, y, w, h) { calls.push(['rect', ctx.fillStyle, x, y, w, h]); },
    beginPath() { calls.push(['begin']); },
    moveTo(x, y) { calls.push(['move', x, y]); },
    lineTo(x, y) { calls.push(['line', x, y]); },
    closePath() { calls.push(['close']); },
    fill() { calls.push(['fill', ctx.fillStyle]); },
    arc(x, y, r) { calls.push(['arc', ctx.fillStyle, x, y, r]); },
  };
  let style = '';
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => style,
    set: (v) => { style = v; },
  });
  return ctx;
}

test('drawMinimap paints zones, the player arrow, and remote dots', () => {
  const ctx = stubCtx();
  drawMinimap(ctx, 140, { x: 0, z: 0, yaw: 0, color: '#ff0000' },
    [{ x: 100, z: -100, color: '#00ff00' }]);
  const rects = ctx.calls.filter((c) => c[0] === 'rect');
  // City plaza rect in the middle, drawn in the city color.
  assert.ok(rects.some((c) => c[1] === '#e8c9a0'
    && Math.abs(c[2] - 140 * 0.3875) < 1 && Math.abs(c[3] - 140 * 0.3875) < 1));
  // Snow rect at the top.
  assert.ok(rects.some((c) => c[1] === '#fff4e8' && c[3] === 0));
  // A remote dot at the remote's map position (x=100 -> 0.75, z=-100 -> 0.25).
  assert.ok(ctx.calls.some((c) => c[0] === 'arc' && c[1] === '#00ff00'
    && Math.abs(c[2] - 105) < 1 && Math.abs(c[3] - 35) < 1));
  // The player arrow is a filled triangle near the center.
  assert.ok(ctx.calls.some((c) => c[0] === 'fill' && c[1] === '#fff8ec'));
  // Street grid lines over the city area.
  assert.ok(rects.some((c) => c[1] === 'rgba(90, 80, 70, 0.45)'));
});
