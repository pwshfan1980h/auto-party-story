// Replays a sim fight from its event log: the renderer never decides anything, it only shows what the sim did.
import * as THREE from 'three';
import { allVoxels, type Model } from '../art/kit';
import { heroModel, rollLook } from '../art/humanoid';
import { enemyModel } from '../art/monsters';
import { ABILITIES } from '../sim/data';
import { Fight, type FightResult, type FightSetup, type SimEvent } from '../sim/fight';
import { buildField, brazier, tileToWorld } from './fieldView';
import { Fx } from './fx';
import { BattleScene } from './scene';
import { UnitView, VOXEL, type Anim } from './unitView';
import { meshVoxels } from './voxmesh';
import { unitMaterial } from './unitView';

type Snap = [t: number, x: number, y: number, facing: number, hp: number, energy: number];

interface UnitState {
  id: string;
  view: UnitView;
  model: Model;
  team: number;
  maxHp: number;
  snaps: Snap[];
  alive: boolean;
  downed: boolean;
  anim: Anim | null;
  animStart: number;
  animDur: number;
  yaw: number;
  drip: number;
  shadow: THREE.Mesh;
}

const DMG_COLOR: Record<string, number> = { fire: 0xff8a3c, holy: 0xf4e6a0, shadow: 0xb07aff, storm: 0x8ad8ff, poison: 0x8ef06a, pierce: 0xe8dcc0, slash: 0xe8dcc0, blunt: 0xe8dcc0, frost: 0xa6e0ff };

export interface BattleOptions {
  /** Battle camera: 'subtle' (default) moves only for ultimates and the end; 'off' never moves. */
  camera: 'subtle' | 'off';
  /** Accessibility: HP pips and damage numbers (off by default, DESIGN §0). */
  clarity: boolean;
  torchFuel: number;
}

export class BattleReplay {
  readonly result: FightResult;
  readonly events: SimEvent[];
  readonly fx: Fx;
  private readonly units = new Map<string, UnitState>();
  private evIdx = 0;
  t = 0;
  private cine: { t: number; dur: number; at: THREE.Vector3 } | null = null;
  private lastCine = -99;
  private freeze = 0;
  private torchDropped: THREE.Vector3 | null = null;
  private readonly root = new THREE.Group();
  private readonly fight: Fight;

  constructor(readonly scene: BattleScene, readonly setup: FightSetup, readonly overlay: HTMLElement, readonly opts: BattleOptions) {
    this.fight = new Fight({ ...setup, mode: 'full' });
    this.result = this.fight.run();
    this.events = this.result.events;
    const f = this.fight.field;
    scene.world.add(this.root);
    this.root.add(buildField(f, setup.seed).group);
    this.fx = new Fx(this.root);
    // the party's brazier marks where they came in
    const b = new THREE.Mesh(meshVoxels(brazier().voxels), unitMaterial);
    b.scale.setScalar(VOXEL);
    const [bx, bz] = tileToWorld(f, 0.6, f.h / 2);
    b.position.set(bx, 0, bz);
    this.root.add(b);
    scene.frame = (f.w + f.h) * 0.21;
    // per-unit position snapshots
    const snaps = new Map<string, Snap[]>();
    for (const e of this.events) if (e.type === 'pos') for (const row of e.u as (string | number)[][]) {
      const [id, x, y, fa, hp, en] = row as [string, number, number, number, number, number];
      (snaps.get(id) ?? snaps.set(id, []).get(id)!).push([e.t, x, y, fa, hp, en]);
    }
    for (const e of this.events) if (e.type === 'unitinfo') this.addUnit(e, snaps.get(e.unit as string) ?? []);
  }

  dispose() { this.scene.world.remove(this.root); this.fx.clear(); this.overlay.querySelectorAll('.fx-label').forEach((n) => n.remove()); }

  get done() { return this.evIdx >= this.events.length; }

