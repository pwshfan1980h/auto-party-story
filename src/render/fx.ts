// Battle effects: voxel bursts and chips, projectiles, ground telegraphs and blood decals.
import * as THREE from 'three';

const cube = new THREE.BoxGeometry(1, 1, 1);
const toLin = (c: number) => new THREE.Color().setRGB(Math.pow(((c >> 16) & 255) / 255, 2.2), Math.pow(((c >> 8) & 255) / 255, 2.2), Math.pow((c & 255) / 255, 2.2));

interface Burst { mesh: THREE.InstancedMesh; parts: { p: THREE.Vector3; v: THREE.Vector3; s: number }[]; t: number; life: number; grav: number }
interface Proj { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; t: number; dur: number; arc: number }
interface Ring { group: THREE.Group; fill: THREE.Mesh; t: number; dur: number }
interface Decal { mesh: THREE.Mesh; t: number; life: number }
interface Wave { mesh: THREE.Mesh; t: number; dur: number; r: number }
interface Flash { light: THREE.PointLight; t: number; dur: number; peak: number }

export class Fx {
  private bursts: Burst[] = [];
  private projs: Proj[] = [];
  private rings: Ring[] = [];
  private decals: Decal[] = [];
  private waves: Wave[] = [];
  private flashes: Flash[] = [];
  /** Real lights are costly; a few at once is plenty to light up a blast. */
  static MAX_FLASHES = 3;
  private live = 0;
  /** Debris voxels in flight are capped so hordes stay cheap (spec 11). */
  static MAX_DEBRIS = 900;

  constructor(private readonly parent: THREE.Object3D) {}

