// Dev page: every unit model in a grid, with animation and look controls.
import * as THREE from 'three';
import { heroModel, rollLook } from './art/humanoid';
import { enemyModel } from './art/monsters';
import { RACE_BODIES } from './art/races';
import { ENEMIES } from './sim/data';
import { UnitView, type Anim } from './render/unitView';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14121a);
scene.add(new THREE.AmbientLight(0x8a88b0, 1.3));
const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
sun.position.set(4, 8, 6);
sun.castShadow = true;
scene.add(sun);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const ISO = new THREE.Vector3(1, 0.8165, 1).normalize();

const CLASSES = ['fighter', 'rogue', 'cleric', 'mage', 'ranger', 'bard', 'alchemist', 'necromancer'];
const CLASS_RACE: Record<string, string> = { fighter: 'dwarf', rogue: 'halfling', cleric: 'human', mage: 'elf', ranger: 'elf', bard: 'human', alchemist: 'gnome', necromancer: 'human' };
let seed = 1, anim: Anim = 'idle', spin = true;
let views: UnitView[] = [];
const grid = new THREE.Group();
scene.add(grid);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x2a2633 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function build() {
  grid.clear();
  views = [];
  const set = (document.getElementById('set') as HTMLSelectElement).value;
  const models = set === 'classes' ? CLASSES.map((c) => heroModel(c, rollLook(CLASS_RACE[c], seed * 31 + c.length)))
    : set === 'races' ? Object.keys(RACE_BODIES).map((r, i) => heroModel('fighter', rollLook(r, seed * 17 + i)))
    : set === 'party' ? CLASSES.map((c, i) => heroModel(c, rollLook(Object.keys(RACE_BODIES)[(seed * 7 + i * 3) % 14], seed * 101 + i)))
    : set === 'species' ? ['sewer_rat', 'screech_bat', 'skeleton_warrior', 'skeleton_archer', 'bone_knight', 'zombie', 'ghost', 'cult_priest', 'grave_robber', 'cave_spider', 'goblin_archer', 'green_slime'].map((e) => enemyModel(e))
    : Object.keys(ENEMIES).map((e) => enemyModel(e));
  const cols = Math.ceil(Math.sqrt(models.length * 1.6));
  models.forEach((m, i) => {
    const v = new UnitView(m, i * 13 + seed);
    v.root.position.set((i % cols) * 1.6 - (cols - 1) * 0.8, 0, Math.floor(i / cols) * 1.6 - (Math.ceil(models.length / cols) - 1) * 0.8);
    grid.add(v.root);
    views.push(v);
  });
  const rows = Math.ceil(models.length / cols);
  resize(Math.max(cols * 0.62, rows * 0.9) + 0.3);
}

let frame = 3;
function resize(extent = frame) {
  frame = extent;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(Math.round(w / 2), Math.round(h / 2), false);
  const aspect = w / h;
  cam.left = -frame * aspect; cam.right = frame * aspect; cam.top = frame; cam.bottom = -frame;
  cam.position.copy(ISO).multiplyScalar(40).add(new THREE.Vector3(0, 0.6, 0));
  cam.lookAt(0, 0.6, 0);
  cam.updateProjectionMatrix();
}

const anims: Anim[] = ['idle', 'walk', 'crouch', 'attack', 'cast', 'shoot', 'hurt', 'downed', 'celebrate'];
const bar = document.getElementById('anims')!;
for (const a of anims) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = a; b.setAttribute('aria-pressed', String(a === anim));
  b.onclick = () => { anim = a; bar.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
  bar.append(b);
}
document.getElementById('set')!.addEventListener('change', build);
document.getElementById('reroll')!.addEventListener('click', () => { seed++; build(); });
const spinBtn = document.getElementById('spin')!;
spinBtn.addEventListener('click', () => { spin = !spin; spinBtn.setAttribute('aria-pressed', String(spin)); });
window.addEventListener('resize', () => resize());

build();
const t0 = performance.now();
renderer.setAnimationLoop(() => {
  const t = (performance.now() - t0) / 1000;
  const p = (t % 1.2) / 1.2;
  for (const v of views) {
    v.pose(anim, t, p);
    v.root.rotation.y = spin ? t * 0.6 : 0;
  }
  renderer.render(scene, cam);
});
(window as unknown as { __gallery: unknown }).__gallery = { views, build };
