import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSend, interpolatePos, inInterestRadius, pruneStale, upsertRemote, shouldPublish, makeChatPayload, isValidPosPayload, isValidChatPayload, connectNet } from '../js/net.js';

test('deadband suppresses tiny moves, passes real ones', () => {
  const last = { x: 0, z: 0, yaw: 0 };
  assert.equal(shouldSend(last, { x: 0.05, z: 0, yaw: 0 }), false);
  assert.equal(shouldSend(last, { x: 0.5, z: 0, yaw: 0 }), true);
  assert.equal(shouldSend(last, { x: 0, z: 0, yaw: 10 }), true);
});

test('interest radius and stale pruning', () => {
  assert.equal(inInterestRadius({ x: 0, z: 0 }, { x: 100, z: 0 }), false);
  assert.equal(inInterestRadius({ x: 0, z: 0 }, { x: 30, z: 0 }), true);
  assert.deepEqual(pruneStale({ a: 0, b: 9000 }, 10000), ['a']);
});

test('interpolation moves toward target without overshoot', () => {
  const p = interpolatePos({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 0.1);
  assert.ok(p.x > 0 && p.x < 10);
});

test('same name, different ids stay separate remotes', () => {
  let r = {};
  r = upsertRemote(r, { id: 'a', name: 'Gav', color: '#ff0000' });
  r = upsertRemote(r, { id: 'b', name: 'Gav', color: '#00ff00' });
  assert.equal(Object.keys(r).length, 2);
});

test('idle players still heartbeat so they are not pruned as stale', () => {
  const pos = { x: 0, z: 0, yaw: 0 };
  // Deadband fails but only 1 s passed: hold.
  assert.equal(shouldPublish(pos, 0, 1000, pos), false);
  // Deadband fails and 5 s passed: heartbeat wins over deadband.
  assert.equal(shouldPublish(pos, 0, 5000, pos), true);
  // Real movement always publishes.
  assert.equal(shouldPublish(pos, 0, 1000, { x: 1, z: 0, yaw: 0 }), true);
});

test('chat payload carries the sender name', () => {
  const p = makeChatPayload('owf-abc', 'Gav', 'halo');
  assert.equal(p.id, 'owf-abc');
  assert.equal(p.name, 'Gav');
  assert.equal(p.text, 'halo');
  assert.equal(typeof p.ts, 'number');
});

test('M6: position payloads must be finite numbers with a string id', () => {
  const good = { id: 'a', name: 'Gav', color: '#ff0000', x: 1, y: 0, z: 2, yaw: 0.5, state: 'walk' };
  assert.equal(isValidPosPayload(good), true);
  assert.equal(isValidPosPayload({ ...good, x: NaN }), false);
  assert.equal(isValidPosPayload({ ...good, x: Infinity }), false);
  assert.equal(isValidPosPayload({ ...good, z: '2' }), false);
  assert.equal(isValidPosPayload({ ...good, yaw: null }), false);
  assert.equal(isValidPosPayload({ ...good, y: undefined }), true);
  assert.equal(isValidPosPayload({ ...good, y: 'tinggi' }), false);
  assert.equal(isValidPosPayload({ ...good, id: '' }), false);
  assert.equal(isValidPosPayload({ ...good, id: 7 }), false);
  assert.equal(isValidPosPayload([good]), false);
  assert.equal(isValidPosPayload(null), false);
  // The real-world vector: JSON 1e999 parses to Infinity.
  const parsed = JSON.parse('{"id":"a","x":1e999,"z":0,"yaw":0}');
  assert.equal(parsed.x, Infinity);
  assert.equal(isValidPosPayload(parsed), false);
});

test('M6: chat payloads need a string id and string text', () => {
  assert.equal(isValidChatPayload({ id: 'a', name: 'Gav', text: 'halo' }), true);
  assert.equal(isValidChatPayload({ id: 'a', text: 42 }), false);
  assert.equal(isValidChatPayload({ id: 'a' }), false);
  assert.equal(isValidChatPayload({ id: 'a', text: 'halo', name: 7 }), false);
});

// Minimal fake for window.mqtt: records connect URLs, lets tests fire
// client events, and records publishes. No timers, no network.
function makeFakeMqtt() {
  const clients = [];
  const urls = [];
  class FakeClient {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.published = [];
      this.ended = false;
      clients.push(this);
    }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
    emit(ev, ...args) { for (const fn of this.handlers[ev] || []) fn(...args); }
    subscribe() {}
    publish(topic, payload) { this.published.push({ topic, payload }); }
    end() { this.ended = true; }
  }
  return {
    clients,
    urls,
    mqtt: { connect: (url) => { urls.push(url); return new FakeClient(url); } },
  };
}

