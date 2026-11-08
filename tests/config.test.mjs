import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, BUDGETS, SYNC, SPEED, CHAT, COLORS, dprPolicy } from '../js/config.js';

test('world is 400 wide with city box inside it', () => {
  assert.equal(WORLD.size, 400);
  assert.ok(WORLD.cityHalf < WORLD.size / 2);
});

test('budgets match the spec', () => {
  assert.equal(BUDGETS.drawCalls, 400);
  assert.equal(BUDGETS.triangles, 300000);
  assert.equal(SYNC.hz, 10);
  assert.equal(CHAT.maxChars, 120);
  assert.equal(COLORS.length, 8);
});

test('M3: DPR steps live in config, not hardcoded in dprPolicy', () => {
  assert.equal(BUDGETS.dprMax, 2);
  assert.equal(BUDGETS.dprMid, 1.5);
  assert.equal(BUDGETS.dprMin, 1.25);
  assert.equal(dprPolicy(10, 2), 2);
  assert.equal(dprPolicy(30, 2), BUDGETS.dprMid);
  assert.equal(dprPolicy(30, BUDGETS.dprMid), BUDGETS.dprMin);
  assert.equal(dprPolicy(30, BUDGETS.dprMin), BUDGETS.dprMin);
});
