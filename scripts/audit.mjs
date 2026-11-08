// Headless scene audit: boots buildWorld with a stub document (the
// canvas textures only need a no-op 2D context) and counts draw calls
// and triangles against BUDGETS. Exits non-zero when over budget.
import * as THREE from '../js/vendor/three.module.js';
import { BUDGETS, COLORS } from '../js/config.js';
import { buildWorld } from '../js/world.js';
import { buildHumanoid } from '../js/character.js';

globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error('only canvas is stubbed');
    return {
      width: 0,
      height: 0,
      getContext: () => new Proxy({}, { get: () => () => {} }),
    };
  },
  // TextureLoader's ImageLoader uses createElementNS for <img>.
  createElementNS: () => ({ addEventListener() {} }),
};

const scene = new THREE.Scene();
buildWorld(scene);

// Full-scene worst case: the world plus a full plaza (self + 40
// remotes). Each humanoid is 7 meshes + 1 label sprite = 8 calls.
for (let i = 0; i < 41; i++) {
  const g = buildHumanoid(COLORS[i % COLORS.length]);
  g.position.set((i % 7) * 2 - 6, 0, Math.floor(i / 7) * 2 - 6);
  const label = new THREE.Sprite(new THREE.SpriteMaterial());
  label.position.y = 2.3;
  g.add(label);
  scene.add(g);
}

let drawCalls = 0;
let triangles = 0;
scene.traverse((obj) => {
  // Sprites count as draw calls (0 triangles each, negligible).
  if (obj.isMesh || obj.isPoints || obj.isSprite) drawCalls++;
  if (obj.isMesh) {
    const geo = obj.geometry;
    const base = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    triangles += obj.isInstancedMesh ? base * obj.count : base;
  }
});

console.log(`draw calls: ${drawCalls} (budget ${BUDGETS.drawCalls})`);
console.log(`triangles: ${Math.round(triangles)} (budget ${BUDGETS.triangles})`);
const ok = drawCalls <= BUDGETS.drawCalls && triangles <= BUDGETS.triangles;
console.log(ok ? 'AUDIT PASS' : 'AUDIT FAIL');
process.exit(ok ? 0 : 1);
