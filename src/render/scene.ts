// The battle scene: a half-resolution pixel render, an isometric orthographic camera and torchlight.
import * as THREE from 'three';

export const ISO_DIR = new THREE.Vector3(1, 0.8165, 1).normalize(); // true isometric: 35.264° pitch, 45° yaw

export class BattleScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly torch = new THREE.PointLight(0xffa040, 2.6, 10, 1.3);
  readonly world = new THREE.Group();
  /** Where the camera looks and how far it is pushed in (1 = the wide shot). */
  focus = new THREE.Vector3();
  zoom = 1;
  allowShake = true;
  /** Half the visible height at zoom 1, in tiles; set from the battlefield size. */
  frame = 5;
  private shakeLeft = 0;
  private shakeMag = 0;

  constructor(readonly canvas: HTMLCanvasElement, private pixelScale = 2) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.scene.background = new THREE.Color(0x07060b);
    this.scene.add(new THREE.AmbientLight(0x7a78a0, 1.35));
    const moon = new THREE.DirectionalLight(0x9fb0ff, 0.5);
    moon.position.set(-4, 10, 6);
    this.scene.add(moon);
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(512, 512);
    this.torch.shadow.bias = -0.004;
    this.scene.add(this.torch, this.world);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const f = w < 600 ? 1.5 : this.pixelScale;
    this.renderer.setSize(Math.max(1, Math.round(w / f)), Math.max(1, Math.round(h / f)), false);
  }

  shake(mag: number, secs: number) { if(this.allowShake){this.shakeMag = mag; this.shakeLeft = secs;} }

  /** Light radius follows torch fuel (0–10). */
  setTorch(fuel: number, flicker: number) {
    this.torch.distance = fuel > 0 ? 3 + fuel * 1.1 + flicker : 2;
    this.torch.intensity = (fuel > 0 ? 2.6 : 0.8) + flicker * 0.3;
  }

  render(dt: number) {
    const aspect = Math.max(1,this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    const half = this.frame / this.zoom;
    const c = this.camera;
    c.left = -half * aspect; c.right = half * aspect; c.top = half; c.bottom = -half;
    let sx = 0, sy = 0;
    if (this.shakeLeft > 0 && this.allowShake) { this.shakeLeft -= dt; sx = (Math.random() - 0.5) * this.shakeMag; sy = (Math.random() - 0.5) * this.shakeMag; }
    c.position.copy(this.focus).addScaledVector(ISO_DIR, 40).add(new THREE.Vector3(sx, sy, 0));
    c.lookAt(this.focus);
    c.updateProjectionMatrix();
    this.renderer.render(this.scene, c);
  }
}
