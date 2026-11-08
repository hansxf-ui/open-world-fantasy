import * as THREE from './vendor/three.module.js';
import { CHARACTER_BLENDER } from './vendor/character-blender.js';
import { CHARACTER_BLENDER_MALE } from './vendor/character-blender-male.js';

// Blender-baked cozy humanoid, two variants (female/male). The bake
// is pivot-local geometry, so each body part reads as a finished
// little character (hair, face, shoes, belt, beanie) while staying
// exactly 7 meshes per player — the draw-call budget has no room
// for more. Group origin is at the feet; a body pivot at hip height
// holds torso, head, and arms so swim can lean the whole upper body
// while legs keep kicking. Forward is +z
// (rotation.y = atan2(dir.x, dir.z)). Geometry is built fresh from
// the bake arrays per humanoid and never shared: recolorShirt
// mutates vertex colors, so a shared geometry would tint every
// player wearing that variant.

const VARIANTS = { female: CHARACTER_BLENDER, male: CHARACTER_BLENDER_MALE };

function bakeGeometry(part) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(part.pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(part.nor), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(part.col), 3));
  geo.setIndex(part.index);
  return geo;
}

export function buildHumanoid(color, variant = 'female') {
  const bake = VARIANTS[variant] || VARIANTS.female;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const g = new THREE.Group();

  // Limbs are pivot groups with the mesh as child: poseHumanoid
  // swings the pivot, and the bake geometry hangs below it.
  function limbMesh(name, partName, x, y) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(bakeGeometry(bake.parts[partName]), mat));
    return pivot;
  }
  function bodyMesh(name, partName, y) {
    const m = new THREE.Mesh(bakeGeometry(bake.parts[partName]), mat);
    m.name = name;
    m.position.y = y;
    return m;
  }

  const legL = limbMesh('legL', 'legL', -0.14, 0.85);
  const legR = limbMesh('legR', 'legR', 0.14, 0.85);
  g.add(legL, legR);

  const body = new THREE.Group();
  body.name = 'body';
  body.position.y = 0.85;
  g.add(body);

  const torso = bodyMesh('torso', 'torso', 0.35);
  const head = bodyMesh('head', 'head', 1.0);
  const hat = bodyMesh('hat', 'hat', 1.22);
  body.add(torso, head, hat);

  const armL = limbMesh('armL', 'armL', -0.34, 0.65);
  const armR = limbMesh('armR', 'armR', 0.34, 0.65);
  body.add(armL, armR);

  g.userData.parts = { legL, legR, armL, armR, body, torso, head };
  // The bake leaves the shirt WHITE (marker vertices); tint it to
  // the player's color now, or the jacket shows up white.
  recolorShirt(g, color);
  return g;
}

// Release GPU resources for a group leaving the scene (remote player
// gone, chat floater expired). Geometries are built fresh per
// humanoid and label sprites own their canvas texture, so nothing
// here is shared with another player; materials are deduped because
// one humanoid shares a single material across its 7 meshes, and
// disposing the same material twice would only re-fire its event.
export function disposeObject3D(root) {
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (mats.has(mm)) continue;
      mats.add(mm);
      if (mm.map) mm.map.dispose();
      mm.dispose();
    }
  });
}

// The entry screen lets the player change shirt color after the
// humanoid was built. The bake marks the shirt with WHITE vertices
// (torso + arms only); a built humanoid already carries its shirt
// color there instead. So remap vertices matching either white or
// the previous shirt color — that covers a fresh build, a color
// change, and a rebuild alike, and never touches skin, pants, or
// any other part (white exists nowhere else in the bake).
export function recolorShirt(group, newColor) {
  const old = group.userData.shirtColor;
  const next = new THREE.Color(newColor);
  const isWhite = (r, g, b) => Math.abs(r - 1) < 0.01 && Math.abs(g - 1) < 0.01 && Math.abs(b - 1) < 0.01;
  for (const name of ['torso', 'armL', 'armR']) {
    const p = group.getObjectByName(name);
    const mesh = p && (p.isMesh ? p : p.children[0]);
    if (!mesh || !mesh.geometry.attributes.color) continue;
    const col = mesh.geometry.attributes.color.array;
    for (let i = 0; i < col.length; i += 3) {
      const matchesWhite = isWhite(col[i], col[i + 1], col[i + 2]);
      const matchesOld = !!old && Math.abs(col[i] - old.r) < 0.01
        && Math.abs(col[i + 1] - old.g) < 0.01 && Math.abs(col[i + 2] - old.b) < 0.01;
      if (matchesWhite || matchesOld) {
        col[i] = next.r;
        col[i + 1] = next.g;
        col[i + 2] = next.b;
      }
    }
    mesh.geometry.attributes.color.needsUpdate = true;
  }
  group.userData.shirtColor = next;
}

