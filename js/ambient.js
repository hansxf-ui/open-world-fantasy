// Stage 2 ambient life: fireflies, butterflies, pollen.
//
// Counts are the single source of truth for the particle budget:
// the three zone particle sets in world.js (snow / dust / leaves)
// were rebalanced 100 -> 70 each so the new fireflies + pollen keep
// the grand total at BUDGETS.particles (300). Points cost draw
// calls but zero triangles; butterflies cost 2 calls + 96 tris.
//
// Pure helpers (fireflyBlink, butterflyOffset, butterflyVelocity)
// are exported for Node tests. buildAmbient creates the THREE
// objects; it takes zoneAt + groundHeight as parameters so this
// module never imports world.js (no import cycle).
import * as THREE from './vendor/three.module.js';

export const AMBIENT = {
  snow: 70,
  desert: 70,
  forestLeaves: 70,
  fireflies: 50,
  pollen: 40,
  butterflies: 6,
};

export const FIREFLY_COLORS = ['#7dffd4', '#c0ff70', '#7ee0ff'];
export const BUTTERFLY_TINTS = ['#ff9a3a', '#ffffff', '#8ac8ff', '#ff8ab0', '#ffd11a', '#c080ff'];

// Deterministic pseudo-random, same algorithm as world.js /
// undergrowth.js but its own stream, so ambient placement never
// shifts the main world's rand stream.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Firefly glow pulse: smooth blink, never fully black (floor 0.1
// reads as a dim firefly rather than a pop in/out).
export function fireflyBlink(t, speed, phase) {
  const s = 0.5 + 0.5 * Math.sin(t * speed + phase);
  return 0.1 + 0.9 * s * s;
}

// Butterfly wander around its anchor: Lissajous drift (radius
// ~3 m) + vertical bob + wing flap in [-1, 1] radians.
export function butterflyOffset(t, phase) {
  return {
    dx: Math.sin(t * 0.35 + phase) * 2.2 + Math.sin(t * 0.13 + phase * 2) * 0.8,
    dz: Math.cos(t * 0.27 + phase) * 2.2 + Math.cos(t * 0.11 + phase * 3) * 0.8,
    dy: 0.9 + 0.35 * Math.sin(t * 0.9 + phase),
    flap: Math.sin(t * 11 + phase) * 0.9,
  };
}

// Analytic velocity of butterflyOffset (derivative), so the heading
// is exact with no smoothing state: heading = atan2(vx, vz), the
// same facing convention as the player character (+z forward).
export function butterflyVelocity(t, phase) {
  return {
    vx: 2.2 * 0.35 * Math.cos(t * 0.35 + phase) + 0.8 * 0.13 * Math.cos(t * 0.13 + phase * 2),
    vz: -2.2 * 0.27 * Math.sin(t * 0.27 + phase) - 0.8 * 0.11 * Math.sin(t * 0.11 + phase * 3),
  };
}

