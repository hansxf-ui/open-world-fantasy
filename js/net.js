import { SYNC } from './config.js';

// Multiplayer sync over public MQTT/WSS. Broker choice at runtime:
// primary broker.emqx.io:8084/mqtt, fallback test.mosquitto.org:8081/mqtt.
// The first broker that connects wins; the working one is the one the
// client stays connected to (see connectNet). Positions are
// client-trusted (no authoritative server in v1) — acceptable because
// v1 has no combat, score, or economy, per spec §6.3.

// ---- Pure sync math (testable in Node) ----

export function shouldSend(last, next) {
  const dist = Math.hypot(next.x - last.x, next.z - last.z);
  const yawDiff = Math.abs(Math.atan2(Math.sin(next.yaw - last.yaw), Math.cos(next.yaw - last.yaw)));
  return dist >= SYNC.deadbandM || yawDiff >= (SYNC.deadbandDeg * Math.PI) / 180;
}

// Exponential smoothing: at 10/s, one 0.1 s step moves ~63% of the way,
// never overshooting; at 60 fps each frame moves ~15%.
export function interpolatePos(current, target, dt) {
  const a = Math.min(1, 1 - Math.exp(-SYNC.interpRate * dt));
  return {
    x: current.x + (target.x - current.x) * a,
    y: current.y + (target.y - current.y) * a,
    z: current.z + (target.z - current.z) * a,
  };
}

export function inInterestRadius(self, other) {
  return Math.hypot(other.x - self.x, other.z - self.z) <= SYNC.interestM;
}

// remotes: { id: lastSeenMs }. Returns ids silent longer than staleSec.
export function pruneStale(remotes, now) {
  const out = [];
  for (const id of Object.keys(remotes)) {
    if (now - remotes[id] > SYNC.staleSec * 1000) out.push(id);
  }
  return out;
}

// Keyed by payload id, never by name: same name stays two entries.
export function upsertRemote(remotes, payload) {
  remotes[payload.id] = { ...payload, lastSeen: Date.now() };
  return remotes;
}

// Publish decision: movement past the deadband always sends; an idle
// player still heartbeats every 4 s so peers never prune them as stale
// (the prune threshold is 5 s).
export function shouldPublish(lastSent, lastSentAt, now, payload) {
  if (!lastSent) return true;
  if (shouldSend(lastSent, payload)) return true;
  return now - lastSentAt > 4000;
}

export function makeChatPayload(id, name, text) {
  return { id, name, text, ts: Date.now() };
}

// ---- Inbound payload validation (M6) ----
// Positions arrive from untrusted peers over a public broker. JSON
// cannot spell NaN, but 1e999 parses to Infinity, and a hostile or
// buggy client can send strings where numbers belong — either would
// poison interpolation and the minimap. Finite numbers + string
// types are required; optional fields, when present, must also be
// well-typed. Invalid payloads are dropped by the message handler.

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function hasId(msg) {
  return !!msg && typeof msg === 'object' && !Array.isArray(msg)
    && typeof msg.id === 'string' && msg.id.length > 0;
}

// Character variant: 'female' | 'male'. Missing or unknown values
// coerce to 'female' at the consumer (old clients send no variant at
// all); the validator only requires the field, when present, to be a
// string, so a mistyped value never drops a position update.
export function normalizeVariant(v) {
  return v === 'male' ? 'male' : 'female';
}

export function isValidPosPayload(msg) {
  if (!hasId(msg)) return false;
  if (!isFiniteNumber(msg.x) || !isFiniteNumber(msg.z) || !isFiniteNumber(msg.yaw)) return false;
  if (msg.y !== undefined && !isFiniteNumber(msg.y)) return false;
  if (msg.name !== undefined && typeof msg.name !== 'string') return false;
  if (msg.color !== undefined && typeof msg.color !== 'string') return false;
  if (msg.state !== undefined && typeof msg.state !== 'string') return false;
  if (msg.variant !== undefined && typeof msg.variant !== 'string') return false;
  return true;
}

