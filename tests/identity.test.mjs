import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../js/config.js';

test('identity palette has 8 distinct valid soft colors', () => {
  assert.equal(COLORS.length, 8);
  for (const c of COLORS) {
    assert.match(c, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(new Set(COLORS).size, 8);
});