  /** Throw a set of coloured voxels out from a point (deaths, chips, sparks). */
  burst(at: THREE.Vector3, voxels: { x: number; y: number; z: number; c: number }[], size: number, opts: { life?: number; up?: number; grav?: number; spread?: number; yaw?: number } = {}) {
    const room = Math.max(0, Fx.MAX_DEBRIS - this.live);
    const n = Math.min(voxels.length, room);
    if (n <= 0) return;
    const mesh = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial(), n);
    const parts: Burst['parts'] = [];
    const step = voxels.length / n;
    const rot = new THREE.Matrix4().makeRotationY(opts.yaw ?? 0);
    for (let i = 0; i < n; i++) {
      const v = voxels[Math.floor(i * step)];
      const p = new THREE.Vector3(v.x * size, v.y * size, v.z * size).applyMatrix4(rot).add(at);
      const out = new THREE.Vector3(p.x - at.x, 0, p.z - at.z).normalize().multiplyScalar(opts.spread ?? 1);
      parts.push({ p, v: new THREE.Vector3(out.x * (0.8 + Math.random() * 1.8), 1.2 + Math.random() * 2.6 + (opts.up ?? 0), out.z * (0.8 + Math.random() * 1.8)), s: size * 1.6 });
      mesh.setColorAt(i, toLin(v.c));
    }
    mesh.castShadow = true;
    this.parent.add(mesh);
    this.bursts.push({ mesh, parts, t: 0, life: opts.life ?? 1.6, grav: opts.grav ?? 9 });
    this.live += n;
  }

  projectile(a: THREE.Vector3, b: THREE.Vector3, dur: number, color: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color }));
    this.parent.add(mesh);
    this.projs.push({ mesh, a, b, t: 0, dur: Math.max(0.05, dur), arc: 0.25 });
  }

  telegraph(at: THREE.Vector3, r: number, dur: number) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 40), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.8 }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.22 }));
    ring.rotation.x = fill.rotation.x = -Math.PI / 2;
    group.add(ring, fill);
    group.position.copy(at).setY(0.02);
    this.parent.add(group);
    this.rings.push({ group, fill, t: 0, dur });
  }

  decal(at: THREE.Vector3, color = 0x5a0a10) {
    const s = 0.04 + Math.random() * 0.06;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, 0.01, s), new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(at).setY(0.012);
    this.parent.add(mesh);
    this.decals.push({ mesh, t: 0, life: 6 });
  }

  /** A shockwave: a flat ring racing outwards over the floor and fading. */
  shockwave(at: THREE.Vector3, r: number, color: number, dur = 0.5) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(0.03);
    mesh.scale.setScalar(0.05);
    this.parent.add(mesh);
    this.waves.push({ mesh, t: 0, dur, r });
  }

  /** A burst of real light: a spell or explosion lighting up the room for a moment. */
  flash(at: THREE.Vector3, color: number, peak = 3, dist = 4, dur = 0.35) {
    if (this.flashes.length >= Fx.MAX_FLASHES) { const old = this.flashes.shift()!; this.parent.remove(old.light); }
    const light = new THREE.PointLight(color, peak, dist, 1.5);
    light.position.copy(at);
    this.parent.add(light);
    this.flashes.push({ light, t: 0, dur, peak });
  }

  update(dt: number) {
    for (const w of this.waves) {
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      w.mesh.scale.setScalar(Math.max(0.05, w.r * (1 - Math.pow(1 - k, 3))));
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
    }
    for (const w of this.waves.filter((x) => x.t >= x.dur)) { this.parent.remove(w.mesh); w.mesh.geometry.dispose(); }
    this.waves = this.waves.filter((x) => x.t < x.dur);
    for (const f of this.flashes) { f.t += dt; f.light.intensity = f.peak * Math.max(0, 1 - f.t / f.dur); }
    for (const f of this.flashes.filter((x) => x.t >= x.dur)) this.parent.remove(f.light);
    this.flashes = this.flashes.filter((x) => x.t < x.dur);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const b of this.bursts) {
      b.t += dt;
      const fade = Math.max(0, Math.min(1, (b.life - b.t) / 0.5));
      b.parts.forEach((p, i) => {
        p.v.y -= b.grav * dt;
        p.p.addScaledVector(p.v, dt);
        if (p.p.y < p.s / 2) { p.p.y = p.s / 2; p.v.y *= -0.3; p.v.x *= 0.55; p.v.z *= 0.55; }
        sc.setScalar(p.s * fade);
        m.compose(p.p, q, sc);
        b.mesh.setMatrixAt(i, m);
      });
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.bursts.filter((x) => x.t >= x.life)) { this.parent.remove(b.mesh); b.mesh.dispose(); this.live -= b.parts.length; }
    this.bursts = this.bursts.filter((x) => x.t < x.life);
    for (const p of this.projs) {
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.mesh.position.lerpVectors(p.a, p.b, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * p.arc;
    }
    for (const p of this.projs.filter((x) => x.t >= x.dur)) this.parent.remove(p.mesh);
    this.projs = this.projs.filter((x) => x.t < x.dur);
    for (const r of this.rings) { r.t += dt; r.fill.scale.setScalar(Math.max(0.01, Math.min(1, r.t / r.dur))); }
    for (const r of this.rings.filter((x) => x.t >= x.dur)) this.parent.remove(r.group);
    this.rings = this.rings.filter((x) => x.t < x.dur);
    for (const d of this.decals) { d.t += dt; d.mesh.scale.setScalar(Math.max(0.01, Math.min(1, (d.life - d.t) / 2))); }
    for (const d of this.decals.filter((x) => x.t >= x.life)) this.parent.remove(d.mesh);
    this.decals = this.decals.filter((x) => x.t < x.life);
  }

  clear() {
    for (const b of this.bursts) this.parent.remove(b.mesh);
    for (const p of this.projs) this.parent.remove(p.mesh);
    for (const r of this.rings) this.parent.remove(r.group);
    for (const d of this.decals) this.parent.remove(d.mesh);
    for (const w of this.waves) this.parent.remove(w.mesh);
    for (const f of this.flashes) this.parent.remove(f.light);
    this.bursts = []; this.projs = []; this.rings = []; this.decals = []; this.waves = []; this.flashes = []; this.live = 0;
  }
}