export function isValidChatPayload(msg) {
  if (!hasId(msg)) return false;
  if (typeof msg.text !== 'string') return false;
  if (msg.name !== undefined && typeof msg.name !== 'string') return false;
  return true;
}

// ---- Browser transport (uses window.mqtt from the vendored bundle) ----

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const TOPICS = { pos: 'owf/pos', chat: 'owf/chat', join: 'owf/join', leave: 'owf/leave' };

// Status reports for the HUD (M5): 'connecting' while trying a
// broker, 'connected' once subscribed, 'reconnecting' when a live
// connection drops (mqtt.js keeps retrying in the background),
// 'offline' when no broker could be reached at all before the first
// connect, or when the mqtt bundle itself is missing (M10). The
// callback is optional; without it the game still plays solo.
export function connectNet({ onRemote, onLeave, onStatus }) {
  const id = 'owf-' + Math.random().toString(36).slice(2, 10);
  const report = (s) => { if (onStatus) onStatus(s); };

  // M10: if the vendored bundle failed to load, window.mqtt is
  // undefined and the old code threw on .connect, killing init.
  // Return a no-op transport instead: publish calls silently drop,
  // the game plays solo, and the HUD shows the offline state.
  if (typeof window === 'undefined' || !window.mqtt) {
    report('offline');
    return {
      id,
      publishPos() {},
      publishChat() {},
      disconnect() {},
    };
  }

  let client = null;
  let brokerIndex = 0;
  let connected = false;
  let everConnected = false;
  let offlineReported = false;
  let closed = false;
  let lastSent = null;
  let lastSentAt = 0;

  function start(url) {
    report('connecting');
    client = window.mqtt.connect(url, {
      clientId: id,
      clean: true,
      connectTimeout: 5000,
      will: { topic: TOPICS.leave, payload: JSON.stringify({ id }), qos: 0, retain: false },
    });
    client.on('connect', () => {
      connected = true;
      everConnected = true;
      offlineReported = false;
      report('connected');
      client.subscribe([TOPICS.pos, TOPICS.chat, TOPICS.join, TOPICS.leave]);
      client.publish(TOPICS.join, JSON.stringify({ id }));
    });
    client.on('message', (topic, buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!msg || msg.id === id) return;
      if (topic === TOPICS.leave) {
        if (typeof msg.id === 'string') onLeave(msg.id);
      } else if (topic === TOPICS.chat) {
        if (isValidChatPayload(msg)) onRemote(topic, msg);
      } else if (topic === TOPICS.pos || topic === TOPICS.join) {
        if (isValidPosPayload(msg)) onRemote(topic, msg);
      }
    });
    client.on('error', () => {
      // Initial connect only: fall through the broker list once.
      // After the first successful connect, drops are the library's
      // own reconnect loop ('close' reports 'reconnecting'), and
      // repeating 'offline' on every retry failure would spam the UI.
      if (connected || everConnected) return;
      if (brokerIndex + 1 < BROKERS.length) {
        brokerIndex++;
        try {
          client.end(true);
        } catch {
          /* ignore */
        }
        start(BROKERS[brokerIndex]);
      } else if (!offlineReported) {
        offlineReported = true;
        report('offline');
      }
    });
    client.on('close', () => {
      if (closed || !connected) return;
      connected = false;
      report('reconnecting');
    });
  }

  start(BROKERS[brokerIndex]);

  return {
    id,
    publishPos(payload) {
      if (!connected) return;
      const now = Date.now();
      if (now - lastSentAt < 1000 / SYNC.hz) return;
      if (!shouldPublish(lastSent, lastSentAt, now, payload)) return;
      lastSent = { x: payload.x, z: payload.z, yaw: payload.yaw };
      lastSentAt = now;
      client.publish(TOPICS.pos, JSON.stringify({ ...payload, id }));
    },
    publishChat(text, name) {
      if (!connected) return;
      client.publish(TOPICS.chat, JSON.stringify(makeChatPayload(id, name, text)));
    },
    disconnect() {
      closed = true;
      if (!client) return;
      try {
        client.publish(TOPICS.leave, JSON.stringify({ id }));
        client.end();
      } catch {
        /* ignore */
      }
    },
  };
}
