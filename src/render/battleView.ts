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
import type { Sfx, Voice } from '../audio/sfx';
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
  /** Frightened right now: the only time a unit cowers and looks away. */
  feared: boolean;
  /** Statuses on the unit, shown as motes in the world. */
  statuses: string[];
  moteT: number;
  shadow: THREE.Mesh;
}

const DMG_COLOR: Record<string, number> = { fire: 0xff8a3c, holy: 0xf4e6a0, shadow: 0xb07aff, storm: 0x8ad8ff, poison: 0x8ef06a, pierce: 0xe8dcc0, slash: 0xe8dcc0, blunt: 0xe8dcc0, frost: 0xa6e0ff };

export interface BattleOptions {
  /** Battle camera: 'subtle' (default) moves only for ultimates and the end; 'off' never moves. */
  camera: 'subtle' | 'off';
  /** Accessibility: HP pips and damage numbers (off by default, DESIGN §0). */
  clarity: boolean;
  torchFuel: number;
  /** Sound for the fight; silent when omitted. */
  audio?: Sfx;
}

const VOICES: Record<string, Voice> = { fire: 'fire', frost: 'frost', shadow: 'shadow', holy: 'holy', storm: 'storm', poison: 'poison' };
/** Which sound family an ability belongs to, from what it deals. */
function voiceOf(ability: string): Voice {
  const ab = ABILITIES[ability];
  if (!ab) return 'phys';
  if (ab.friendly) return 'holy';
  const dmg = ab.effects.find((x) => x.type === 'damage') as { dmgType?: string } | undefined;
  return VOICES[dmg?.dmgType ?? ''] ?? 'phys';
}
const STEEL = [0xe8eef4, 0xb8c2cc, 0xffd890];
const STATUS_MOTES: Record<string, { c: number; y: number; grav: number; every: number }> = {
  fear: { c: 0x6a4a9a, y: 1.15, grav: -1.2, every: 0.18 },
  stun: { c: 0xf0d060, y: 1.1, grav: 0, every: 0.15 },
  burn: { c: 0xff8a3c, y: 0.5, grav: -2.5, every: 0.12 },
  poison: { c: 0x8ef06a, y: 0.6, grav: 3, every: 0.25 },
  slow: { c: 0xa6e0ff, y: 0.1, grav: -0.5, every: 0.3 },
  ward: { c: 0x7ae8ff, y: 0.6, grav: -0.3, every: 0.35 },
};

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
  private readonly blasts = new Set<string>();
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
    this.units.set(id, { id, view, model, team, maxHp: e.maxHp as number, snaps, alive: true, downed: false, anim: null, animStart: 0, animDur: 0, yaw: team ? -Math.PI / 2 : Math.PI / 2, drip: 0, feared: false, statuses: [], moteT: 0, shadow });
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

  /** Where a unit sits left to right on screen, for stereo panning. */
  private panOf(id: unknown): number {
    const u = this.units.get(id as string);
    if (!u || !u.snaps.length) return 0;
    const [x, y] = this.sample(u, this.t);
    return this.world(x, y).project(this.scene.camera).x;
  }

  /** The point just in front of a unit's chest: where blades meet shields. */
  private front(u: UnitState, h = 0.45): THREE.Vector3 {
    const [x, y] = this.sample(u, this.t);
    return this.world(x, y, h).add(new THREE.Vector3(Math.sin(u.yaw) * 0.22, 0, Math.cos(u.yaw) * 0.22));
  }

  private play(u: UnitState | undefined, anim: Anim, dur: number) {
    if (!u || u.downed || !u.alive) return;
    u.anim = anim; u.animStart = this.t; u.animDur = dur;
  }

  private sparks(at: THREE.Vector3, colors: number[], n: number, spread = 6) {
    this.fx.burst(at, Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * spread, y: Math.random() * spread * 0.8, z: (Math.random() - 0.5) * spread, c: colors[Math.floor(Math.random() * colors.length)] })), 0.022, { life: 0.45, up: 1.4, grav: 5, spread: 1.6 });
  }

  /** The sim's facing at time t, as a yaw: units face whoever they're defending against. */
  private facing(u: UnitState, t: number): number {
    const s = u.snaps;
    let lo = 0, hi = s.length - 1;
    if (t >= s[hi][0]) lo = hi;
    else while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid][0] <= t) lo = mid; else hi = mid; }
    const a = s[lo][3];
    return Math.atan2(Math.cos(a), Math.sin(a));
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
    // a melee strike is a swing whoever makes it: casters bring the staff round, archers the bow
    u.anim = ab?.delivery === 'melee' ? 'attack' : u.model.style === 'caster' || friendly ? 'cast' : u.model.style === 'ranged' ? 'shoot' : 'attack';
    u.animStart = this.t;
    u.animDur = Math.max(0.35, dur + 0.3);
  }

  private apply(e: SimEvent) {
    const U = (id: unknown) => this.units.get(id as string);
    const A = this.opts.audio;
    switch (e.type) {
      case 'windup': {
        const u = U(e.unit); if (!u) break;
        this.act(u, e.ability as string, e.dur as number);
        const ab = ABILITIES[e.ability as string], v = voiceOf(e.ability as string), pan = this.panOf(e.unit);
        if (ab?.delivery === 'melee') A?.whoosh(pan, ab.kind !== 'basic');
        else if (v !== 'phys' && (e.dur as number) > 0.15) {
          A?.cast(v, pan, Math.min(1.6, 0.6 + (e.dur as number)));
          // magic gathering in the hands, in the element's colour
          const at = this.front(u, 0.55);
          const c = ab?.friendly ? 0x9ef07a : DMG_COLOR[(ab?.effects.find((x) => x.type === 'damage') as { dmgType?: string } | undefined)?.dmgType ?? ''] ?? 0xc77aff;
          this.fx.burst(at, Array.from({ length: 12 }, () => ({ x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 16, c })), 0.02, { life: Math.max(0.3, e.dur as number), up: -1, grav: -0.5, spread: -0.6 });
          this.fx.flash(at, c, 1.2, 2.2, Math.max(0.2, e.dur as number));
        }
        break;
      }
      case 'block': {
        const d = U(e.dst), a = U(e.src); if (!d) break;
        this.play(d, 'block', 0.45); this.play(a, 'stagger', 0.35);
        this.sparks(this.front(d), STEEL, 10);
        A?.block(this.panOf(e.dst));
        break;
      }
      case 'parry': {
        const d = U(e.dst), a = U(e.src); if (!d) break;
        this.play(d, 'parry', 0.4); this.play(a, 'stagger', 0.45);
        const at = this.front(d, 0.55);
        this.sparks(at, [0xffe8a0, 0xffd060, 0xffffff], 14, 8);
        this.fx.flash(at, 0xffd890, 1.4, 1.6, 0.15);
        A?.parry(this.panOf(e.dst));
        break;
      }
      case 'dash': A?.whoosh(this.panOf(e.unit), true); break;
      case 'summon': A?.summon(this.panOf(e.owner)); break;
      case 'interrupted': { A?.clang(this.panOf(e.unit)); this.play(U(e.unit), 'stagger', 0.4); break; }
      case 'status': {
        const u = U(e.unit);
        if (u && Array.isArray(e.statuses)) { u.statuses = e.statuses as string[]; u.feared = u.statuses.includes('fear'); }
        else if (u && typeof e.add === 'string') { if (!u.statuses.includes(e.add)) u.statuses.push(e.add); if (e.add === 'fear') u.feared = true; }
        break;
      }
      case 'proj': {
        const u = U(e.unit); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        const to = e.to as number[];
        const ab = ABILITIES[e.ability as string];
        const dmg = ab?.effects.find((x) => x.type === 'damage') as { dmgType?: string } | undefined;
        this.fx.projectile(this.world(x, y, 0.5), this.world(to[0], to[1], 0.45), e.dur as number, ab?.friendly ? 0x9ef07a : DMG_COLOR[dmg?.dmgType ?? 'pierce'] ?? 0xe8dcc0);
        A?.launch(voiceOf(e.ability as string), this.panOf(e.unit));
        break;
      }
      case 'telegraph': {
        const at = this.world(e.x as number, e.y as number);
        this.fx.telegraph(at, e.r as number, e.dur as number);
        A?.rumble(at.clone().project(this.scene.camera).x);
        break;
      }
      case 'hit': {
        const u = U(e.dst); if (!u || !u.alive) break;
        const [x, y] = this.sample(u, this.t);
        const at = this.world(x, y);
        if (!u.downed) { u.anim = 'hurt'; u.animStart = this.t; u.animDur = 0.3; }
        // diegetic damage: voxels chip off, sparks fly; crits hit harder and pause the frame
        const vox = allVoxels(u.model);
        const chips = Array.from({ length: e.crit ? 18 : 8 }, () => vox[Math.floor(Math.random() * vox.length)]);
        this.fx.burst(at, chips, VOXEL * u.model.scale * 1.4, { life: 0.9, up: 0.6, yaw: u.yaw });
        const spark = DMG_COLOR[e.dmgType as string] ?? 0xf0e0c0;
        this.fx.burst(at.clone().setY(0.4), Array.from({ length: e.crit ? 10 : 4 }, () => ({ x: (Math.random() - 0.5) * 6, y: Math.random() * 6, z: (Math.random() - 0.5) * 6, c: spark })), 0.025, { life: 0.4, up: 1, grav: 4 });
        if (e.crit) { this.freeze = 0.06; this.scene.shake(0.02, 0.1); }
        // an area spell lands once, however many it catches: a blast you can see and feel
        const ab = ABILITIES[e.ability as string], voice = voiceOf(e.ability as string), pan = this.panOf(e.dst);
        const key = `${e.ability}@${e.t}`;
        if (ab?.area && !this.blasts.has(key)) {
          this.blasts.add(key);
          const c = DMG_COLOR[e.dmgType as string] ?? 0xffa040;
          const centre = typeof e.cx === 'number' ? this.world(e.cx as number, e.cy as number) : at;
          this.fx.shockwave(centre, (ab.area.r ?? 1.5) * 1.1, c, 0.5);
          this.fx.flash(centre.clone().setY(0.6), c, 4, 5, 0.4);
          this.sparks(centre.clone().setY(0.2), [c, 0x3a3240, 0x6a6074], 22, 14);
          this.scene.shake(0.035, 0.22);
          A?.explosion(pan, Math.min(1.5, 0.7 + (ab.area.r ?? 1) * 0.25), voice);
        } else if (!ab?.area) A?.impact(voice, pan, !!e.crit);
        if (this.opts.clarity && (e.dmg as number) > 0) this.label(String(e.dmg), at.clone().setY(1.1), e.crit ? 'num crit' : 'num');
        break;
      }
      case 'heal': {
        const u = U(e.dst); if (!u) break;
        A?.heal(this.panOf(e.dst));
        const [x, y] = this.sample(u, this.t);
        this.fx.burst(this.world(x, y), Array.from({ length: 10 }, () => ({ x: (Math.random() - 0.5) * 14, y: Math.random() * 10, z: (Math.random() - 0.5) * 14, c: 0x9ef07a })), 0.03, { life: 0.9, up: 0.3, grav: -1.5 });
        if (this.opts.clarity) this.label(`+${e.amount}`, this.world(x, y, 1.1), 'num heal');
        break;
      }
      case 'miss': {
        const u = U(e.dst); if (!u) break;
        if (e.reason === 'dodge') this.play(u, 'dodge', 0.35);
        A?.whoosh(this.panOf(e.dst));
        const [x, y] = this.sample(u, this.t);
        this.fx.burst(this.world(x, y), Array.from({ length: 6 }, () => ({ x: (Math.random() - 0.5) * 10, y: 0, z: (Math.random() - 0.5) * 10, c: 0x6e687a })), 0.03, { life: 0.5, up: -0.4, grav: 3 });
        break;
      }
      case 'downed': { const u = U(e.unit); if (u) { u.downed = true; u.anim = 'downed'; A?.downed(this.panOf(e.unit)); } break; }
      case 'revive': { const u = U(e.dst); if (u) { u.downed = false; u.anim = 'celebrate'; u.animStart = this.t; u.animDur = 0.6; A?.heal(this.panOf(e.dst), true); } break; }
      case 'death': case 'escaped': {
        const u = U(e.unit); if (!u || !u.alive) break;
        u.alive = false;
        const [x, y] = this.sample(u, Math.max(0, this.t - 0.05));
        if (e.type === 'death') {
          this.fx.burst(this.world(x, y), allVoxels(u.model), VOXEL * u.model.scale, { life: 2.4, yaw: u.yaw, spread: 1.2 });
          A?.death(this.panOf(e.unit), /skeleton|bone|skull/.test(u.model.id));
        }
        u.view.root.visible = false;
        if (this.setup.leader?.heroId === u.id) this.torchDropped = this.world(x, y, 0.15);
        break;
      }
      case 'ult': {
        const u = U(e.unit); if (!u) break;
        const [x, y] = this.sample(u, this.t);
        const ab = ABILITIES[e.ability as string];
        this.banner((ab?.name ?? 'Ultimate').toUpperCase());
        A?.ult(this.panOf(e.unit), voiceOf(e.ability as string));
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
        A?.ending(r === 'victory');
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
      // what the rig shows: an action, a flinch, walking, a ready stance, or cowering in fear
      let anim: Anim = u.feared ? (moving ? 'walk' : 'cower') : moving ? 'walk' : 'ready', prog = 0;
      if (u.downed) anim = 'downed';
      else if (u.anim && this.t - u.animStart < u.animDur) { anim = u.anim; prog = (this.t - u.animStart) / u.animDur; }
      u.view.pose(anim, this.t, prog);
      // hurt posture: lean in proportion to wounds
      const hpR = hp / u.maxHp;
      if (!u.downed && hpR < 0.5) { const torso = u.view.parts.get('torso'); if (torso) torso.rotation.x += 0.35 * (1 - hpR); }
      // face the threat (the sim decides); kiters backpedal with their eyes on the enemy
      if (!u.downed) { const want = this.facing(u, this.t); let d = want - u.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); u.yaw += d * Math.min(1, dt * 12 + 0.05); }
      u.view.root.rotation.y = u.yaw;
      // statuses show in the world: wisps of fear, a stunned daze, embers, drips of poison
      if (u.statuses.length && !u.downed) {
        u.moteT -= dt;
        if (u.moteT <= 0) {
          let next = 1;
          for (const st of u.statuses) {
            const m = STATUS_MOTES[st]; if (!m) continue;
            next = Math.min(next, m.every);
            const at = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, m.y * u.model.scale, (Math.random() - 0.5) * 0.3));
            this.fx.burst(at, [{ x: 0, y: 0, z: 0, c: m.c }, { x: 4, y: 2, z: -3, c: m.c }], 0.03, { life: 0.7, up: -1.2, grav: m.grav, spread: 0.4 });
          }
          u.moteT = next;
        }
      }
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
