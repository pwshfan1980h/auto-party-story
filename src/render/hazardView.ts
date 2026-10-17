// Hazards you can see: gas drifting as soft voxel puffs, flames licking up from burning tiles,
// bubbles on acid. One instanced mesh for all of it, so a room full of fog stays cheap.
import * as THREE from 'three';
import { HAZARDS } from '../sim/data';
import type { Field } from '../sim/field';
import { tileToWorld } from './fieldView';

const MAX = 1600;
const PUFFS = 3;
const FLAMES = 6;
const BUBBLES = 3;
const cube = new THREE.BoxGeometry(1, 1, 1);
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
const lin = (c: number) => new THREE.Color().setRGB(Math.pow(((c >> 16) & 255) / 255, 2.2), Math.pow(((c >> 8) & 255) / 255, 2.2), Math.pow((c & 255) / 255, 2.2));

interface Snap { t: number; g: Record<string, number[]> }

export class HazardView {
  private readonly gas: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly snaps: Snap[] = [];
  private readonly gasColor: Record<string, THREE.Color>;
  private readonly fire: number[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly acid: number[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(parent: THREE.Object3D, private readonly field: Field) {
    // gas: soft and see-through; flames and bubbles: unlit, so they glow in the dark
    this.gas = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.15, depthWrite: false }), MAX);
    this.glow = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }), 600);
    this.gas.count = 0; this.glow.count = 0;
    this.gas.frustumCulled = false; this.glow.frustumCulled = false;
    parent.add(this.gas, this.glow);
    this.gasColor = Object.fromEntries(Object.entries(HAZARDS.gases).map(([k, d]) => [k, lin(Number(d.color))]));
    for (const hz of field.hazards) {
      if (hz.kind === 'fire' && this.lights.length < 2) {
        // each burning patch lights its corner of the room
        const cx = hz.cells.reduce((a, c) => a + (c % field.w), 0) / hz.cells.length + 0.5;
        const cy = hz.cells.reduce((a, c) => a + Math.floor(c / field.w), 0) / hz.cells.length + 0.5;
        const [wx, wz] = tileToWorld(field, cx, cy);
        const light = new THREE.PointLight(0xff8a30, 1.6, 4.5, 1.6);
        light.position.set(wx, 0.6, wz);
        parent.add(light);
        this.lights.push(light);
      }
      if (hz.kind === 'fire') this.fire.push(...hz.cells);
      if (hz.kind === 'acid') this.acid.push(...hz.cells);
    }
  }

  /** The sim's air at a moment (bytes per tile, per gas). */
  push(t: number, g: Record<string, number[]>) { this.snaps.push({ t, g }); }
  private cursor = 0;

  get hasFire() { return this.fire.length > 0; }

  update(t: number) {
    const f = this.field;
    let n = 0;
    // gas, interpolated between the two snapshots around t
    const S = this.snaps;
    if (this.cursor >= S.length) this.cursor = Math.max(0, S.length - 1);
    while (this.cursor > 0 && S[this.cursor].t > t) this.cursor--;
    while (this.cursor < S.length - 1 && S[this.cursor + 1].t <= t) this.cursor++;
    const a = S[this.cursor];
    const b = S[this.cursor + 1] ?? a;
    if (a) {
      const k = b && b !== a ? Math.min(1, (t - a.t) / Math.max(0.01, b.t - a.t)) : 0;
      for (const gas of Object.keys(HAZARDS.gases)) {
        const ga = a.g[gas], gb = b?.g[gas];
        if (!ga && !gb) continue;
        const color = this.gasColor[gas];
        for (let i = 0; i < f.w * f.h && n < MAX - PUFFS; i++) {
          const v = ((ga?.[i] ?? 0) * (1 - k) + (gb?.[i] ?? 0) * k) / 255;
          if (v < 0.06) continue;
          const [wx, wz] = tileToWorld(f, (i % f.w) + 0.5, Math.floor(i / f.w) + 0.5);
          for (let j = 0; j < PUFFS; j++) {
            const h1 = hash(i, j), h2 = hash(j, i + 7);
            // puffs wander slowly about their tile, rising and falling a little
            const ox = (h1 - 0.5) * 0.8 + Math.sin(t * 0.4 + h2 * 6) * 0.12;
            const oz = (h2 - 0.5) * 0.8 + Math.cos(t * 0.35 + h1 * 6) * 0.12;
            const size = (0.3 + 0.55 * v) * (0.7 + h1 * 0.6);
            this.p.set(wx + ox, 0.08 + j * 0.16 + Math.sin(t * 0.6 + h1 * 9) * 0.04 + size * 0.3, wz + oz);
            this.s.set(size, size * 0.55, size);
            this.m.compose(this.p, this.q, this.s);
            this.gas.setMatrixAt(n, this.m);
            this.gas.setColorAt(n, color);
            n++;
          }
        }
      }
    }
    this.gas.count = n;
    this.gas.instanceMatrix.needsUpdate = true;
    if (this.gas.instanceColor) this.gas.instanceColor.needsUpdate = true;

    // flames and bubbles; fire light flickers
    for (const [i, l] of this.lights.entries()) l.intensity = 1.4 + Math.sin(t * 13 + i * 2) * 0.25 + Math.sin(t * 31 + i) * 0.15;
    let g = 0;
    const flame = [lin(0xffb040), lin(0xff7a20), lin(0xffd870)];
    for (const c of this.fire) {
      const [wx, wz] = tileToWorld(f, (c % f.w) + 0.5, Math.floor(c / f.w) + 0.5);
      for (let j = 0; j < FLAMES && g < 590; j++) {
        const life = (t * (1.2 + hash(c, j)) + hash(j, c)) % 1;
        const size = 0.12 * (1 - life) + 0.02;
        this.p.set(wx + (hash(c, j + 3) - 0.5) * 0.7, 0.05 + life * 0.55, wz + (hash(c + 3, j) - 0.5) * 0.7);
        this.s.setScalar(size);
        this.m.compose(this.p, this.q, this.s);
        this.glow.setMatrixAt(g, this.m);
        this.glow.setColorAt(g, flame[j % 3]);
        g++;
      }
    }
    const acid = lin(0x9ad04a);
    for (const c of this.acid) {
      const [wx, wz] = tileToWorld(f, (c % f.w) + 0.5, Math.floor(c / f.w) + 0.5);
      for (let j = 0; j < BUBBLES && g < 590; j++) {
        const life = (t * (0.6 + hash(c, j) * 0.5) + hash(j, c)) % 1;
        const size = 0.05 + Math.sin(life * Math.PI) * 0.06;
        this.p.set(wx + (hash(c, j + 5) - 0.5) * 0.7, 0.02 + life * 0.05, wz + (hash(c + 5, j) - 0.5) * 0.7);
        this.s.setScalar(size);
        this.m.compose(this.p, this.q, this.s);
        this.glow.setMatrixAt(g, this.m);
        this.glow.setColorAt(g, acid);
        g++;
      }
    }
    this.glow.count = g;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  dispose(parent: THREE.Object3D) {
    parent.remove(this.gas, this.glow, ...this.lights);
    for (const mesh of [this.gas, this.glow]) {
      mesh.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
