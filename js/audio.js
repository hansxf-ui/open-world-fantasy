// Stage 3 ambient sound: 100% procedural WebAudio, zero audio files.
//
// Three sources, all gentle by design (this is a cozy world, not a
// concert): wind (filtered noise, always present), birds (sparse
// sine chirps, forest/city), water (filtered noise, sea/shore).
// The module is inert until start() is called: importing it creates
// no AudioContext, so Node tests can import it freely and the game
// never autoplays before the Masuk Dunia tap (the user gesture that
// allows AudioContext.resume on mobile).

export const AUDIO_LEVELS = {
  wind: 0.08,
  water: 0.10,
  chirp: 0.16,
};

export const MUTE_KEY = 'owf-muted';

// Zone -> per-source multipliers in [0, 1]. Pure, tested. depth is
// waterDepth at the player position (0 on dry land).
export function zoneGains(zone, depth) {
  const wind = zone === 'desert' || zone === 'snow' ? 1.0
    : zone === 'sea' ? 0.9
    : zone === 'beach' ? 0.8
    : zone === 'forest' ? 0.6 : 0.7;
  const birds = zone === 'forest' ? 1.0
    : zone === 'city' ? 0.6
    : zone === 'beach' ? 0.5
    : zone === 'desert' ? 0.15
    : zone === 'snow' ? 0.1 : 0.05;
  const water = zone === 'sea' ? 1.0 : depth > 0 ? 0.5 : 0;
  return { wind, birds, water };
}

// Sparse chirp scheduling: 2-8 s apart, so birds never chatter.
export function nextChirpDelay(rand) {
  return 2 + rand() * 6;
}

// One chirp = 1-3 quick sine blips, each gliding in pitch.
export function chirpParams(rand) {
  const blips = 1 + Math.floor(rand() * 3);
  const parts = [];
  let f = 2000 + rand() * 1200;
  for (let i = 0; i < blips; i++) {
    const f1 = f * (0.75 + rand() * 0.5);
    parts.push({ f0: f, f1, dur: 0.06 + rand() * 0.08 });
    f = f1;
  }
  return parts;
}

function defaultContext() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  return AC ? new AC() : null;
}

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// opts: { rand, createContext, storage } — all injectable for tests.
// storage defaults to localStorage when present, else in-memory.
export function createAudio(opts = {}) {
  const rand = opts.rand || Math.random;
  const realStorage = typeof localStorage !== 'undefined' ? localStorage : null;
  const storage = opts.storage || realStorage;
  const mem = {};
  const get = (k) => {
    try { return storage ? storage.getItem(k) : (mem[k] ?? null); }
    catch { return mem[k] ?? null; }
  };
  const set = (k, v) => {
    try { if (storage) storage.setItem(k, v); else mem[k] = v; }
    catch { mem[k] = v; }
  };

  let muted = get(MUTE_KEY) === '1';
  let ctx = null;
  let master = null;
  let windGain = null;
  let waterGain = null;
  let started = false;
  let suspended = false;
  let chirpTimer = 1.5;
  let lastGains = null;

  function setTarget(param, value) {
    if (!param) return;
    try {
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, ctx.currentTime, 0.5);
      else param.value = value;
    } catch { try { param.value = value; } catch { /* ignore */ } }
  }

  function loopedNoise(noise, filterFreq) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
    return g;
  }

  function playChirp() {
    if (!ctx || muted) return;
    const parts = chirpParams(rand);
    let t = ctx.currentTime + 0.02;
    for (const p of parts) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(p.f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(50, p.f1), t + p.dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(AUDIO_LEVELS.chirp, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + p.dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + p.dur + 0.05);
      t += p.dur + 0.03;
    }
  }

  function start() {
    if (started) return true;
    try {
      const factory = opts.createContext || defaultContext;
      ctx = factory();
      if (!ctx) return false;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      const noise = makeNoiseBuffer(ctx);
      windGain = loopedNoise(noise, 400);
      waterGain = loopedNoise(noise, 900);
      try {
        const p = ctx.resume && ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* resume is best-effort */ }
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) suspend();
          else resume();
        });
      }
      started = true;
      return true;
    } catch { return false; }
  }

  function update(dt, zone, depth) {
    if (!started || !ctx) return;
    const g = zoneGains(zone, depth);
    if (!lastGains
      || Math.abs(g.wind - lastGains.wind) > 0.01
      || Math.abs(g.water - lastGains.water) > 0.01) {
      setTarget(windGain.gain, AUDIO_LEVELS.wind * g.wind);
      setTarget(waterGain.gain, AUDIO_LEVELS.water * g.water);
      lastGains = g;
    }
    chirpTimer -= dt;
    if (chirpTimer <= 0) {
      if (!muted && g.birds >= 0.1) playChirp();
      chirpTimer = nextChirpDelay(rand);
    }
  }

  function setMuted(m) {
    muted = !!m;
    set(MUTE_KEY, muted ? '1' : '0');
    if (master) setTarget(master.gain, muted ? 0 : 1);
    return muted;
  }

  function suspend() {
    if (!ctx || suspended) return;
    try {
      const p = ctx.suspend && ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      suspended = true;
    } catch { /* ignore */ }
  }

  function resume() {
    if (!ctx || !suspended || muted) return;
    try {
      const p = ctx.resume && ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      suspended = false;
    } catch { /* ignore */ }
  }

  return {
    start, update, setMuted, suspend, resume,
    isMuted: () => muted,
    isStarted: () => started,
  };
}
