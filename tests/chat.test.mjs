import test from 'node:test';
import assert from 'node:assert/strict';
import { canSend, formatChat, receiveChat } from '../js/chat.js';

test('rate limit and sanitization', () => {
  assert.equal(canSend(1000, 1500), false);
  assert.equal(canSend(1000, 3000), true);
  const m = formatChat('  Gav  ', 'halo <script> dunia yang panjang '.repeat(10));
  assert.equal(m.name, 'Gav');
  assert.ok(m.text.length <= 120 && !m.text.includes('<'));
});

test('M8 global panel: unknown id still reaches the panel, never the bubble', () => {
  const lines = [];
  let bubbles = 0;
  const hooks = {
    findGroup: () => undefined, // far player: no visible group
    showFloating: () => { bubbles++; },
    appendLine: (t) => { lines.push(t); },
  };
  receiveChat({ id: 'far-1', name: 'Gav', text: 'halo dari jauh' }, hooks);
  assert.deepEqual(lines, ['Gav: halo dari jauh']);
  assert.equal(bubbles, 0);
});

test('M8: visible player still gets both panel line and bubble; empty text gets neither', () => {
  const lines = [];
  let bubbles = 0;
  const hooks = {
    findGroup: () => ({ id: 'near-1' }),
    showFloating: () => { bubbles++; },
    appendLine: (t) => { lines.push(t); },
  };
  receiveChat({ id: 'near-1', name: 'Gav', text: 'halo' }, hooks);
  assert.deepEqual(lines, ['Gav: halo']);
  assert.equal(bubbles, 1);
  receiveChat({ id: 'near-1', name: 'Gav', text: '   ' }, hooks);
  assert.equal(lines.length, 1);
  assert.equal(bubbles, 1);
});
