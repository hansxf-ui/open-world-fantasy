import * as THREE from './vendor/three.module.js';
import { COLORS, BUDGETS, SYNC, CHAT, SPEED, CAMERA, dprPolicy } from './config.js';
import { buildWorld, groundHeight, waterDepth, zoneAt } from './world.js';
import { buildHumanoid, nextAnimState, poseHumanoid, recolorShirt, disposeObject3D } from './character.js';
import { drawMinimap } from './minimap.js';
import { clampJoystick, moveVector, stepVertical, clampCamera, cameraPos, easeToward, zoomByPinch, zoomByWheel, collidesAt, turnToward, isTap, deadzoneLatch, resolveVertical } from './controls.js';
import { connectNet, inInterestRadius, interpolatePos, pruneStale, upsertRemote, normalizeVariant } from './net.js';
import { canSend, formatChat, receiveChat } from './chat.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---- Identity: name + shirt color, stored locally (no login) ----
let playerName = localStorage.getItem('owf-name') || '';
let playerColor = localStorage.getItem('owf-color') || COLORS[0];
if (!COLORS.includes(playerColor)) playerColor = COLORS[0];
let playerGender = localStorage.getItem('owf-gender') || 'female';
if (!['female', 'male'].includes(playerGender)) playerGender = 'female';

const nameInput = $('nameInput');
const swatchesEl = $('swatches');
nameInput.value = playerName;
COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = c;
  b.dataset.color = c;
  if (c === playerColor) b.classList.add('selected');
  b.addEventListener('click', () => {
    playerColor = c;
    swatchesEl.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
  });
  swatchesEl.appendChild(b);
});

// Gender picker: same pattern as the swatches (selected ring,
// stored locally). Switching rebuilds the local humanoid, never a
// geometry swap, because recolor mutates vertex colors.
const genderEl = $('genderPicker');
[['female', 'Cewek'], ['male', 'Cowok']].forEach(([v, label]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.gender = v;
  if (v === playerGender) b.classList.add('selected');
  b.addEventListener('click', () => {
    playerGender = v;
    localStorage.setItem('owf-gender', v);
    genderEl.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    rebuildLocalPlayer();
  });
  genderEl.appendChild(b);
});

// ---- Scene boot (empty world; filled by later tasks) ----
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
let currentDpr = Math.min(window.devicePixelRatio || 1, BUDGETS.dprMax);
renderer.setPixelRatio(currentDpr);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffe6c4);
scene.fog = new THREE.Fog(0xffe6c4, 60, 160);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 3, 8);

// Cozy lighting: warm hemisphere dominant + soft directional, no shadows.
const hemi = new THREE.HemisphereLight(0xfff2dd, 0x8a6a4a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b0, 0.7);
sun.position.set(40, 60, 20);
scene.add(sun);

// Loading screen: visible in HTML from first paint; JS hides it once
// the world is built (boot) or the player has entered (tap).
const loadingEl = document.getElementById('loading');
const loadingStageEl = document.getElementById('loadingStage');
let loadingFadeTimer = null;
function showLoading(text) {
  if (loadingFadeTimer) { clearTimeout(loadingFadeTimer); loadingFadeTimer = null; }
  if (loadingStageEl) loadingStageEl.textContent = text;
  if (loadingEl) { loadingEl.classList.remove('fading'); loadingEl.classList.remove('hidden'); }
}
function hideLoading() {
  if (!loadingEl || loadingEl.classList.contains('hidden')) return;
  loadingEl.classList.add('fading');
  loadingFadeTimer = setTimeout(() => { loadingEl.classList.add('hidden'); }, 450);
}
const bootT0 = performance.now();

const world = buildWorld(scene);
const clock = new THREE.Clock();

// Name label helper: canvas sprite above the head, always faces camera.
function makeLabel(text) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  function draw(t) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.8)';
    ctx.strokeText(t, 128, 32);
    ctx.fillStyle = '#fff8ec';
    ctx.fillText(t, 128, 32);
    tex.needsUpdate = true;
  }
  draw(text);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2, 0.5, 1);
  return { sprite, setText: draw };
}

