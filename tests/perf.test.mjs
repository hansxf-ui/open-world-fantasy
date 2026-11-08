import test from 'node:test';
import assert from 'node:assert/strict';
import { dprPolicy } from '../js/config.js';

test('DPR drops under sustained load, never below floor', () => {
  assert.equal(dprPolicy(25, 2), 1.5);
  assert.equal(dprPolicy(25, 1.5), 1.25);
  assert.equal(dprPolicy(25, 1.25), 1.25);
  assert.equal(dprPolicy(12, 1.5), 1.5);
});