test('M10: missing mqtt bundle returns a no-op transport, never throws', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const statuses = [];
  const net = connectNet({ onRemote: () => {}, onLeave: () => {}, onStatus: (s) => statuses.push(s) });
  assert.deepEqual(statuses, ['offline']);
  assert.doesNotThrow(() => { net.publishPos({ x: 0, z: 0, yaw: 0 }); net.publishChat('hi', 'Gav'); net.disconnect(); });
});

test('M5: broker fallback, then offline after the list is exhausted', () => {
  const fake = makeFakeMqtt();
  globalThis.window = { mqtt: fake.mqtt };
  try {
    const statuses = [];
    connectNet({ onRemote: () => {}, onLeave: () => {}, onStatus: (s) => statuses.push(s) });
    assert.equal(fake.urls.length, 1);
    fake.clients[0].emit('error'); // broker 1 fails -> fallback
    assert.equal(fake.urls.length, 2);
    assert.equal(fake.clients[0].ended, true);
    fake.clients[1].emit('error'); // broker 2 fails -> offline, once
    fake.clients[1].emit('error'); // repeat failures must not spam
    assert.deepEqual(statuses, ['connecting', 'connecting', 'offline']);
  } finally {
    delete globalThis.window;
  }
});

test('M5: connect -> close -> reconnect reports each transition once', () => {
  const fake = makeFakeMqtt();
  globalThis.window = { mqtt: fake.mqtt };
  try {
    const statuses = [];
    connectNet({ onRemote: () => {}, onLeave: () => {}, onStatus: (s) => statuses.push(s) });
    const client = fake.clients[0];
    client.emit('connect');
    client.emit('close'); // live connection drops
    client.emit('connect'); // library reconnects
    assert.deepEqual(statuses, ['connecting', 'connected', 'reconnecting', 'connected']);
  } finally {
    delete globalThis.window;
  }
});

test('M5+M6: message handler drops invalid payloads, passes valid ones', () => {
  const fake = makeFakeMqtt();
  globalThis.window = { mqtt: fake.mqtt };
  try {
    const seen = [];
    const left = [];
    connectNet({
      onRemote: (topic, msg) => seen.push([topic, msg]),
      onLeave: (id) => left.push(id),
      onStatus: () => {},
    });
    const client = fake.clients[0];
    client.emit('connect');
    const send = (topic, raw) => client.emit('message', topic, Buffer.from(raw));
    send('owf/pos', '{"id":"bad","x":1e999,"z":0,"yaw":0}');
    send('owf/pos', '{"id":"ok","x":1,"z":2,"yaw":0.5}');
    send('owf/chat', '{"id":"c","text":42}');
    send('owf/chat', '{"id":"c","name":"Gav","text":"halo"}');
    send('owf/leave', '{"id":7}');
    send('owf/leave', '{"id":"gone"}');
    assert.deepEqual(seen.map(([t]) => t), ['owf/pos', 'owf/chat']);
    assert.deepEqual(left, ['gone']);
  } finally {
    delete globalThis.window;
  }
});