// Local character + name label.
let player = buildHumanoid(playerColor, playerGender);
player.position.set(0, groundHeight(0, 0), 0);
scene.add(player);
const localLabel = makeLabel(playerName || 'Petualang');
localLabel.sprite.position.y = 2.65;
player.add(localLabel.sprite);

// Gender switch rebuilds the local humanoid: the old group is
// disposed (its geometries are fresh per humanoid) and a new one
// takes its place, keeping position, rotation, and the label sprite.
// A transient chat balloon on the old group may drop with it; that
// is a transient element by design, not state.
function rebuildLocalPlayer() {
  const old = player;
  const next = buildHumanoid(playerColor, playerGender);
  next.position.copy(old.position);
  next.rotation.copy(old.rotation);
  old.remove(localLabel.sprite);
  next.add(localLabel.sprite);
  scene.remove(old);
  disposeObject3D(old);
  scene.add(next);
  player = next;
}

// Remote players.
let net = null;
const remoteData = {}; // id -> latest pos payload (+ lastSeen)
const remoteGroups = {}; // id -> THREE.Group
let pruneTimer = 0;
function removeRemote(id) {
  const g = remoteGroups[id];
  if (g) {
    scene.remove(g);
    disposeObject3D(g); // geometries + label texture are per-player; free them
  }
  delete remoteGroups[id];
  delete remoteData[id];
}
function spawnRemote(msg) {
  const variant = normalizeVariant(msg.variant);
  const g = buildHumanoid(msg.color || '#f6c9a8', variant);
  g.userData.variant = variant;
  g.position.set(msg.x, msg.y, msg.z);
  const label = makeLabel(msg.name || 'Petualang');
  label.sprite.position.y = 2.65;
  g.add(label.sprite);
  scene.add(g);
  remoteGroups[msg.id] = g;
}

// ---- Chat UI ----
let lastChatSent = 0;
function appendChatLine(text) {
  const lines = $('chatLines');
  const div = document.createElement('div');
  div.textContent = text;
  lines.appendChild(div);
  while (lines.children.length > CHAT.panelLines) lines.removeChild(lines.firstChild);
  lines.scrollTop = lines.scrollHeight;
}
function showFloating(group, text) {
  const label = makeLabel(text);
  label.sprite.position.y = 3.25;
  group.add(label.sprite);
  setTimeout(() => {
    group.remove(label.sprite);
    disposeObject3D(label.sprite); // its canvas texture is per-message
  }, 4000);
}

// Multiplayer connection status (M5): a small top-center line, only
// visible while not connected. pointer-events none (see CSS) so it
// never eats a camera drag or joystick touch.
const NET_STATUS_TEXT = {
  connecting: 'Menghubungkan multiplayer…',
  reconnecting: 'Koneksi putus — menyambung lagi…',
  offline: 'Multiplayer offline — main sendiri dulu, nyambung otomatis kalau server kembali',
};
function showNetStatus(status) {
  const el = $('netStatus');
  if (status === 'connected') {
    el.style.display = 'none';
    return;
  }
  el.textContent = NET_STATUS_TEXT[status] || '';
  el.style.display = el.textContent ? 'block' : 'none';
}
// ---- Ambient sound: procedural WebAudio, starts only on entry ----
const audio = createAudio();
const muteBtn = $('muteBtn');
function syncMuteBtn() { muteBtn.textContent = audio.isMuted() ? '🔇' : '🔊'; }
syncMuteBtn();
muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.isMuted());
  syncMuteBtn();
});

$('chatBtn').addEventListener('click', () => {
  $('chatPanel').classList.toggle('hidden');
  if (!$('chatPanel').classList.contains('hidden')) $('chatInput').focus();
});
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const m = formatChat(playerName, $('chatInput').value);
  if (!m.text) return;
  const now = Date.now();
  if (!net || !canSend(lastChatSent, now)) {
    const btn = $('chatBtn');
    btn.classList.add('shake');
    setTimeout(() => btn.classList.remove('shake'), 300);
    return;
  }
  lastChatSent = now;
  net.publishChat(m.text, playerName);
  appendChatLine(`${m.name}: ${m.text}`);
  showFloating(player, m.text);
  $('chatInput').value = '';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Build tag, shown in the FPS meter so a screen recording proves
