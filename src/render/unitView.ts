// A unit on screen: the model's parts as a Three.js hierarchy, posed procedurally every frame.
import * as THREE from 'three';
import { RES, type Model } from '../art/kit';
import { meshVoxels } from './voxmesh';

/** One fine voxel in tiles: a design unit is 1/32 tile, stored at RES× resolution. */
export const VOXEL = 1 / (32 * RES);

export type Anim = 'idle' | 'walk' | 'attack' | 'cast' | 'shoot' | 'hurt' | 'crouch' | 'downed' | 'celebrate';

export const unitMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export class UnitView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly parts = new Map<string, THREE.Group>();
  readonly meshes: THREE.Mesh[] = [];
  private phase: number;

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
  }

  private rot(name: string, x = 0, y = 0, z = 0) {
    const g = this.parts.get(name);
    if (g) g.rotation.set(x, y, z);
  }

  /**
   * Pose the rig. `t` is seconds; `p` is 0–1 progress through one-shot actions (attack, cast, shoot, hurt).
   * The renderer chooses the animation from the sim's events and state.
   */
  pose(anim: Anim, t: number, p = 0) {
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
    // biped
    const breathe = swing(2.2) * 0.4;
    switch (anim) {
      case 'idle':
        this.body.position.y = (breathe * 0.5) * R;
        this.rot('armR', swing(2.2) * 0.04, 0, 0.04);
        this.rot('armL', -swing(2.2) * 0.04, 0, -0.04);
        this.rot('head', 0, swing(0.7) * 0.12, 0);
        break;
      case 'walk': {
        const w = swing(9);
        this.rot('legR', w * 0.7); this.rot('legL', -w * 0.7);
        this.rot('armR', -w * 0.55, 0, 0.05); this.rot('armL', w * 0.55, 0, -0.05);
        this.body.position.y = (Math.abs(s(tt * 9)) * 0.9) * R;
        this.rot('torso', 0.06);
        break;
      }
      case 'crouch':
        this.body.position.y = (-1.6 + breathe * 0.3) * R;
        this.rot('legR', -0.5); this.rot('legL', -0.5);
        this.rot('torso', 0.25);
        this.rot('head', -0.15);
        this.rot('armR', -0.5, 0, 0.1); this.rot('armL', -0.4, 0, -0.1);
        break;
      case 'attack': {
        // wind up behind, then a strong forward swing
        const a = p < 0.45 ? -(p / 0.45) * 2.4 : -2.4 + ((p - 0.45) / 0.55) * 3.4;
        this.rot('armR', a, 0, 0.2);
        this.rot('torso', p < 0.45 ? -0.1 : 0.2, p < 0.45 ? 0.3 : -0.3, 0);
        this.rot('armL', 0.3);
        this.rot('legR', -0.3); this.rot('legL', 0.3);
        break;
      }
      case 'cast': {
        const up = s(Math.min(1, p * 1.4) * Math.PI / 2);
        this.rot('armR', -2.6 * up, 0, 0.3 * up); this.rot('armL', -2.6 * up, 0, -0.3 * up);
        this.rot('head', -0.2 * up);
        this.body.position.y = (up * 0.8) * R;
        break;
      }
      case 'shoot': {
        const draw = Math.min(1, p * 1.6);
        this.rot('armL', -1.5, 0, 0.1);
        this.rot('armR', -1.4 + draw * 0.2, 0, 0.45 * draw);
        this.rot('torso', 0, 0.35, 0);
        break;
      }
      case 'hurt':
        this.rot('torso', -0.35 * s(p * Math.PI));
        this.rot('head', -0.3 * s(p * Math.PI));
        this.rot('armR', 0.4, 0, 0.4); this.rot('armL', 0.4, 0, -0.4);
        break;
      case 'downed':
        this.body.rotation.x = -1.45;
        this.body.position.set(0, 2 * R, -6 * R);
        this.rot('armR', -0.4, 0, 0.6); this.rot('armL', 0.2, 0, -0.5);
        this.rot('head', 0, 0.6, 0);
        break;
      case 'celebrate': {
        const j = Math.abs(swing(6));
        this.body.position.y = (j * 2) * R;
        this.rot('armR', -2.8, 0, 0.3); this.rot('armL', -2.8 + swing(6) * 0.3, 0, -0.3);
        break;
      }
    }
  }
}