  private addUnit(e: SimEvent, snaps: Snap[]) {
    const id = e.unit as string;
    if (this.units.has(id)) return;
    const hero = this.setup.heroes.find((h) => h.id === id);
    const model = hero ? heroModel(hero.classId, rollLook(hero.raceId, hero.id)) : enemyModel(e.def as string);
    const view = new UnitView(model, id.length * 13);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.26 * model.scale, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    view.root.add(shadow);
    view.root.visible = false;
    this.root.add(view.root);
    const team = e.team as number;
    // start from the spawn position, so units are on the field from their first frame
    if (!snaps.length || snaps[0][0] > e.t) snaps.unshift([e.t, e.x as number, e.y as number, team ? Math.PI : 0, e.maxHp as number, 0]);
    this.units.set(id, { id, view, model, team, maxHp: e.maxHp as number, snaps, alive: true, downed: false, anim: null, animStart: 0, animDur: 0, yaw: team ? -Math.PI / 2 : Math.PI / 2, drip: 0, shadow });
  }

  /** Interpolated [x, y, hp, energy] for a unit at time t. */
  private sample(u: UnitState, t: number): [number, number, number, number] {
    const s = u.snaps;
    if (!s.length) return [0, 0, u.maxHp, 0];
    if (t <= s[0][0]) return [s[0][1], s[0][2], s[0][4], s[0][5]];
    let lo = 0, hi = s.length - 1;
    if (t >= s[hi][0]) return [s[hi][1], s[hi][2], s[hi][4], s[hi][5]];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid][0] <= t) lo = mid; else hi = mid; }
    const a = s[lo], b = s[hi], k = (t - a[0]) / (b[0] - a[0] || 1);
    return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[4] + (b[4] - a[4]) * k, a[5] + (b[5] - a[5]) * k];
  }

  private world(x: number, y: number, h = 0): THREE.Vector3 {
    const [wx, wz] = tileToWorld(this.fight.field, x, y);
    return new THREE.Vector3(wx, h, wz);
  }

  private label(text: string, at: THREE.Vector3, cls: string) {
    const el = document.createElement('div');
    el.className = `fx-label ${cls}`;
    el.textContent = text;
    (el as HTMLElement & { __at?: THREE.Vector3; __t?: number }).__at = at.clone();
    (el as HTMLElement & { __t?: number }).__t = 0;
    this.overlay.append(el);
  }

  private banner(text: string, sub?: string) {
    const el = document.createElement('div');
    el.className = 'fx-label banner';
    el.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    this.overlay.append(el);
    setTimeout(() => el.remove(), 1800);
  }

  private startCine(at: THREE.Vector3, end = false) {
    if (this.opts.camera === 'off') return;
    if (!end && this.t - this.lastCine < 8) return;
    this.lastCine = this.t;
    this.cine = { t: 0, dur: end ? 1.8 : 1.2, at: at.clone().multiplyScalar(0.5) };
  }

  private act(u: UnitState, ability: string, dur: number) {
    const ab = ABILITIES[ability];
    const friendly = ab?.friendly;
    u.anim = u.model.style === 'caster' || friendly ? 'cast' : u.model.style === 'ranged' ? 'shoot' : 'attack';
    u.animStart = this.t;
    u.animDur = Math.max(0.35, dur + 0.3);
  }

  private apply(e: SimEvent) {
    const U = (id: unknown) => this.units.get(id as string);
    switch (e.type) {
      case 'windup': { const u = U(e.unit); if (u) this.act(u, e.ability as string, e.dur as number); break; }
      case 'proj': {
        const u = U(e.unit); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        const to = e.to as number[];
        const ab = ABILITIES[e.ability as string];
        const dmg = ab?.effects.find((x) => x.type === 'damage') as { dmgType?: string } | undefined;
        this.fx.projectile(this.world(x, y, 0.5), this.world(to[0], to[1], 0.45), e.dur as number, ab?.friendly ? 0x9ef07a : DMG_COLOR[dmg?.dmgType ?? 'pierce'] ?? 0xe8dcc0);
        break;
      }
      case 'telegraph': this.fx.telegraph(this.world(e.x as number, e.y as number), e.r as number, e.dur as number); break;
      case 'hit': {
        const u = U(e.dst); if (!u || !u.alive) break;
        const [x, y] = this.sample(u, this.t);
        const at = this.world(x, y);
        if (!u.downed) { u.anim = 'hurt'; u.animStart = this.t; u.animDur = 0.3; }
        // diegetic damage: voxels chip off, sparks fly; crits hit harder and pause the frame
        const vox = allVoxels(u.model);
        const chips = Array.from({ length: e.crit ? 18 : 8 }, () => vox[Math.floor(Math.random() * vox.length)]);
        this.fx.burst(at, chips, VOXEL * u.model.scale * 1.4, { life: 0.9, up: 0.6, yaw: u.yaw });
        const spark = DMG_COLOR[e.type as string] ?? 0xf0e0c0;
        this.fx.burst(at.clone().setY(0.4), Array.from({ length: e.crit ? 10 : 4 }, () => ({ x: (Math.random() - 0.5) * 6, y: Math.random() * 6, z: (Math.random() - 0.5) * 6, c: spark })), 0.025, { life: 0.4, up: 1, grav: 4 });
        if (e.crit) { this.freeze = 0.06; this.scene.shake(0.02, 0.1); }
        if (this.opts.clarity && (e.dmg as number) > 0) this.label(String(e.dmg), at.clone().setY(1.1), e.crit ? 'num crit' : 'num');
        break;
      }
      case 'heal': {
        const u = U(e.dst); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        this.fx.burst(this.world(x, y), Array.from({ length: 10 }, () => ({ x: (Math.random() - 0.5) * 14, y: Math.random() * 10, z: (Math.random() - 0.5) * 14, c: 0x9ef07a })), 0.03, { life: 0.9, up: 0.3, grav: -1.5 });
        if (this.opts.clarity) this.label(`+${e.amount}`, this.world(x, y, 1.1), 'num heal');
        break;
      }
      case 'miss': {
        const u = U(e.dst); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        this.fx.burst(this.world(x, y), Array.from({ length: 6 }, () => ({ x: (Math.random() - 0.5) * 10, y: 0, z: (Math.random() - 0.5) * 10, c: 0x6e687a })), 0.03, { life: 0.5, up: -0.4, grav: 3 });
        break;
      }
      case 'downed': { const u = U(e.unit); if (u) { u.downed = true; u.anim = 'downed'; } break; }
      case 'revive': { const u = U(e.dst); if (u) { u.downed = false; u.anim = 'celebrate'; u.animStart = this.t; u.animDur = 0.6; } break; }
      case 'death': case 'escaped': {
        const u = U(e.unit); if (!u || !u.alive) break;
        u.alive = false;
        const [x, y] = this.sample(u, Math.max(0, this.t - 0.05));
        if (e.type === 'death') this.fx.burst(this.world(x, y), allVoxels(u.model), VOXEL * u.model.scale, { life: 2.4, yaw: u.yaw, spread: 1.2 });
        u.view.root.visible = false;
        if (this.setup.leader?.heroId === u.id) this.torchDropped = this.world(x, y, 0.15);
        break;
      }
      case 'ult': {
        const u = U(e.unit); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        const ab = ABILITIES[e.ability as string];
        this.banner((ab?.name ?? 'Ultimate').toUpperCase());
        this.startCine(this.world(x, y));
        this.scene.shake(0.03, 0.15);
        break;
      }
      case 'call': {
        const u = U(e.leader); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        const words: Record<string, string> = { charge: 'Charge!', hold: 'Hold!', focus: 'Focus that one!', rally: 'Rally!', fallback: 'Fall back!' };
        this.label(words[e.call as string] ?? String(e.call), this.world(x, y, 1.3), 'call');
        break;
      }
      case 'end': {
        const r = e.result as string;
        this.banner(r === 'victory' ? 'VICTORY' : r === 'fled' ? 'FELL BACK' : 'WIPED', r === 'victory' ? 'The way on is clear' : r === 'fled' ? 'The party got out' : 'The dark takes them');
        this.startCine(new THREE.Vector3(), true);
        break;
      }
    }
  }

  /** Advance playback by real seconds × speed; returns the slow-motion factor in use. */
  update(dtReal: number, speed: number) {
    // battle camera: a gentle push-in with slow motion, then back to the same wide shot
    let slow = 1;
    if (this.cine) {
      this.cine.t += dtReal;
      const k = this.cine.t / this.cine.dur;
      const ease = k < 0.2 ? k / 0.2 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
      const e = ease * ease * (3 - 2 * ease);
      this.scene.focus.lerpVectors(new THREE.Vector3(), this.cine.at, e);
      this.scene.zoom = 1 + 0.4 * e;
      slow = 1 - 0.6 * e;
      if (k >= 1) { this.cine = null; this.scene.focus.set(0, 0, 0); this.scene.zoom = 1; }
    }
    let dt = 0;
    if (this.freeze > 0) this.freeze -= dtReal; else dt = dtReal * speed * slow;
    this.t += dt;
    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.t) this.apply(this.events[this.evIdx++]);
    this.fx.update(dt);

    for (const u of this.units.values()) {
      const visible = u.alive && u.snaps.length > 0 && this.t >= u.snaps[0][0] - 0.01;
      u.view.root.visible = visible;
      if (!visible) continue;
      const [x, y, hp, energy] = this.sample(u, this.t);
      const [x2, y2] = this.sample(u, this.t + 0.12);
      const p = this.world(x, y);
      u.view.root.position.copy(p);
      const vx = x2 - x, vy = y2 - y, moving = Math.hypot(vx, vy) > 0.03;
      // what the rig shows: an action, a flinch, walking, or crouching between actions
      let anim: Anim = moving ? 'walk' : 'crouch', prog = 0;
      if (u.downed) anim = 'downed';
      else if (u.anim && this.t - u.animStart < u.animDur) { anim = u.anim; prog = (this.t - u.animStart) / u.animDur; }
      u.view.pose(anim, this.t, prog);
      // hurt posture: lean in proportion to wounds
      const hpR = hp / u.maxHp;
      if (!u.downed && hpR < 0.5) { const torso = u.view.parts.get('torso'); if (torso) torso.rotation.x += 0.35 * (1 - hpR); }
      // face where they're going, or where they're acting
      if (moving && !u.downed) { const want = Math.atan2(vx, vy); let d = want - u.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); u.yaw += d * Math.min(1, dt * 10 + 0.05); }
      u.view.root.rotation.y = u.yaw;
      // badly hurt units bleed
      if ((hpR < 0.4 || u.downed) && u.team === 0) {
        u.drip -= dt;
        if (u.drip <= 0) { u.drip = 0.25 + hpR * 0.6; this.fx.decal(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25))); }
      }
      void energy;
    }
    // the Leader carries the torch
    const L = this.setup.leader && this.units.get(this.setup.leader.heroId);
    const flicker = Math.sin(performance.now() / 90) * 0.25 + Math.sin(performance.now() / 37) * 0.15;
    if (L && L.alive && !this.torchDropped) { const [x, y] = this.sample(L, this.t); this.scene.torch.position.copy(this.world(x, y, 1.3)); this.scene.setTorch(this.opts.torchFuel, flicker); }
    else if (this.torchDropped) { this.scene.torch.position.copy(this.torchDropped); this.scene.setTorch(this.opts.torchFuel / 2, flicker); }
    // floating labels
    for (const el of this.overlay.querySelectorAll<HTMLElement & { __at?: THREE.Vector3; __t?: number }>('.fx-label:not(.banner)')) {
      el.__t = (el.__t ?? 0) + dtReal;
      const v = el.__at!.clone().project(this.scene.camera);
      el.style.left = `${((v.x + 1) / 2) * this.overlay.clientWidth}px`;
      el.style.top = `${((1 - v.y) / 2) * this.overlay.clientHeight - el.__t * 30}px`;
      el.style.opacity = String(Math.max(0, 1 - Math.max(0, el.__t - 0.8) / 0.5));
      if (el.__t > 1.4) el.remove();
    }
    return slow;
  }
}