// which code is running (a re-enter does not reload the page's JS;
// only a fresh tab load fetches a new build).
const BUILD = '2026-10-26-fix8';
$('fps').textContent = `FPS: -- · ${BUILD}`;

// Round minimap (top-right): whole-world overview, CSS 120 px, backing
// store scaled for device pixels so it stays crisp on phones.
const MINIMAP_SIZE = 120;
const minimapEl = $('minimap');
const minimapCtx = minimapEl.getContext('2d');
{
  const dpr = Math.min(window.devicePixelRatio || 1, BUDGETS.dprMax);
  minimapEl.width = MINIMAP_SIZE * dpr;
  minimapEl.height = MINIMAP_SIZE * dpr;
}
let minimapTimer = 0;

// FPS meter + DPR step-down + distance culling state.
const frameTimes = [];
let fpsTimer = 0;
let dprElapsed = 0;
let dprWindowMs = 0;
let dprFrames = 0;
let cullTimer = 0;

// ---- Controls state ----
let entered = false;
const joy = { x: 0, y: 0, active: false, id: null };
let camYaw = 0;
let camPitch = 0.35;
let vy = 0;
let grounded = true;
let wasSwimming = false;
let animState = 'idle';
let animT = 0;
let wasMoving = false; // deadzoneLatch state (see controls.js)
const camTarget = new THREE.Vector3(0, 0, 0);
let lastZone = null;
let toastTimer = null;

const ZONE_NAMES = { city: 'Kota', forest: 'Hutan', desert: 'Gurun', snow: 'Salju', sea: 'Laut', beach: 'Pantai' };
function showZoneToast(zone) {
  const el = $('zoneToast');
  el.textContent = ZONE_NAMES[zone] || zone;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// Joystick (pointer events cover touch + mouse).
const joyEl = $('joystick');
const stickEl = $('stick');
function joyCenter() {
  const r = joyEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width / 2 };
}
joyEl.addEventListener('pointerdown', (e) => {
  if (joy.active) return; // second finger on the stick is ignored
  joy.active = true;
  joy.id = e.pointerId;
  joyEl.setPointerCapture(e.pointerId);
});
joyEl.addEventListener('pointermove', (e) => {
  if (!joy.active || e.pointerId !== joy.id) return;
  const c = joyCenter();
  const j = clampJoystick((e.clientX - c.x) / c.rad, (e.clientY - c.y) / c.rad);
  joy.x = j.x;
  joy.y = j.y;
  stickEl.style.transform = `translate(${j.x * 32}px, ${j.y * 32}px)`;
});
function endJoy(e) {
  if (!joy.active || e.pointerId !== joy.id) return;
  joy.active = false;
  joy.id = null;
  joy.x = 0;
  joy.y = 0;
  stickEl.style.transform = 'translate(0px, 0px)';
}
joyEl.addEventListener('pointerup', endJoy);
joyEl.addEventListener('pointercancel', endJoy);

// Camera orbit + pinch zoom: drag anywhere on the 3D view. One finger
// orbits (vertical drag follows the finger: drag down = camera down);
// two fingers pinch-zoom; the mouse wheel zooms on desktop. Pointer
// capture + id tracking keep a drag alive over HUD elements and keep
// the joystick finger from stealing or killing it.
let camDrag = null;
let camDist = CAMERA.dist;
const canvasPointers = new Map(); // pointerId -> {x, y}
let pinch = null; // {d0, dist0}
renderer.domElement.addEventListener('pointerdown', (e) => {
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);
  if (canvasPointers.size === 2) {
    const [a, b] = [...canvasPointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: camDist };
    camDrag = null;
  } else if (canvasPointers.size === 1) {
    camDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!canvasPointers.has(e.pointerId)) return;
  canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && canvasPointers.size === 2) {
    const [a, b] = [...canvasPointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) camDist = zoomByPinch(pinch.dist0, pinch.d0, d);
    return;
  }
  if (!camDrag || e.pointerId !== camDrag.id) return;
  camYaw -= (e.clientX - camDrag.x) * 0.005;
  camPitch = clampCamera(camPitch + (e.clientY - camDrag.y) * 0.005);
  camDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