export function nextAnimState(prev, { mag, depth, airborne }) {
  if (airborne) return 'jump';
  if (depth >= 0.8) return 'swim';
  if (mag <= 0.01) return 'idle';
  // Hysteresis on the stick magnitude, NOT on speed: speed is
  // discontinuous at the walk/run switch (4*mag jumps to 7*mag at
  // 0.9), so a latch on speed can never engage — its band sits in
  // the unreachable gap, and a thumb hovering near 0.9 flips the
  // stride every frame (kejang, worst at the hands). Latch on mag:
  // run holds until the stick falls below 0.75, walk steps up to
  // run only past 0.9.
  if (prev === 'run') return mag >= 0.75 ? 'run' : 'walk';
  if (mag >= 0.9) return 'run';
  return 'walk';
}

// Pose targets per state, blended toward the current rotations every
// frame instead of snapped: the old code set rotations directly, so
// every start, stop, and walk/run flip teleported the limbs in one
// frame — on a phone that reads as a seizure (kejang). The blend
// keeps the pose responsive (~250 ms to settle) while no single
// frame ever jumps. dt = 1 snaps (tests, first frame); real frames
// pass dt ~= 1/60. A null target leaves that axis alone — swim
// keeps the old quirk of not touching the arm swing axis.
export function poseHumanoid(group, state, t, dt = 1) {
  const p = group.userData.parts || {};
  const { legL, legR, armL, armR, body } = p;
  if (!legL || !legR || !armL || !armR || !body) return;
  const s = Math.sin(t);
  // Same target values as the old snap code.
  const tgt = {
    legLx: null, legRx: null, armLx: null, armRx: null,
    armLz: null, armRz: null, bodyX: null, bodyZ: null,
  };
  switch (state) {
    case 'walk':
      tgt.legLx = s * 0.6; tgt.legRx = -s * 0.6;
      tgt.armLx = -s * 0.5; tgt.armRx = s * 0.5;
      tgt.armLz = 0; tgt.armRz = 0; tgt.bodyX = 0; tgt.bodyZ = 0;
      break;
    case 'run':
      tgt.legLx = s * 0.9; tgt.legRx = -s * 0.9;
      tgt.armLx = -s * 0.8; tgt.armRx = s * 0.8;
      tgt.armLz = 0; tgt.armRz = 0; tgt.bodyX = 0.25; tgt.bodyZ = 0;
      break;
    case 'swim':
      tgt.bodyX = -1.1; tgt.bodyZ = 0;
      tgt.legLx = Math.sin(t * 1.4) * 0.3; tgt.legRx = -Math.sin(t * 1.4) * 0.3;
      tgt.armLz = 0.6 + Math.sin(t) * 0.5; tgt.armRz = -0.6 - Math.sin(t) * 0.5;
      break;
    case 'jump':
      tgt.legLx = 0.4; tgt.legRx = -0.3;
      tgt.armLx = -2.5; tgt.armRx = -2.5;
      tgt.armLz = 0; tgt.armRz = 0; tgt.bodyX = 0; tgt.bodyZ = 0;
      break;
    default: // idle
      tgt.legLx = 0; tgt.legRx = 0;
      tgt.armLx = 0.05; tgt.armRx = 0.05;
      tgt.armLz = 0; tgt.armRz = 0; tgt.bodyX = 0; tgt.bodyZ = 0;
      break;
  }
  const f = Math.min(1, Math.max(0, 1 - Math.exp(-12 * dt)));
  const apply = (obj, axis, target) => {
    if (target !== null) obj.rotation[axis] += (target - obj.rotation[axis]) * f;
  };
  apply(legL, 'x', tgt.legLx);
  apply(legR, 'x', tgt.legRx);
  apply(armL, 'x', tgt.armLx);
  apply(armR, 'x', tgt.armRx);
  apply(armL, 'z', tgt.armLz);
  apply(armR, 'z', tgt.armRz);
  apply(body, 'x', tgt.bodyX);
  apply(body, 'z', tgt.bodyZ);
}