export function buildAmbient(scene, { forestTreeSpots, flowerSpots, groundHeight, zoneAt }) {
  const rand = mulberry32(20261026);
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const tint = new THREE.Color();
  let t = 0;

  // ---- Fireflies: 50 points anchored to forest tree spots ----
  const fireflyAnchors = [];
  const fireflyPhase = [];
  const fireflySpeed = [];
  const fireflyBase = [];
  for (let i = 0; i < AMBIENT.fireflies; i++) {
    const [ax, az] = forestTreeSpots[Math.floor(rand() * forestTreeSpots.length)];
    fireflyAnchors.push([ax, az]);
    fireflyPhase.push(rand() * Math.PI * 2);
    fireflySpeed.push(0.8 + rand() * 1.2);
    fireflyBase.push(new THREE.Color(FIREFLY_COLORS[i % FIREFLY_COLORS.length]));
  }
  const fireflyPos = new Float32Array(AMBIENT.fireflies * 3);
  const fireflyCol = new Float32Array(AMBIENT.fireflies * 3);
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3).setUsage(THREE.DynamicDrawUsage));
  fireflyGeo.setAttribute('color', new THREE.BufferAttribute(fireflyCol, 3).setUsage(THREE.DynamicDrawUsage));
  const fireflies = new THREE.Points(fireflyGeo, new THREE.PointsMaterial({
    vertexColors: true, size: 0.35, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  fireflies.userData.ambient = 'fireflies';
  fireflies.frustumCulled = false;
  fireflies.visible = false;
  scene.add(fireflies);

  // ---- Pollen: 40 points around the player, city zone only ----
  const pollenPos = new Float32Array(AMBIENT.pollen * 3);
  for (let i = 0; i < AMBIENT.pollen; i++) {
    pollenPos[i * 3] = (rand() - 0.5) * 40;
    pollenPos[i * 3 + 1] = rand() * 10;
    pollenPos[i * 3 + 2] = (rand() - 0.5) * 40;
  }
  const pollenGeo = new THREE.BufferGeometry();
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPos, 3).setUsage(THREE.DynamicDrawUsage));
  const pollen = new THREE.Points(pollenGeo, new THREE.PointsMaterial({
    color: 0xffe89a, size: 0.3, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  pollen.userData.ambient = 'pollen';
  pollen.frustumCulled = false;
  pollen.visible = false;
  scene.add(pollen);

  // ---- Butterflies: 6, one wing pair + body each ----
  // One InstancedMesh for all 12 wings: the wing geometry extends
  // +X, and right wings mirror it with scale.x = -1 (DoubleSide
  // material, so the flipped winding still renders). Flap rotates
  // around the forward axis (Z in body space after the YXZ yaw):
  // left wing +flap, right wing -flap, so both tips rise together.
  const wingGeo = new THREE.PlaneGeometry(0.4, 0.35);
  wingGeo.translate(0.2, 0, 0);
  // One white vertex colour per position vertex (PlaneGeometry has
  // 4): final wing colour = vertex white x per-instance tint.
  const wingCol = new Float32Array(wingGeo.attributes.position.count * 3).fill(1);
  wingGeo.setAttribute('color', new THREE.BufferAttribute(wingCol, 3));
  const wings = new THREE.InstancedMesh(
    wingGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    AMBIENT.butterflies * 2);
  wings.userData.ambient = 'butterflyWings';
  wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wings.frustumCulled = false;
  const bodies = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x3a2a20 }),
    AMBIENT.butterflies);
  bodies.userData.ambient = 'butterflyBodies';
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.frustumCulled = false;
  const butterflyAnchors = [];
  const butterflyPhase = [];
  for (let i = 0; i < AMBIENT.butterflies; i++) {
    const [ax, az] = flowerSpots[Math.floor((i * flowerSpots.length) / AMBIENT.butterflies)];
    butterflyAnchors.push([ax, az]);
    butterflyPhase.push(rand() * Math.PI * 2);
    wings.setColorAt(i * 2, tint.set(BUTTERFLY_TINTS[i % BUTTERFLY_TINTS.length]));
    wings.setColorAt(i * 2 + 1, tint.set(BUTTERFLY_TINTS[i % BUTTERFLY_TINTS.length]));
  }
  wings.instanceColor.needsUpdate = true;
  scene.add(wings);
  scene.add(bodies);

  function step(dt, camera) {
    t += dt;
    const zone = zoneAt(camera.position.x, camera.position.z);

    // Fireflies: drift around their tree anchor, blink per point.
    fireflies.visible = zone === 'forest';
    if (fireflies.visible) {
      for (let i = 0; i < AMBIENT.fireflies; i++) {
        const [ax, az] = fireflyAnchors[i];
        const ph = fireflyPhase[i];
        fireflyPos[i * 3] = ax + Math.sin(t * 0.5 + ph) * 1.2;
        fireflyPos[i * 3 + 1] = groundHeight(ax, az) + 0.6 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.8 + ph * 2));
        fireflyPos[i * 3 + 2] = az + Math.cos(t * 0.4 + ph) * 1.2;
        const b = fireflyBlink(t, fireflySpeed[i], ph);
        const c = fireflyBase[i];
        fireflyCol[i * 3] = c.r * b;
        fireflyCol[i * 3 + 1] = c.g * b;
        fireflyCol[i * 3 + 2] = c.b * b;
      }
      fireflyGeo.attributes.position.needsUpdate = true;
      fireflyGeo.attributes.color.needsUpdate = true;
    }

    // Pollen: camera-relative golden motes, slow fall + sway.
    pollen.visible = zone === 'city';
    if (pollen.visible) {
      pollen.position.set(camera.position.x, 0, camera.position.z);
      for (let i = 0; i < pollenPos.length; i += 3) {
        pollenPos[i + 1] -= 0.3 * dt;
        pollenPos[i] += Math.sin(pollenPos[i + 1] * 0.5) * dt * 0.3;
        if (pollenPos[i + 1] < 0) pollenPos[i + 1] = 10;
      }
      pollenGeo.attributes.position.needsUpdate = true;
    }

    // Butterflies: always visible (flowers span forest, city edge,
    // and meadow strips); wander + flap around their flower anchor.
    for (let i = 0; i < AMBIENT.butterflies; i++) {
      const [ax, az] = butterflyAnchors[i];
      const ph = butterflyPhase[i];
      const off = butterflyOffset(t, ph);
      const vel = butterflyVelocity(t, ph);
      const heading = Math.atan2(vel.vx, vel.vz);
      const x = ax + off.dx;
      const z = az + off.dz;
      const y = groundHeight(x, z) + off.dy;
      dummy.position.set(x, y, z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, heading, off.flap);
      dummy.updateMatrix();
      wings.setMatrixAt(i * 2, dummy.matrix);
      dummy.scale.set(-1, 1, 1);
      dummy.rotation.set(0, heading, -off.flap);
      dummy.updateMatrix();
      wings.setMatrixAt(i * 2 + 1, dummy.matrix);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, heading, 0);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
    }
    wings.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
  }

  return {
    updaters: [step],
    objects: { fireflies, pollen, wings, bodies },
  };
}