function endCam(e) {
  const wasPinch = !!pinch;
  canvasPointers.delete(e.pointerId);
  if (canvasPointers.size < 2) pinch = null;
  if (camDrag && e.pointerId === camDrag.id) camDrag = null;
  if (wasPinch && canvasPointers.size === 2) {
    // A third finger left mid-pinch: re-baseline on the remaining pair.
    const [a, b] = [...canvasPointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: camDist };
  } else if (wasPinch && canvasPointers.size === 1) {
    // The remaining finger becomes a fresh orbit drag.
    const [[id, p]] = [...canvasPointers.entries()];
    camDrag = { id, x: p.x, y: p.y };
  }
}
renderer.domElement.addEventListener('pointerup', endCam);
renderer.domElement.addEventListener('pointercancel', endCam);
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = zoomByWheel(camDist, e.deltaY);
}, { passive: false });

// Jump button: a clean tap jumps; a drag starting on the button
// orbits the camera (forwarded, same math as the canvas drag).
// The button sits where the camera thumb rests (68 px, bottom
// right), so it must never eat a camera action: the old
// pointerdown jump turned every drag-start into a jump, and the
// tap-only version still left drag-starts dead (no orbit) while
// tap-starts kept jumping. Now tap = jump, drag = orbit, and no
// touch on the button can produce an accidental jump.
let jumpTap = null;
let jumpDrag = null; // {id, x, y} once the finger passes tap range
const jumpBtn = $('jumpBtn');
jumpBtn.addEventListener('pointerdown', (e) => {
  jumpTap = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now(), lx: e.clientX, ly: e.clientY };
  jumpDrag = null;
  jumpBtn.setPointerCapture(e.pointerId);
});
jumpBtn.addEventListener('pointermove', (e) => {
  // Drag already in progress: keep orbiting from the last position.
  if (jumpDrag && e.pointerId === jumpDrag.id) {
    camYaw -= (e.clientX - jumpDrag.lx) * 0.005;
    camPitch = clampCamera(camPitch + (e.clientY - jumpDrag.ly) * 0.005);
    jumpDrag.lx = e.clientX; jumpDrag.ly = e.clientY;
    return;
  }
  if (!jumpTap || e.pointerId !== jumpTap.id) return;
  if (Math.hypot(e.clientX - jumpTap.x, e.clientY - jumpTap.y) <= 15) {
    jumpTap.lx = e.clientX; jumpTap.ly = e.clientY;
    return;
  }
  // Past tap range: this is a camera drag, not a jump. Apply the
  // incremental delta from the last seen position (no jump).
  camYaw -= (e.clientX - jumpTap.lx) * 0.005;
  camPitch = clampCamera(camPitch + (e.clientY - jumpTap.ly) * 0.005);
  jumpDrag = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
  jumpTap = null;
});
function jumpEnd(e) {
  if (jumpDrag && e.pointerId === jumpDrag.id) { jumpDrag = null; return; }
  const up = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  if (isTap(jumpTap, up) && grounded) {
    vy = 6;
    grounded = false;
  }
  jumpTap = null;
}
jumpBtn.addEventListener('pointerup', jumpEnd);
jumpBtn.addEventListener('pointercancel', () => { jumpTap = null; jumpDrag = null; });

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const u of world.updaters) u(dt, camera);

  // Minimap refresh: 10 Hz is plenty for a 120 px overview.
  minimapTimer += dt;
  if (minimapTimer >= 0.1) {
    minimapTimer = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, BUDGETS.dprMax);
    minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMinimap(minimapCtx, MINIMAP_SIZE, {
      x: player.position.x, z: player.position.z, yaw: player.rotation.y,
    }, Object.values(remoteData).map((d) => ({ x: d.x, z: d.z, color: d.color })));
  }

  // FPS meter (rolling 60-frame average, refreshed twice a second).
  frameTimes.push(dt * 1000);
  if (frameTimes.length > 60) frameTimes.shift();
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsTimer = 0;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    $('fps').textContent = `FPS: ${Math.round(1000 / avg)} · ${BUILD}`;
  }
  // DPR step-down on sustained load (3 s window, no step-up in v1).
  dprElapsed += dt;
  dprWindowMs += dt * 1000;
  dprFrames++;
  if (dprElapsed >= 3) {
    const avg = dprWindowMs / Math.max(1, dprFrames);
    const next = dprPolicy(avg, currentDpr);
    if (next !== currentDpr) {
      currentDpr = next;
      renderer.setPixelRatio(currentDpr);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    dprElapsed = 0;
    dprWindowMs = 0;
    dprFrames = 0;
  }
  // Distance culling for city meshes (instanced vegetation is already
  // a handful of draw calls; fog fades the far field).
  cullTimer += dt;
  if (cullTimer >= 0.5) {
    cullTimer = 0;
    for (const m of world.cullables) {
      const dx = m.position.x - camera.position.x;
      const dz = m.position.z - camera.position.z;
      m.visible = dx * dx + dz * dz < 150 * 150;
    }
  }

  if (entered) {
    const rawMag = Math.hypot(joy.x, joy.y);
    // Deadzone WITH hysteresis (controls.deadzoneLatch): a single
    // threshold flips stopped/moving every time thumb tremor crosses
    // it, and the limbs shudder on their own (kejang) — worst at the
    // hands, the longest lever. Latch: start past 0.15, stop only
    // below 0.08, so noise inside the band cannot flip the state.
    const latched = deadzoneLatch(rawMag, wasMoving);
    wasMoving = latched.moving;
    const mag = latched.mag;
    const dir = moveVector(joy, camYaw);
    const depth = waterDepth(player.position.x, player.position.z);
    // Movement speed follows the latched run state (same 0.75/0.9
    // thresholds as the pose latch in nextAnimState), not the raw
    // stick: raw mag would pulse the speed 4<->7 across the 0.9
    // edge even while the pose holds steady.
    const runLatch = animState === 'run' ? mag >= 0.75 : mag >= 0.9;
    let speed = runLatch ? SPEED.run : SPEED.walk;
    if (depth >= 0.8) speed *= 0.55;
    const move = speed * mag;
    if (mag > 0.01) {
      // Axis-separated movement with collision: try x, then z, so the
      // player slides along walls instead of passing through them.
      const nx = Math.max(-195, Math.min(195, player.position.x + dir.x * move * dt));
      player.position.x = collidesAt(nx, player.position.z, world.colliders, 0.4)
        ? player.position.x
        : nx;
      const nz = Math.max(-195, Math.min(195, player.position.z + dir.z * move * dt));
      player.position.z = collidesAt(player.position.x, nz, world.colliders, 0.4)
        ? player.position.z
        : nz;
      // Turn toward the stick direction instead of snapping to it:
      // a trembling thumb would otherwise spin the body frame to
      // frame. Same blend rate as the pose (~250 ms to settle).
      player.rotation.y = turnToward(player.rotation.y, Math.atan2(dir.x, dir.z), Math.min(1, dt * 12));
    }
    // Vertical: gravity, ground, floating in deep water.
    if (depth >= 0.8) {
      // Ease to the waterline instead of snapping: entering from a
      // dune glides down, and leaving glides back up (wasSwimming).
      player.position.y = easeToward(player.position.y, 0.1, dt, 5);
      wasSwimming = true;
      vy = 0;
      grounded = false;
    } else {
      // Gravity + ground via controls.resolveVertical, which keeps a
      // grounded runner glued on downhill steps (the kejang fix).
      const r = resolveVertical(player.position.y, vy, groundHeight(player.position.x, player.position.z), grounded, wasSwimming, dt);
      player.position.y = r.y;
      vy = r.vy;
      grounded = r.grounded;
      wasSwimming = r.wasSwimming;
    }
    const airborne = !grounded && depth < 0.8;
    animState = nextAnimState(animState, { mag, depth, airborne });
    animT += dt * (animState === 'run' ? 12 : animState === 'walk' ? 8 : animState === 'swim' ? 6 : 1);
    poseHumanoid(player, animState, animT, dt);

    // Camera follow with light smoothing.
    camTarget.lerp(player.position, 0.15);
    const cp = cameraPos(camTarget, camYaw, camPitch, camDist);
    camera.position.set(cp.x, cp.y, cp.z);
    camera.lookAt(camTarget.x, camTarget.y + 1.5, camTarget.z);

    // Zone toast on change.
    const zone = zoneAt(player.position.x, player.position.z);
    if (zone !== lastZone) {
      lastZone = zone;
      showZoneToast(zone);
    }

    // Ambient sound follows the player's zone + water depth.
    audio.update(dt, zone, depth);

    // Multiplayer: publish self, interpolate remotes, prune stale/far ones.
    if (net) {
      net.publishPos({
        name: playerName, color: playerColor, variant: playerGender,
        x: player.position.x, y: player.position.y, z: player.position.z,
        yaw: player.rotation.y, state: animState,
      });
      for (const id of Object.keys(remoteGroups)) {
        const data = remoteData[id];
        const g = remoteGroups[id];
        if (!data) continue;
        if (!inInterestRadius(player.position, data)) {
          removeRemote(id);
          continue;
        }
        const np = interpolatePos(g.position, data, dt);
        g.position.set(np.x, np.y, np.z);
        g.rotation.y = data.yaw;
        poseHumanoid(g, data.state || 'idle', animT, dt);
      }
      pruneTimer += dt;
      if (pruneTimer >= 1) {
        pruneTimer = 0;
        const seen = {};
        for (const [k, v] of Object.entries(remoteData)) seen[k] = v.lastSeen;
        pruneStale(seen, Date.now()).forEach(removeRemote);
      }
    }
  } else {
    camera.lookAt(player.position.x, player.position.y + 1.2, player.position.z);
  }

  renderer.render(scene, camera);
}
animate();

