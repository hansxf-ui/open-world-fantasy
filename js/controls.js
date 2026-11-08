import { groundHeight } from './world.js';
import { CAMERA } from './config.js';

// Pure control math (testable in Node). Input wiring lives in main.js.

export function clampJoystick(dx, dy) {
  const mag = Math.hypot(dx, dy);
  if (mag <= 1) return { x: dx, y: dy };
  return { x: dx / mag, y: dy / mag };
}

// Deadzone with hysteresis: a thumb hovering near the stick edge
// reports trembling magnitudes, and a single threshold would flip
// the character between stopped and moving every time the noise
// crosses it — the limbs shudder on their own (kejang) without any
// deliberate input. Latch: start moving past 0.15, stop only below
// 0.08, so noise inside the band cannot flip the state.
export function deadzoneLatch(rawMag, wasMoving) {
  if (wasMoving) {
    if (rawMag < 0.08) return { mag: 0, moving: false };
    return { mag: rawMag, moving: true };
  }
  if (rawMag < 0.15) return { mag: 0, moving: false };
  return { mag: rawMag, moving: true };
}

// True tap test for buttons that share the screen with drags: the
// finger went down and up on the button, moved less than maxDist,
// and lifted within maxMs. A drag that merely starts on the button
// is not a tap — it must not fire the button's action.
export function isTap(down, up, maxDist = 15, maxMs = 500) {
  if (!down || !up || down.id !== up.id) return false;
  if (up.t - down.t > maxMs) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= maxDist;
}

// Shortest-arc turn: move `current` toward `target` by fraction
// `alpha` (0..1), taking the short way around the ±π seam. The
// player's facing uses this so a noisy joystick never snaps the
// body around in one frame (the old code set rotation.y directly).
export function turnToward(current, target, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + d * a;
}

// Camera-relative move direction. Joystick up (y = -1) is forward.
// Returns a unit vector when the stick is pushed, (0, 0) when centered.
export function moveVector(joy, camYaw) {
  const mag = Math.hypot(joy.x, joy.y);
  if (mag < 1e-6) return { x: 0, z: 0 };
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  const mx = rx * joy.x + fx * -joy.y;
  const mz = rz * joy.x + fz * -joy.y;
  const m = Math.hypot(mx, mz) || 1;
  return { x: mx / m, z: mz / m };
}

export function stepVertical(vy, dt) {
  return vy + -18 * dt;
}

export function clampCamera(pitch) {
  return Math.min(1.1, Math.max(-0.15, pitch));
}

// Camera position: 6 m from the target at the given orbit yaw/pitch,
// never below 0.5 m above the ground.
export function cameraPos(target, yaw, pitch, dist = CAMERA.dist) {
  const hDist = dist * Math.cos(pitch);
  const x = target.x + Math.sin(yaw) * hDist;
  const z = target.z + Math.cos(yaw) * hDist;
  const y = Math.max(target.y + Math.sin(pitch) * dist + 1.2, groundHeight(x, z) + 0.5);
  return { x, y, z };
}

// Pinch zoom: fingers apart (d1 > d0) zooms in (shorter distance).
export function zoomByPinch(dist, d0, d1) {
  if (d1 <= 0) return dist;
  return Math.max(CAMERA.min, Math.min(CAMERA.max, dist * (d0 / d1)));
}

// Wheel zoom: scroll up (negative deltaY) zooms in.
export function zoomByWheel(dist, deltaY) {
  return Math.max(CAMERA.min, Math.min(CAMERA.max, dist * (1 + deltaY * 0.001)));
}

// True when (x, z) with the given body radius overlaps a building
// rect (expanded by radius) or a prop circle.
export function collidesAt(x, z, colliders, radius) {
  for (const r of colliders.rects) {
    if (Math.abs(x - r.x) < r.hw + radius && Math.abs(z - r.z) < r.hd + radius) return true;
  }
  for (const c of colliders.circles) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
  }
  return false;
}

// One frame of vertical resolution: gravity, ground snap, and the
// downhill step-stick. Returns { y, vy, grounded, wasSwimming }.
// The step-stick is the kejang fix: on a downhill the ground can
// fall faster than gravity's first-frame pull, so without it the
// character alternates airborne/grounded every frame, the pose
// flips jump<->run, and the arms flap violently (worst at the
// hands). A grounded character that is not jumping up and is less
// than a step (0.3 m) above the ground snaps down and stays
// grounded; real jumps (vy > 0) and real falls (gap >= 0.3 m, or
// already airborne) still go airborne.
export function resolveVertical(y, vy, ground, wasGrounded, wasSwimming, dt) {
  if (wasSwimming) {
    const ny = easeToward(y, ground, dt, 8);
    if (Math.abs(ny - ground) < 0.05) return { y: ground, vy: 0, grounded: true, wasSwimming: false };
    return { y: ny, vy, grounded: false, wasSwimming: true };
  }
  const nvy = stepVertical(vy, dt);
  const ny = y + nvy * dt;
  if (ny <= ground) return { y: ground, vy: 0, grounded: true, wasSwimming: false };
  if (wasGrounded && nvy <= 0 && ny - ground < 0.3) return { y: ground, vy: 0, grounded: true, wasSwimming: false };
  return { y: ny, vy: nvy, grounded: false, wasSwimming: false };
}

// Frame-rate-independent glide toward a target, never overshooting.
export function easeToward(current, target, dt, rate) {
  return current + (target - current) * Math.min(1, dt * rate);
}
