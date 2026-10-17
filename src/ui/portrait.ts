// Hero portraits for the town screens: each hero's own voxel model, rendered once and cached as an image.
import * as THREE from 'three';
import { heroModel, rollLook } from '../art/humanoid';
import { UnitView } from '../render/unitView';
import type { RunHero } from '../sim/run';
import type { Model } from '../art/kit';

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
  scene.add(new THREE.AmbientLight(0x9a98c0, 2.2));
  const key = new THREE.DirectionalLight(0xffc98a, 3.4);
  key.position.set(3, 5, 4);
  scene.add(key);
}

const DIR = new THREE.Vector3(1, 0.55, 1.25).normalize();

/** A data URL of the hero's model, or '' where WebGL isn't available. */
export function portrait(hero: RunHero): string {
  return modelPortrait(`${hero.id}:${hero.classId}:${hero.raceId}`,()=>heroModel(hero.classId,rollLook(hero.raceId,hero.id)));
}

export function modelPortrait(key:string,make:()=>Model):string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  let view:UnitView|undefined;
  try {
    if (!renderer) setup();
    const model=make();view = new UnitView(model);
    if(model.style!=='none')view.pose('idle', 0);
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
  } catch { url = ''; }
  finally {if(view){scene.remove(view.root);for(const mesh of view.meshes)mesh.geometry.dispose()}}
  if(cache.size>=256)cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}