// Boot done: world built, first frames running. Name the ready stage,
// then fade the loading screen (never faster than 900 ms from boot,
// so it never flashes past).
if (loadingStageEl) loadingStageEl.textContent = 'Dunia siap, silakan masuk.';
const bootRemain = Math.max(0, 900 - (performance.now() - bootT0));
setTimeout(hideLoading, bootRemain);

$('enterBtn').addEventListener('click', () => {
  showLoading('Masuk dunia…');
  playerName = nameInput.value.trim() || 'Petualang';
  localStorage.setItem('owf-name', playerName);
  localStorage.setItem('owf-color', playerColor);
  localStorage.setItem('owf-gender', playerGender);
  localLabel.setText(playerName);
  recolorShirt(player, playerColor);
  entered = true;
  audio.start(); // inside the tap gesture, so resume is allowed
  net = connectNet({
    onRemote: (topic, msg) => {
      if (topic === 'owf/chat') {
        receiveChat(msg, {
          findGroup: (id) => remoteGroups[id],
          showFloating,
          appendLine: appendChatLine,
        });
        return;
      }
      if (topic !== 'owf/pos') return;
      // A remote that changed variant (re-entered as the other
      // gender) rebuilds instead of keeping the old body.
      if (remoteGroups[msg.id] && remoteGroups[msg.id].userData.variant !== normalizeVariant(msg.variant)) {
        removeRemote(msg.id);
      }
      upsertRemote(remoteData, msg);
      if (!remoteGroups[msg.id]
        && Object.keys(remoteGroups).length < SYNC.renderCap
        && inInterestRadius(player.position, msg)) {
        spawnRemote(msg);
      }
    },
    onLeave: (id) => removeRemote(id),
    onStatus: showNetStatus,
  });
  camTarget.copy(player.position);
  $('entry').classList.add('hidden');
  $('hud').classList.remove('hidden');
  // The world is already built; the short delay only lets the fade
  // read as a transition instead of a snap.
  setTimeout(hideLoading, 150);
});
