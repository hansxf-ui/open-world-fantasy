import test from 'node:test';
import assert from 'node:assert/strict';
import { KENNEY } from '../js/vendor/kenney.js';

// Guards the bake pipeline (scripts/bake-kenney.py): every baked model
// must be a consistent indexed, vertex-colored geometry resting near
// y = 0 (models sink 0.05 below their origin).
test('baked Kenney entries are consistent indexed geometry', () => {
  const names = Object.keys(KENNEY);
  assert.equal(names.length, 9);
  for (const name of names) {
    const e = KENNEY[name];
    const verts = e.pos.length / 3;
    assert.ok(Number.isInteger(verts) && verts > 0, `${name}: vertex count`);
    assert.equal(e.nor.length, e.pos.length, `${name}: normals`);
    assert.equal(e.col.length, e.pos.length, `${name}: colors`);
    assert.ok(e.index.length > 0 && e.index.length % 3 === 0, `${name}: indices`);
    assert.ok(Math.max(...e.index) < verts, `${name}: index range`);
    assert.ok(e.min[1] >= -0.1 && e.max[1] > e.min[1], `${name}: vertical bbox`);
    assert.ok(e.max[0] > e.min[0] && e.max[2] > e.min[2], `${name}: horizontal bbox`);
  }
});
