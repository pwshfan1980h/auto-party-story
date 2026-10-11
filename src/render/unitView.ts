// A unit on screen: the model's parts as a Three.js hierarchy, posed procedurally every frame.
import * as THREE from 'three';
import { RES, unkey, type Model } from '../art/kit';
import { meshVoxels } from './voxmesh';

/** One fine voxel in tiles: a design unit is 1/32 tile, stored at RES× resolution. */
export const VOXEL = 1 / (32 * RES);

export type Anim = 'idle' | 'ready' | 'walk' | 'attack' | 'cast' | 'shoot' | 'hurt' | 'crouch' | 'cower' | 'block' | 'parry' | 'dodge' | 'stagger' | 'downed' | 'celebrate';

export const unitMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export class UnitView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly parts = new Map<string, THREE.Group>();
  readonly meshes: THREE.Mesh[] = [];
  private phase: number;
  /** Jointed legs (thigh, shin, foot), solved with two-bone IK so feet plant on the ground. */
  private legs = new Map<'L' | 'R', { l1: number; l2: number; toe: number }>();
  private legLen = 10 * RES;
  /** Walk cycle position (0–1 per stride) and the last time the rig was posed, to advance it. */
  private gait = 0;
  private lastT: number | null = null;
  private halfStride = 0;

  constructor(readonly model: Model, seed = 0) {
    this.phase = (seed % 97) * 0.37;
    this.root.add(this.body);
    this.body.scale.setScalar(VOXEL * model.scale);
    const byName = new Map(model.parts.map((p) => [p.name, p]));
    for (const p of model.parts) {
      const g = new THREE.Group();
      g.name = p.name;
      const mesh = new THREE.Mesh(meshVoxels(p.voxels, p.pivot), unitMaterial);
      mesh.castShadow = true;
      g.add(mesh);
      this.meshes.push(mesh);
      this.parts.set(p.name, g);
    }
    for (const p of model.parts) {
      const g = this.parts.get(p.name)!;
      const parent = p.parent && byName.get(p.parent);
      if (parent) {
        g.position.set(p.pivot[0] - parent.pivot[0], p.pivot[1] - parent.pivot[1], p.pivot[2] - parent.pivot[2]);
        this.parts.get(parent.name)!.add(g);
      } else {
        g.position.set(p.pivot[0], p.pivot[1], p.pivot[2]);
        this.body.add(g);
      }
    }
    for (const n of ['L', 'R'] as const) {
      const thigh = byName.get(`leg${n}`), shin = byName.get(`shin${n}`), foot = byName.get(`foot${n}`);
      if (!thigh || !shin || !foot) continue;
      let toe = 0;
      for (const k of foot.voxels.keys()) toe = Math.max(toe, unkey(k)[2] + 1 - foot.pivot[2]);
      this.legs.set(n, { l1: thigh.pivot[1] - shin.pivot[1], l2: shin.pivot[1] - foot.pivot[1], toe });
      this.legLen = thigh.pivot[1] - foot.pivot[1];
    }
  }

  private rot(name: string, x = 0, y = 0, z = 0) {
    const g = this.parts.get(name);
    if (g) g.rotation.set(x, y, z);
  }

  /**
   * Put a foot at (z, y) fine voxels from its rest spot on the ground, solving hip and knee so the
   * knee bends forward. `pitch` tips the toes down (positive) or up; the heel rises so the toes stay put.
   * Call after the body offset is set: the solve compensates for it.
   */
  private foot(n: 'L' | 'R', z: number, y = 0, pitch = 0) {
    const L = this.legs.get(n);
    const b = this.body.position;
    const dz = z - b.z, dy = y + (pitch > 0 ? (L?.toe ?? 0) * Math.sin(pitch) : 0) - b.y - this.legLen;
    const aim = Math.atan2(-dz, -dy);
    if (!L) { this.rot(`leg${n}`, aim); return; }
    const { l1, l2 } = L;
    const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.5, Math.hypot(dz, dy)));
    const hip = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
    const knee = Math.PI - Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
    this.rot(`leg${n}`, aim - hip);
    this.rot(`shin${n}`, knee);
    this.rot(`foot${n}`, pitch - (aim - hip) - knee);
  }

  /** Both feet planted, right then left, `z` design units ahead of the hips. */
  private stand(zR: number, zL: number) {
    this.foot('R', zR * RES);
    this.foot('L', zL * RES);
  }

  /** One leg through a stride: stance (planted, sliding back under the body), then swing (lifted, carried forward). */
  private stride(n: 'L' | 'R', ph: number) {
    const S = this.halfStride, lift = Math.min(this.legLen * 0.22, 1.2 * RES + S * 0.35);
    if (ph < 0.5) {
      const u = ph / 0.5;
      const heelOff = u > 0.7 ? ((u - 0.7) / 0.3) * Math.min(0.6, S / (this.legLen * 0.3)) : 0;
      this.foot(n, S * (1 - 2 * u), 0, heelOff);
    } else {
      const u = (ph - 0.5) / 0.5, e = u * u * (3 - 2 * u);
      // toes trail as the foot leaves the ground, then lift for the heel strike
      this.foot(n, -S + 2 * S * e, lift * Math.sin(Math.PI * u), Math.sin(Math.PI * u) * (0.5 - u) * 0.9);
    }
  }

  /**
   * Pose the rig. `t` is seconds; `p` is 0–1 progress through one-shot actions (attack, cast, shoot, hurt).
   * The renderer chooses the animation from the sim's events and state.
   */
  pose(anim: Anim, t: number, p = 0, speed?: number) {
    // the walk cycle advances with distance travelled, so planted feet don't slide
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (anim === 'walk') {
      const v = Math.abs(speed ?? 1.5) / (VOXEL * this.model.scale); // fine voxels per second
      const maxHalf = this.legLen * 0.4;
      const cadence = Math.max(1.6, v / (4 * maxHalf)); // strides per second
      this.halfStride = Math.min(maxHalf, v / (4 * cadence));
      this.gait = (this.gait + Math.sign(speed ?? 1) * cadence * dt + 1) % 1;
    }
    this.poseVoxels(anim, t, p);
    // offsets are authored in voxels; the body lives in tile space, so convert them
    this.body.position.multiplyScalar(VOXEL * this.model.scale);
  }

  private poseVoxels(anim: Anim, t: number, p: number) {
    const m = this.model;
    const tt = t + this.phase;
    for (const g of this.parts.values()) g.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    const R = RES;
    const s = Math.sin, swing = (k: number) => s(tt * k);
    if (m.rig === 'flier') {
      const flap = swing(anim === 'walk' ? 18 : 12) * 0.9;
      this.rot('wingL', 0, 0, -flap);
      this.rot('wingR', 0, 0, flap);
      this.body.position.y = (2 + swing(4) * 1.2) * R;
      if (anim === 'attack') this.body.rotation.x = s(p * Math.PI) * 0.7;
      if (anim === 'downed') { this.body.position.y = (-8) * R; this.body.rotation.z = 1.4; }
      return;
    }
    if (m.rig === 'blob') {
      const sq = anim === 'walk' ? Math.abs(swing(8)) * 0.18 : swing(3) * 0.05;
      const torso = this.parts.get('torso')!;
      torso.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
      if (anim === 'attack') torso.scale.set(1 - s(p * Math.PI) * 0.15, 1 + s(p * Math.PI) * 0.35, 1 - s(p * Math.PI) * 0.15);
      if (anim === 'downed') torso.scale.set(1.4, 0.3, 1.4);
      return;
    }
    if (m.rig === 'ghost') {
      this.body.position.y = (1 + swing(2.4) * 1.2) * R;
      this.rot('armR', swing(2.4) * 0.3 - (anim === 'cast' || anim === 'attack' ? s(p * Math.PI) * 1.6 : 0), 0, 0);
      this.rot('armL', -swing(2.4) * 0.3 - (anim === 'cast' ? s(p * Math.PI) * 1.6 : 0), 0, 0);
      this.body.rotation.z = swing(1.7) * 0.05;
      if (anim === 'downed') { this.body.position.y = (-6) * R; this.body.rotation.x = -1.2; }
      return;
    }
    if (m.rig === 'quad' || m.rig === 'spider') {
      const k = anim === 'walk' ? 14 : 0;
      let i = 0;
      for (const [name, g] of this.parts) {
        if (!name.startsWith('leg')) continue;
        const ph = i++ % 2 ? 0 : Math.PI;
        if (m.rig === 'spider') g.rotation.set(s(tt * k + ph + i) * 0.35, 0, s(tt * k + ph) * 0.2);
        else g.rotation.set(s(tt * k + ph) * 0.7, 0, 0);
      }
      this.rot('tail', 0, swing(5) * 0.5, 0);
      this.rot('head', anim === 'attack' ? -s(p * Math.PI) * 0.5 : swing(2) * 0.05, 0, 0);
      this.body.position.y = (anim === 'walk' ? Math.abs(swing(14)) * 0.6 : 0) * R;
      if (anim === 'attack') this.body.position.z = s(p * Math.PI) * 3 * R;
      if (anim === 'downed') { this.body.rotation.z = 1.5; this.body.position.y = (1) * R; }
      return;
    }
    // biped: the body offset is set first, then the feet are planted against it
    const breathe = swing(2.2) * 0.4;
    switch (anim) {
      case 'idle':
        this.body.position.y = (-0.3 + breathe * 0.3) * R;
        this.stand(0.6, -0.4);
        this.rot('armR', swing(2.2) * 0.04, 0, 0.04);
        this.rot('armL', -swing(2.2) * 0.04, 0, -0.04);
        this.rot('head', 0, swing(0.7) * 0.12, 0);
        break;
      case 'ready':
        // a fighting stance between actions: feet apart, knees bent, weapon up, eyes on the foe
        this.body.position.y = (-1 + breathe * 0.3) * R;
        this.stand(2.2, -1.8);
        this.rot('torso', 0.08);
        this.rot('armR', -0.7 + swing(2.2) * 0.05, 0, 0.12);
        this.rot('armL', -0.45, 0, -0.1);
        break;
      case 'block': {
        // brace: shield arm thrown forward, body leaning into it, pushed back by the blow
        const k = s(Math.min(1, p * 2.2) * Math.PI / 2) * (1 - Math.max(0, p - 0.6) / 0.4);
        this.body.position.set(0, (-0.8 - 0.9 * k) * R, -1.4 * s(p * Math.PI) * R);
        this.stand(2.2, -2.6);
        this.rot('armL', -1.6 * k, 0, 0.35 * k);
        this.rot('armR', -0.5, 0, 0.15);
        this.rot('torso', 0.22 * k);
        break;
      }
      case 'parry': {
        // the blade sweeps across and turns the blow aside
        const k = s(p * Math.PI);
        this.body.position.y = (-0.8 - 0.6 * k) * R;
        this.stand(2, -1.8);
        this.rot('armR', -1.7 + p * 0.6, 0, 0.9 - p * 1.6);
        this.rot('torso', 0.05, 0.45 - p * 0.9, 0);
        break;
      }
      case 'dodge': {
        const k = s(p * Math.PI);
        this.body.position.set(2.4 * k * R, -0.8 * k * R, -0.6 * k * R);
        this.body.rotation.z = -0.28 * k;
        this.stand(0.6, -0.6 - 1.2 * k);
        this.rot('armR', -0.4, 0, 0.6 * k); this.rot('armL', -0.2, 0, -0.5 * k);
        break;
      }
      case 'stagger': {
        // knocked back off a shield or a parry: arms thrown wide, a step backwards
        const k = s(p * Math.PI);
        this.body.position.set(0, -0.6 * k * R, -2.2 * k * R);
        this.foot('R', 0.4 * R);
        this.foot('L', -4 * k * R, 1.2 * R * s(Math.min(1, p * 2) * Math.PI));
        this.rot('torso', -0.4 * k);
        this.rot('head', -0.25 * k);
        this.rot('armR', 0.3 * k, 0, 0.9 * k); this.rot('armL', 0.3 * k, 0, -0.9 * k);
        break;
      }
      case 'cower':
        // only the frightened: crouched low, arms over the head, face turned away
        this.body.position.y = (-2.6 + Math.abs(swing(14)) * 0.25) * R;
        this.stand(1, 0.2);
        this.rot('torso', 0.45);
        this.rot('head', 0.35, 0.5, 0);
        this.rot('armR', -2.5, 0, 0.5); this.rot('armL', -2.4, 0, -0.5);
        break;
      case 'walk': {
        // heel strike at the ends of the stride (lowest), passing over the planted foot (highest)
        const g = this.gait, S = this.halfStride, L = this.legLen;
        const reach = Math.max(0, L - Math.sqrt(Math.max(0, (L * 0.985) ** 2 - S * S)));
        const effort = Math.min(1, S / (L * 0.4));
        this.body.position.set(Math.sin(g * Math.PI * 2) * 0.3 * R, -reach - 0.3 * R + (0.5 - 0.5 * Math.cos(g * Math.PI * 4)) * reach * 0.8, 0);
        this.stride('R', g);
        this.stride('L', (g + 0.5) % 1);
        // arms swing against the legs; shoulders twist against the hips
        const c = Math.cos(g * Math.PI * 2);
        this.rot('armR', c * (0.35 + 0.35 * effort), 0, 0.05); this.rot('armL', -c * (0.35 + 0.35 * effort), 0, -0.05);
        this.rot('torso', 0.05 + 0.1 * effort, c * 0.12, 0);
        this.rot('head', -0.03, -c * 0.1, 0);
        break;
      }
      case 'crouch':
        this.body.position.y = (-1.8 + breathe * 0.3) * R;
        this.stand(1.4, -1);
        this.rot('torso', 0.25);
        this.rot('head', -0.15);
        this.rot('armR', -0.5, 0, 0.1); this.rot('armL', -0.4, 0, -0.1);
        break;
      case 'attack': {
        // wind up behind, then a strong forward swing, lunging into it off the back foot
        const a = p < 0.45 ? -(p / 0.45) * 2.4 : -2.4 + ((p - 0.45) / 0.55) * 3.4;
        const lunge = Math.max(0, s(((p - 0.35) / 0.65) * Math.PI));
        this.body.position.set(0, (-1 - 0.5 * lunge) * R, (1.6 * lunge - 0.4 * s(Math.min(1, p / 0.45) * Math.PI)) * R);
        this.stand(2.6, -2.2);
        this.rot('armR', a, 0, 0.2);
        this.rot('torso', p < 0.45 ? -0.1 : 0.2, p < 0.45 ? 0.3 : -0.3, 0);
        this.rot('armL', 0.3);
        break;
      }
      case 'cast': {
        // rising onto the toes as the spell goes up
        const up = s(Math.min(1, p * 1.4) * Math.PI / 2);
        this.body.position.y = (up * 0.8 - 0.3) * R;
        const heel = 0.45 * up;
        this.foot('R', 0.6 * R, 0, heel); this.foot('L', -0.4 * R, 0, heel);
        this.rot('armR', -2.6 * up, 0, 0.3 * up); this.rot('armL', -2.6 * up, 0, -0.3 * up);
        this.rot('head', -0.2 * up);
        break;
      }
      case 'shoot': {
        const draw = Math.min(1, p * 1.6);
        this.body.position.y = -0.7 * R;
        this.stand(1.8, -1.8);
        this.rot('armL', -1.5, 0, 0.1);
        this.rot('armR', -1.4 + draw * 0.2, 0, 0.45 * draw);
        this.rot('torso', 0, 0.35, 0);
        break;
      }
      case 'hurt': {
        const k = s(p * Math.PI);
        this.body.position.set(0, (-0.3 - 0.6 * k) * R, -0.6 * k * R);
        this.stand(0.6, -0.8);
        this.rot('torso', -0.35 * k);
        this.rot('head', -0.3 * k);
        this.rot('armR', 0.4, 0, 0.4); this.rot('armL', 0.4, 0, -0.4);
        break;
      }
      case 'downed':
        this.body.rotation.x = -1.45;
        this.body.position.set(0, 2 * R, -6 * R);
        this.rot('legR', -0.35); this.rot('shinR', 0.7); this.rot('footR', -0.3);
        this.rot('legL', 0.05); this.rot('shinL', 0.15);
        this.rot('armR', -0.4, 0, 0.6); this.rot('armL', 0.2, 0, -0.5);
        this.rot('head', 0, 0.6, 0);
        break;
      case 'celebrate': {
        // jumping for joy, knees tucked at the top of each hop
        const j = Math.abs(swing(6));
        this.body.position.y = (j * 2.4 - 0.4) * R;
        this.foot('R', 0.6 * R, j * 1.4 * R, 0.4 * j);
        this.foot('L', -0.4 * R, j * 1.4 * R, 0.4 * j);
        this.rot('armR', -2.8, 0, 0.3); this.rot('armL', -2.8 + swing(6) * 0.3, 0, -0.3);
        break;
      }
    }
  }
}
