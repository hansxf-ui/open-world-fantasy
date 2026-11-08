import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_LEVELS, MUTE_KEY, zoneGains, nextChirpDelay, chirpParams, createAudio,
} from '../js/audio.js';

// Deterministic rand, same algorithm as the game modules.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGain() {
  const calls = [];
  const gain = {
    value: 0,
    setValueAtTime(v) { gain.value = v; },
    linearRampToValueAtTime(v) { gain.value = v; },
    exponentialRampToValueAtTime(v) { gain.value = v; },
    setTargetAtTime(v) { calls.push(v); gain.value = v; },
  };
  return { gain, calls, connect() {} };
}

function makeFakeCtx() {
  const gains = [];
  let oscStarts = 0;
  let suspended = false;
  let resumeCount = 0;
  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createGain() { const g = makeGain(); gains.push(g); return g; },
    createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; },
    createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {} }; },
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; },
    createOscillator() {
      return {
        type: '',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        start() { oscStarts++; },
        stop() {},
      };
    },
    resume() { resumeCount++; return Promise.resolve(); },
    suspend() { suspended = true; return Promise.resolve(); },
  };
  return {
    ctx, gains,
    oscStarts: () => oscStarts,
    suspended: () => suspended,
    resumed: () => resumeCount,
  };
}

function makeStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    data,
  };
}

test('zone gains stay in range and match the zone character', () => {
  const cases = [
    ['city', 0], ['forest', 0], ['desert', 0], ['snow', 0], ['sea', 1], ['city', 0.5],
  ];
  for (const [zone, depth] of cases) {
    const g = zoneGains(zone, depth);
    for (const v of Object.values(g)) assert.ok(v >= 0 && v <= 1, `${zone} gain ${v} out of range`);
  }
  assert.equal(zoneGains('forest', 0).birds, 1);
  assert.ok(zoneGains('forest', 0).birds > zoneGains('city', 0).birds);
  assert.ok(zoneGains('city', 0).birds > zoneGains('sea', 1).birds);
  assert.equal(zoneGains('sea', 1).water, 1);
  assert.equal(zoneGains('city', 0).water, 0);
  assert.equal(zoneGains('city', 0.5).water, 0.5);
  assert.equal(zoneGains('beach', 0.3).wind, 0.8);
  assert.equal(zoneGains('beach', 0.3).birds, 0.5);
  assert.equal(zoneGains('beach', 0.3).water, 0.5);
  assert.equal(zoneGains('beach', 0).water, 0);
});

test('chirp delay is sparse and chirp params stay sane', () => {
  const rand = mulberry32(7);
  let lo = 99;
  let hi = 0;
  for (let i = 0; i < 50; i++) {
    const d = nextChirpDelay(rand);
    assert.ok(d >= 2 && d <= 8, `delay ${d} out of [2, 8]`);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  assert.ok(hi - lo > 2, 'delays must vary');
  const parts = chirpParams(mulberry32(11));
  assert.ok(parts.length >= 1 && parts.length <= 3, `blips ${parts.length} out of range`);
  for (const p of parts) {
    assert.ok(p.f0 >= 1500 && p.f0 <= 4500, `f0 ${p.f0} out of range`);
    assert.ok(p.f1 > 0, `f1 ${p.f1} must stay positive`);
    assert.ok(p.dur >= 0.05 && p.dur <= 0.2, `dur ${p.dur} out of range`);
  }
});

test('module is inert until start: no context, no throw, no sound', () => {
  const audio = createAudio();
  assert.equal(audio.isStarted(), false);
  assert.equal(audio.start(), false); // Node has no window.AudioContext
  assert.equal(audio.isStarted(), false);
  audio.update(1, 'forest', 0); // no-op, must not throw
  audio.setMuted(true);
  assert.equal(audio.isMuted(), true);
  audio.setMuted(false);
  assert.equal(audio.isMuted(), false);
});

test('start builds wind + water graph, update follows zone, mute persists', () => {
  const fake = makeFakeCtx();
  const storage = makeStorage();
  const audio = createAudio({
    createContext: () => fake.ctx,
    storage,
    rand: mulberry32(3),
  });
  assert.equal(audio.start(), true);
  assert.equal(audio.isStarted(), true);
  assert.equal(audio.start(), true); // idempotent
  // gains[0] = master, gains[1] = wind, gains[2] = water.
  assert.equal(fake.gains[0].gain.value, 1);
  audio.update(0.1, 'forest', 0);
  const windCalls = fake.gains[1].calls;
  const waterCalls = fake.gains[2].calls;
  assert.ok(windCalls.length > 0, 'wind gain must be set');
  assert.equal(windCalls[windCalls.length - 1], AUDIO_LEVELS.wind * 0.6);
  assert.equal(waterCalls[waterCalls.length - 1], 0);
  audio.update(0.1, 'sea', 1);
  assert.equal(fake.gains[2].calls[fake.gains[2].calls.length - 1], AUDIO_LEVELS.water);
  audio.setMuted(true);
  assert.equal(audio.isMuted(), true);
  assert.equal(storage.data[MUTE_KEY], '1');
  assert.equal(fake.gains[0].calls[fake.gains[0].calls.length - 1], 0);
  audio.setMuted(false);
  assert.equal(storage.data[MUTE_KEY], '0');
  assert.equal(fake.gains[0].calls[fake.gains[0].calls.length - 1], 1);
});

test('chirps fire in forest but stay silent at sea', () => {
  const forest = makeFakeCtx();
  const a = createAudio({
    createContext: () => forest.ctx,
    storage: makeStorage(),
    rand: mulberry32(5),
  });
  a.start();
  for (let t = 0; t < 30; t += 0.5) a.update(0.5, 'forest', 0);
  assert.ok(forest.oscStarts() > 0, 'forest must chirp within 30 s');

  const sea = makeFakeCtx();
  const b = createAudio({
    createContext: () => sea.ctx,
    storage: makeStorage(),
    rand: mulberry32(5),
  });
  b.start();
  for (let t = 0; t < 30; t += 0.5) b.update(0.5, 'sea', 1);
  assert.equal(sea.oscStarts(), 0, 'sea birds gain 0.05 is below the 0.1 chirp floor');
});

test('suspend/resume forward to the context, resume skipped while muted', () => {
  const fake = makeFakeCtx();
  const audio = createAudio({
    createContext: () => fake.ctx,
    storage: makeStorage(),
    rand: mulberry32(9),
  });
  audio.start();
  const resumesAtStart = fake.resumed(); // start() itself resumes once
  audio.suspend();
  assert.equal(fake.suspended(), true);
  audio.setMuted(true);
  audio.resume();
  assert.equal(fake.resumed(), resumesAtStart, 'muted resume must not touch the context');
  audio.setMuted(false);
  audio.resume();
  assert.equal(fake.resumed(), resumesAtStart + 1);
});
