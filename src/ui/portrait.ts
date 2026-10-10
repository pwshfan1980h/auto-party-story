// Hero portraits for the town screens: each hero's own voxel model, rendered once and cached as an image.
import * as THREE from 'three';
import { heroModel, rollLook } from '../art/humanoid';
import { UnitView } from '../render/unitView';
import type { RunHero } from '../sim/run';

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-0.62, 0.62, 0.74, -0.74, 0.1, 50);

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 112;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.AmbientLight(0x8a88b0, 1.4));
  const key = new THREE.DirectionalLight(0xffc98a, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
}

const DIR = new THREE.Vector3(1, 0.55, 1.25).normalize();

/** A data URL of the hero's model, or '' where WebGL isn't available. */
export function portrait(hero: RunHero): string {
  const hit = cache.get(hero.id);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    if (!renderer) setup();
    const view = new UnitView(heroModel(hero.classId, rollLook(hero.raceId, hero.id)));
    view.pose('idle', 0);
    scene.add(view.root);
    // frame the whole body: centre on its bounds, and fit its height with a little headroom
    view.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(view.root);
    const c = box.getCenter(new THREE.Vector3());
    const half = Math.max(box.max.y - box.min.y, (box.max.x - box.min.x) * 1.1) * 0.62;
    cam.top = half; cam.bottom = -half; cam.left = -half * (96 / 112); cam.right = half * (96 / 112);
    cam.position.copy(c).addScaledVector(DIR, 20);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    renderer!.render(scene, cam);
    url = renderer!.domElement.toDataURL();
    scene.remove(view.root);
  } catch { url = ''; }
  cache.set(hero.id, url);
  return url;
}
