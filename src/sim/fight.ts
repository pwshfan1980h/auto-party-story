// The real-time fight: a fixed 20 Hz tick loop with no rendering (spec 02).
// Phases per tick: timers → projectiles/telegraphs → decisions → movement → actions → deaths/end.
import { ABILITIES, ARCHETYPES, CLASSES, ENEMIES, RULES, SPECIES, STATUSES, TIERS } from './data';
import { flowDir, flowField, generateField, lineOfSight, SpatialHash, walkableAt, type Field } from './field';
import { hash32, stream, type Rng } from './rng';
import { autoAttrs, heroStats, monsterStats, rollDamage } from './stats';
import type { AbilityDef, Attrs, DamageType, Effect, RankId, RoomType, RuleDef, Stats, Team, Zone } from './types';
import { PHYSICAL } from './types';

export const TICK = 0.05;
const TICKS_PER_S = 20;

// ---------------- setup and result types ----------------

export interface HeroSnapshot {
  id: string;
  name: string;
  classId: string;
  raceId: string;
  level: number;
  gearScore: number;
  zone: Zone;
  attrs?: Attrs;
  energy?: number;
  /** Current HP when carried over from an earlier room; full if omitted. */
  hp?: number;
}

export interface MonsterSpawn {
  enemyId: string;
  level: number;
  rank?: RankId;
  /** A shiny Rare: tougher, and runs for the edge after a few seconds (spec 11). */
  rare?: boolean;
}

/** The party's Leader inside a fight: who they are and what their rank lets them call (spec 07). */
export interface FightLeader {
  heroId: string;
  rank: 'novice' | 'seasoned' | 'veteran' | 'master';
  noise: number;
  temperament: string;
}

export type OrderPolicy = 'none' | 'good' | 'spam';
/** Which orders the good policy may use (for experiments and the sim's ablation reports). */
export const GOOD_POLICY = { mend: true, interrupt: true, focus: true, unleash: true, hold: true };
export type OrderKind = 'mend' | 'focus' | 'guard' | 'interrupt' | 'unleash' | 'hold' | 'charge' | 'fallback';

/** Player Orders: ember cost and cooldown (DESIGN §4). */
export const ORDERS: Record<OrderKind, { cost: number; cooldown: number }> = {
  mend: { cost: 1, cooldown: 6 }, focus: { cost: 1, cooldown: 8 }, guard: { cost: 1, cooldown: 10 }, interrupt: { cost: 1, cooldown: 10 },
  unleash: { cost: 2, cooldown: 15 }, hold: { cost: 2, cooldown: 12 }, charge: { cost: 2, cooldown: 12 }, fallback: { cost: 2, cooldown: 9999 },
};

export interface FightSetup {
  seed: number;
  /** Extra keys for the RNG streams (floor, room…), so every room in a run differs. */
  key?: (string | number)[];
  tier: string;
  roomType: RoomType;
  heroes: HeroSnapshot[];
  monsters: MonsterSpawn[];
  mode?: 'full' | 'batch';
  maxTime?: number;
  leader?: FightLeader;
  /** Embers available for Player Orders. */
  embers?: number;
  /** How Player Orders are issued in a headless fight. */
  orderPolicy?: OrderPolicy;
}

export type SimEvent = { t: number; type: string } & Record<string, unknown>;

export interface UnitSummary {
  id: string;
  name: string;
  team: Team;
  kind: Unit['kind'];
  defId: string;
  alive: boolean;
  downed: boolean;
  hp: number;
  maxHp: number;
  energy: number;
  dealt: number;
  taken: number;
  healed: number;
  overheal: number;
  kills: number;
  crits: number;
  hits: number;
  misses: number;
  ults: number;
  ccSeconds: number;
}

export interface FightResult {
  result: 'victory' | 'defeat' | 'timeout' | 'fled';
  duration: number;
  events: SimEvent[];
  units: UnitSummary[];
  /** Heroes who were Downed when the party won: they live, with a Grave Injury. */
  carried: string[];
  /** Heroes who died for good (Hardcore). */
  died: string[];
  hash: number;
  stuckSeconds: number;
  peakUnits: number;
  embersLeft: number;
  /** Orders issued and how they ended, by kind. */
  orders: { issued: Record<string, number>; lapsed: number };
  /** Leader combat calls made, by kind. */
  calls: Record<string, number>;
  /** Rares that got away. */
  escaped: string[];
  field: { w: number; h: number; attempt: number; fallback: boolean; cover: number; hazards: number };
}

// ---------------- runtime unit ----------------

interface StatusInst { id: string; left: number; stacks: number; src: string; tickDmg: number; tickType?: DamageType }

interface Plan { ability: string; targetId: string; intent: string; arg: number }
interface QueuedOrder { kind: OrderKind; ability: string; targetId: string; until: number; boost: number; cost: number }

export interface Unit {
  id: string;
  name: string;
  spawnIndex: number;
  team: Team;
  kind: 'hero' | 'monster' | 'summon';
  defId: string;
  level: number;
  base: Stats;
  tags: string[];
  typeMods: Record<string, number>;
  backliner: boolean;
  minion: boolean;
  hp: number;
  shield: number;
  shieldLeft: number;
  energy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  basic: string;
  skills: string[];
  ult?: string;
  cooldowns: Record<string, number>;
  rules: RuleDef[];
  plan?: Plan;
  windup?: { ability: string; targetId: string; ax: number; ay: number; left: number };
  statuses: StatusInst[];
  ruleIdx: number;
  alive: boolean;
  downedLeft: number;
  summonerId?: string;
  summonLeft: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  rare: boolean;
  fleeAt: number;
  threat: Map<string, number>;
  order?: QueuedOrder;
  boostNext: number;
  cc: { n: number; until: number };
  roles: Record<string, number>;
  s: Omit<UnitSummary, 'id' | 'name' | 'team' | 'kind' | 'defId' | 'alive' | 'downed' | 'hp' | 'maxHp' | 'energy'>;
}

const BACK_ARCHETYPES = new Set(['shooter', 'caster', 'mender', 'summoner', 'wailer']);
const FRONT_ZONE_ARCHETYPES = new Set(['grunt', 'brute', 'guardian', 'swarm', 'bomber', 'skirmisher']);

function newCounters(): Unit['s'] {
  return { dealt: 0, taken: 0, healed: 0, overheal: 0, kills: 0, crits: 0, hits: 0, misses: 0, ults: 0, ccSeconds: 0 };
}

/** Combine a class's role templates: special rules from each template in order, then the first template's fallback. */
export function mergeTemplates(names: string[]): RuleDef[] {
  const out: RuleDef[] = [];
  const fallbacks: RuleDef[] = [];
  for (const n of names) for (const r of RULES[n]) (r.if === 'always' && r.use === 'basic' ? fallbacks : out).push(r);
  if (fallbacks.length) out.push(fallbacks[0]);
  return out;
}

// ---------------- the fight ----------------

export class Fight {
  readonly field: Field;
  readonly units: Unit[] = [];
  readonly events: SimEvent[] = [];
  private tick = 0;
  private readonly combat: Rng;
  private readonly ai: Rng;
  private readonly full: boolean;
  private readonly maxTicks: number;
  private readonly hash = new SpatialHash<Unit>(64);
  private readonly fields = new Map<string, { at: number; dist: Float32Array }>();
  private readonly byId = new Map<string, Unit>();
  private teamCache: [Unit[], Unit[]] = [[], []];
  private projectiles: { owner: Unit; ab: AbilityDef; x: number; y: number; tx: number; ty: number; targetId: string; left: number }[] = [];
  private telegraphs: { owner: Unit; ab: AbilityDef; x: number; y: number; left: number }[] = [];
  private spawnCount = 0;
  private summonSeq = 0;
  private result: FightResult['result'] | null = null;
  private stuckSeconds = 0;
  private peakUnits = 0;
  private runningHash = 0x811c9dc5;
  private embers: number;
  private orderCd: Partial<Record<OrderKind, number>> = {};
  private globalOrderCd = 0;
  private focusId?: string;
  private focusUntil = 0;
  private fleeUntil = 0;
  private fledOk = false;
  private fallBackUsed = false;
  private callCd: Record<string, number> = {};
  private readonly ordersIssued: Record<string, number> = {};
  private ordersLapsed = 0;
  private readonly calls: Record<string, number> = {};
  private readonly escaped: string[] = [];
  private readonly leaderRng: Rng;
  private readonly policyRng: Rng;

  constructor(private readonly setup: FightSetup) {
    const tier = TIERS[setup.tier];
    const key = setup.key ?? [];
    this.full = (setup.mode ?? 'batch') === 'full';
    this.maxTicks = Math.round((setup.maxTime ?? 180) * TICKS_PER_S);
    this.combat = stream(setup.seed, 'combat', ...key);
    this.ai = stream(setup.seed, 'ai', ...key);
    this.leaderRng = stream(setup.seed, 'leader-fight', ...key);
    this.policyRng = stream(setup.seed, 'policy', ...key);
    this.embers = setup.embers ?? 0;
    const big = setup.monsters.length > 14 || setup.heroes.length > 6;
    const horde = setup.roomType === 'horde';
    this.field = generateField({
      seed: setup.seed, key, biome: tier.biome,
      w: tier.field.w + (horde ? 8 : big ? 4 : 0), h: tier.field.h + (horde ? 4 : big ? 2 : 0),
      cover: tier.field.cover, hazards: tier.field.hazards,
    });
    const spawnRng = stream(setup.seed, 'spawn', ...key);
    for (const h of setup.heroes) this.addHero(h, spawnRng);
    for (const m of setup.monsters) {
      const u = this.addMonster(m.enemyId, m.level, m.rank, 1, undefined, spawnRng);
      if (m.rare) {
        u.rare = true;
        u.base.maxHp = Math.round(u.base.maxHp * 2.5);
        u.hp = u.base.maxHp;
        u.fleeAt = Math.round((8 + spawnRng.next() * 4) * TICKS_PER_S);
        this.emit('rare', { unit: u.id });
      }
    }
  }

  // ----- spawning -----

  private place(team: Team, zone: Zone, rng: Rng): [number, number] {
    const cells = this.field.spawns[team][zone];
    const c = cells[rng.int(cells.length)];
    const w = this.field.w;
    return [(c % w) + 0.2 + rng.next() * 0.6, Math.floor(c / w) + 0.2 + rng.next() * 0.6];
  }

  private baseUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'team' | 'kind' | 'defId' | 'level' | 'base' | 'basic' | 'skills' | 'rules'>): Unit {
    const u: Unit = {
      spawnIndex: this.spawnCount++, tags: [], typeMods: {}, backliner: false, minion: false,
      hp: partial.base.maxHp, shield: 0, shieldLeft: 0, energy: 0, x: 0, y: 0, vx: 0, vy: 0, fx: partial.team === 0 ? 1 : -1, fy: 0,
      cooldowns: {}, statuses: [], ruleIdx: -1, alive: true, downedLeft: 0, summonLeft: 0, stuckT: 0, lastX: 0, lastY: 0,
      rare: false, fleeAt: 0, threat: new Map(), boostNext: 1, cc: { n: 0, until: 0 }, roles: {},
      s: newCounters(), ...partial,
    };
    u.lastX = u.x; u.lastY = u.y;
    this.units.push(u);
    this.byId.set(u.id, u);
    this.emit('spawn', { unit: u.id, def: u.defId, team: u.team, x: r2(u.x), y: r2(u.y) });
    this.unitInfo(u);
    return u;
  }

  private addHero(h: HeroSnapshot, rng: Rng) {
    const c = CLASSES[h.classId];
    const attrs = h.attrs ?? autoAttrs(h.classId, h.level);
    const base = heroStats(h.classId, h.raceId, h.level, attrs, h.gearScore);
    const [x, y] = this.place(0, h.zone, rng);
    const roles = c.roles;
    this.baseUnit({
      id: h.id, name: h.name, team: 0, kind: 'hero', defId: h.classId, level: h.level, base, x, y,
      basic: c.basic, skills: c.skills, ult: c.ult, rules: mergeTemplates(c.ruleTemplates),
      backliner: (roles.heal ?? 0) >= 2 || (roles.artillery ?? 0) >= 2 || (roles.area ?? 0) >= 2 || (roles.summon ?? 0) >= 2 || (roles.support ?? 0) >= 2,
      energy: h.energy ?? 0, tags: ['humanoid'], roles: roles as Record<string, number>,
      hp: h.hp !== undefined ? Math.max(1, Math.min(base.maxHp, h.hp)) : base.maxHp,
    });
  }

  private addMonster(enemyId: string, level: number, rank: string | undefined, team: Team, summoner: Unit | undefined, rng: Rng) {
    const e = ENEMIES[enemyId];
    const ar = ARCHETYPES[e.archetype];
    const { stats, tags, typeMods } = monsterStats(enemyId, level, rank);
    let x: number, y: number;
    if (summoner) {
      const a = rng.next() * Math.PI * 2;
      x = summoner.x + Math.cos(a) * 0.7; y = summoner.y + Math.sin(a) * 0.7;
      if (!walkableAt(this.field.nav, x, y)) { x = summoner.x; y = summoner.y; }
    } else {
      const zone: Zone = this.setup.roomType === 'horde' ? (['front', 'middle', 'back'] as Zone[])[rng.int(3)] : FRONT_ZONE_ARCHETYPES.has(e.archetype) ? 'front' : 'back';
      [x, y] = this.place(team, zone, rng);
    }
    const n = this.units.filter((u) => u.defId === enemyId).length;
    const minion = (rank ?? e.rank) === 'minion';
    const u = this.baseUnit({
      id: `${enemyId}#${n + 1}`, name: e.name, team, kind: summoner ? 'summon' : 'monster', defId: enemyId, level, base: stats, x, y,
      basic: ar.basic, skills: ar.skills ?? [], rules: RULES[ar.rules], tags, typeMods,
      backliner: BACK_ARCHETYPES.has(e.archetype), minion, summonerId: summoner?.id,
    });
    // stagger first actions so a room doesn't attack in lockstep
    u.cooldowns[u.basic] = rng.next() * 0.8;
    return u;
  }

  /** View-only: what the renderer needs to draw a unit (not part of the determinism hash). */
  private unitInfo(u: Unit) {
    this.emit('unitinfo', { unit: u.id, def: u.defId, team: u.team, kind: u.kind, maxHp: u.base.maxHp, radius: u.base.radius, rare: u.rare, x: r2(u.x), y: r2(u.y) }, true);
  }

  // ----- helpers -----

  /** `viewOnly` events (positions, status lists) exist only for the renderer and stay out of the hash. */
  private emit(type: string, data: Record<string, unknown>, viewOnly = false) {
    const t = r2(this.tick * TICK);
    if (viewOnly) { if (this.full) this.events.push({ t, type, ...data }); return; }
    // Fold every gameplay event into a running hash so batch mode can still prove determinism.
    let h = this.runningHash ^ hash32(type, t, JSON.stringify(data));
    h = Math.imul(h, 0x01000193) >>> 0;
    this.runningHash = h;
    if (this.full) this.events.push({ t, type, ...data });
  }

  private get(id: string | undefined): Unit | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }

  private active(u: Unit) { return u.alive && u.downedLeft <= 0; }

  /** Active units per team, refreshed once per tick (and after deaths). */
  private refreshTeams() {
    this.teamCache = [this.units.filter((o) => o.team === 0 && this.active(o)), this.units.filter((o) => o.team === 1 && this.active(o))];
  }

  private enemiesOf(u: Unit) { return this.teamCache[1 - u.team]; }

  private alliesOf(u: Unit) { return this.teamCache[u.team]; }

  private stat(u: Unit, key: 'power' | 'spell' | 'armor' | 'move' | 'atkSpeed' | 'healTaken' | 'evasion'): number {
    let v = u.base[key];
    let pct = 0;
    for (const st of u.statuses) {
      const m = STATUSES[st.id].mods?.[key];
      if (m === undefined) continue;
      if (key === 'armor') v += m * st.stacks; else pct += m * (STATUSES[st.id].stacking === 'stack' ? st.stacks : 1);
    }
    return key === 'armor' ? v : v * Math.max(0.1, 1 + pct);
  }

  private mult(u: Unit, key: 'damageDealt' | 'damageTaken'): number {
    let m = 1;
    for (const st of u.statuses) m *= 1 + (STATUSES[st.id].mods?.[key] ?? 0);
    return m;
  }

  private flag(u: Unit, f: 'stun' | 'root' | 'sleep' | 'taunted'): StatusInst | undefined {
    return u.statuses.find((s) => STATUSES[s.id].flags?.includes(f));
  }

  private canAct(u: Unit) { return this.active(u) && !this.flag(u, 'stun') && !this.flag(u, 'sleep'); }

  private dist(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }

  private gap(a: Unit, b: Unit) { return this.dist(a, b) - a.base.radius - b.base.radius; }

  // ----- the loop -----

  run(): FightResult {
    while (!this.result) this.step();
    return this.finish();
  }

  step() {
    if (this.result) return;
    this.tick++;
    const order = this.units.filter((u) => u.alive);
    const n = order.length;
    this.peakUnits = Math.max(this.peakUnits, n);
    const rot = n ? this.tick % n : 0;
    const ordered = n ? [...order.slice(rot), ...order.slice(0, rot)] : order;

    this.hash.clear();
    for (const u of ordered) this.hash.insert(u);
    this.refreshTeams();

    this.timers(ordered);
    this.flying();
    if (this.tick % 10 === 0) { this.leaderCalls(); this.policyOrders(); }
    if (this.fleeUntil && this.tick >= this.fleeUntil) this.resolveFallBack();
    for (const u of ordered) {
      const cadence = u.minion ? 8 : 4;
      if (this.canAct(u) && !u.windup && (this.tick + u.spawnIndex) % cadence === 0) this.decide(u);
    }
    for (const u of ordered) this.move(u);
    for (const u of ordered) this.act(u);
    if (this.full && this.tick % 5 === 0) {
      this.emit('pos', { u: this.units.filter((u) => u.alive).map((u) => [u.id, r2(u.x), r2(u.y), r2(Math.atan2(u.fy, u.fx)), Math.max(0, Math.round(u.hp)), Math.round(u.energy)]) }, true);
    }
    this.checkEnd();
  }

  private timers(units: Unit[]) {
    const statusTick = this.tick % 10 === 0;
    for (const u of units) {
      for (const k in u.cooldowns) u.cooldowns[k] -= TICK;
      if (u.shieldLeft > 0 && (u.shieldLeft -= TICK) <= 0) u.shield = 0;
      if (u.summonLeft > 0 && (u.summonLeft -= TICK) <= 0) this.kill(u, undefined, 'expired');
      if (u.downedLeft > 0) {
        u.downedLeft -= TICK;
        if (u.downedLeft <= 0) this.die(u, undefined, 'bled out');
        continue;
      }
      if (this.flag(u, 'stun') || this.flag(u, 'sleep')) u.s.ccSeconds += TICK;
      if (u.order && this.tick > u.order.until) {
        // an order that never found its moment lapses, and its embers come back
        this.embers += u.order.cost; this.ordersLapsed++;
        this.emit('order', { kind: u.order.kind, unit: u.id, outcome: 'lapsed' });
        u.order = undefined;
      }
      if (this.tick % 20 === 0) this.hazardAt(u);
      for (const st of u.statuses) {
        st.left -= TICK;
        if (statusTick && st.tickDmg > 0 && st.tickType && u.alive) {
          const src = this.get(st.src);
          const physical = PHYSICAL.has(st.tickType);
          const mit = Math.min(0.75, physical ? this.stat(u, 'armor') / (Math.max(0, this.stat(u, 'armor')) + 50) : (u.base.resist[st.tickType] ?? 0) / 100);
          const dmg = Math.max(1, Math.round(st.tickDmg * st.stacks * (1 - mit) * (u.typeMods[st.tickType] ?? 1)));
          this.applyDamage(src, u, dmg, false, st.tickType, st.id);
        }
      }
      const before = u.statuses.length;
      u.statuses = u.statuses.filter((s) => s.left > 0);
      if (this.full && u.statuses.length !== before) this.emit('status', { unit: u.id, statuses: u.statuses.map((s) => s.id) }, true);
    }
  }

  // ----- decisions: behaviour rules (spec 06) -----

  private decide(u: Unit) {
    if (u.team === 0 && this.fleeUntil) { u.plan = { ability: u.basic, targetId: u.id, intent: 'retreat', arg: 0 }; return; }
    if (u.order) {
      const t = this.get(u.order.targetId);
      const reviveFirst = u.order.kind === 'mend' && t && t.downedLeft <= 0 && this.units.some((o) => o.team === u.team && o.alive && o.downedLeft > 0);
      if (t && t.alive && !reviveFirst) {
        // close to the ability's range and use it; approach stops as soon as the target is in reach
        u.plan = { ability: u.order.ability, targetId: t.id, intent: 'approach', arg: 0 };
        return;
      }
    }
    const taunt = this.flag(u, 'taunted');
    const taunter = taunt && this.get(taunt.src);
    for (let i = 0; i < u.rules.length; i++) {
      const r = u.rules[i];
      if (!this.condition(u, r.if)) continue;
      const ab = this.abilityFor(u, r);
      if (!ab) continue;
      let target = taunter && this.active(taunter) && !ABILITIES[ab].friendly ? taunter : this.target(u, r.on, ABILITIES[ab]);
      if (!target) continue;
      const [intent, arg] = (r.move ?? 'approach').split(':');
      u.plan = { ability: ab, targetId: target.id, intent, arg: arg ? +arg : 0 };
      if (u.ruleIdx !== i || this.full) {
        if (u.ruleIdx !== i) this.emit('rule', { unit: u.id, rule: i, text: (r.text ?? r.use).replace('{t}', target.name) });
        u.ruleIdx = i;
      }
      return;
    }
    u.plan = undefined;
  }

  private abilityFor(u: Unit, r: RuleDef): string | undefined {
    if (r.use === 'basic') return u.basic;
    if (r.use === 'ult') return u.ult && u.energy >= 100 ? u.ult : undefined;
    if (r.use === 'revive') return [...u.skills, u.ult].find((a) => a && ABILITIES[a].effects.some((e) => e.type === 'revive') && (u.cooldowns[a] ?? 0) <= 0);
    const sk = r.skill ?? u.skills[0];
    return sk && (u.cooldowns[sk] ?? 0) <= 0 ? sk : undefined;
  }

  private condition(u: Unit, cond: string): boolean {
    return cond.split('&').every((c) => {
      const [name, a, b] = c.split(':');
      const p = a !== undefined ? +a : 0, q = b !== undefined ? +b : 0;
      switch (name) {
        case 'always': return true;
        case 'energyFull': return !!u.ult && u.energy >= 100;
        case 'selfHpBelow': return u.hp / u.base.maxHp < p;
        case 'allyHpBelow': return this.alliesOf(u).some((o) => o.hp / o.base.maxHp < p);
        case 'alliesBelow': return this.alliesOf(u).filter((o) => o.hp / o.base.maxHp < p).length >= q;
        case 'allyDowned': return this.units.some((o) => o.team === u.team && o.alive && o.downedLeft > 0);
        case 'enemiesInRange': return this.enemiesOf(u).filter((o) => this.gap(u, o) <= q).length >= p;
        case 'alliesInRange': return this.alliesOf(u).filter((o) => o !== u && this.dist(u, o) <= q).length >= p;
        case 'clusterAt': { const es = this.enemiesOf(u); return es.some((e) => es.filter((o) => this.dist(e, o) <= q).length >= p); }
        case 'summonsBelow': return this.units.filter((o) => o.alive && o.summonerId === u.id).length < p;
        default: throw new Error(`unknown condition ${name}`);
      }
    });
  }

  private target(u: Unit, token: string, ab: AbilityDef): Unit | undefined {
    if (token === 'self' || (ab.delivery === 'self' && ab.affects !== 'enemies')) return u;
    const es = this.enemiesOf(u);
    const nearest = (list: Unit[], from: { x: number; y: number } = u) => list.reduce<Unit | undefined>((a, b) => (!a || this.dist(from, b) < this.dist(from, a) ? b : a), undefined);
    if (u.team === 0 && this.focusId && this.tick < this.focusUntil && !ab.friendly && !token.startsWith('ally') && token !== 'downedAlly'
        && (u.roles.tank ?? 0) < 2 && (u.roles.heal ?? 0) < 2) {
      const f = this.get(this.focusId);
      // ranged heroes switch at once; melee heroes only if the target is close, so nobody dives past the front line
      if (f && this.active(f) && (ab.range >= 2 || this.dist(u, f) <= 3)) return f;
    }
    switch (token) {
      case 'highestThreat': {
        let best: Unit | undefined, bt = -1;
        for (const e of es) { const v = u.threat.get(e.id) ?? 0; if (v > bt || (v === bt && best && this.dist(u, e) < this.dist(u, best))) { bt = v; best = e; } }
        return best;
      }
      case 'nearest': return nearest(es);
      case 'lowestHp': return es.reduce<Unit | undefined>((a, b) => (!a || b.hp < a.hp ? b : a), undefined);
      case 'lowestHpPct': return es.reduce<Unit | undefined>((a, b) => (!a || b.hp / b.base.maxHp < a.hp / a.base.maxHp ? b : a), undefined);
      case 'backline': { const back = es.filter((e) => e.backliner); return nearest(back.length ? back : es); }
      case 'casterFirst': { const c = es.filter((e) => e.backliner && !e.minion); return nearest(c.length ? c : es); }
      case 'mostClustered': {
        let best: Unit | undefined, bc = -1;
        for (const e of es) { const c = es.filter((o) => this.dist(e, o) <= 1.5).length; if (c > bc || (c === bc && best && this.dist(u, e) < this.dist(u, best))) { bc = c; best = e; } }
        return best;
      }
      case 'nearestToAllies': {
        const prot = this.alliesOf(u).filter((a) => a.backliner && a !== u);
        if (!prot.length) return nearest(es);
        let best: Unit | undefined, bd = Infinity;
        for (const e of es) for (const p of prot) { const d = this.dist(e, p); if (d < bd) { bd = d; best = e; } }
        return best;
      }
      case 'allyLowestHpPct': return this.alliesOf(u).filter((a) => a.hp < a.base.maxHp).reduce<Unit | undefined>((a, b) => (!a || b.hp / b.base.maxHp < a.hp / a.base.maxHp ? b : a), undefined);
      case 'downedAlly': return this.units.find((o) => o.team === u.team && o.alive && o.downedLeft > 0);
      default: throw new Error(`unknown target ${token}`);
    }
  }

  // ----- movement (spec 05) -----

  /** Flow fields are cached by goal cell, so everyone chasing the same spot shares one, and kept for 0.5 s. */
  private flow(gx: number, gy: number): Float32Array {
    const nav = this.field.nav;
    const cell = Math.floor(gy * 2) * nav.w + Math.floor(gx * 2);
    const key = String(cell);
    const f = this.fields.get(key);
    if (f && this.tick - f.at < 10) return f.dist;
    const dist = flowField(nav, [{ x: gx, y: gy }], 1);
    this.fields.set(key, { at: this.tick, dist });
    return dist;
  }

  private steerTo(u: Unit, gx: number, gy: number): [number, number] {
    const nav = this.field.nav;
    if (lineOfSight(nav, u.x, u.y, gx, gy)) {
      const d = Math.hypot(gx - u.x, gy - u.y);
      return d < 1e-6 ? [0, 0] : [(gx - u.x) / d, (gy - u.y) / d];
    }
    return flowDir(nav, this.flow(gx, gy), u.x, u.y);
  }

  private move(u: Unit) {
    u.vx = 0; u.vy = 0;
    if (!this.canAct(u) || u.windup || this.flag(u, 'root')) return;
    const plan = u.plan;
    const t = plan && this.get(plan.targetId);
    let dx = 0, dy = 0;
    if (u.rare && this.tick >= u.fleeAt) {
      // a Rare makes a run for the far edge and vanishes if it gets there
      const edge = this.field.w - 0.6;
      if (u.x >= edge - 0.3) { u.alive = false; this.escaped.push(u.id); this.emit('escaped', { unit: u.id }); this.refreshTeams(); return; }
      [dx, dy] = this.steerTo(u, edge, u.y);
    } else if (plan && plan.intent === 'retreat') {
      [dx, dy] = this.steerTo(u, 0.6, Math.min(this.field.h - 1.5, Math.max(1.5, u.y)));
    } else if (plan && t) {
      const ab = ABILITIES[plan.ability];
      const reach = (ab.delivery === 'self' && ab.affects !== 'enemies') ? Infinity : ab.range * 0.9;
      const inReach = t === u || this.gap(u, t) <= reach;
      const blocked = t !== u && (ab.delivery === 'projectile' || ab.delivery === 'telegraph') && !lineOfSight(this.field.nav, u.x, u.y, t.x, t.y);
      if (plan.intent === 'kite') {
        const threats = this.hash.query(u.x, u.y, plan.arg).filter((o) => o.team !== u.team && this.active(o));
        if (threats.length) {
          for (const o of threats) { const d = Math.max(0.1, this.dist(u, o)); dx += (u.x - o.x) / d / d; dy += (u.y - o.y) / d / d; }
        } else if (!inReach || blocked) [dx, dy] = this.steerTo(u, t.x, t.y);
      } else if (plan.intent === 'regroup') {
        const allies = this.alliesOf(u).filter((a) => a !== u);
        if (allies.length) {
          const cx = allies.reduce((s, a) => s + a.x, 0) / allies.length, cy = allies.reduce((s, a) => s + a.y, 0) / allies.length;
          if (Math.hypot(cx - u.x, cy - u.y) > 2.5) [dx, dy] = this.steerTo(u, cx, cy);
          else if (!inReach || blocked) [dx, dy] = this.steerTo(u, t.x, t.y);
        } else if (!inReach || blocked) [dx, dy] = this.steerTo(u, t.x, t.y);
      } else if (plan.intent === 'flank' && t !== u && (!inReach || blocked)) {
        // aim for the far side of the target, so flankers go around the front line
        const side = t.team === 0 ? -0.9 : 0.9;
        const gx = t.x + side, gy = t.y;
        const goal = walkableAt(this.field.nav, gx, gy) && this.dist(u, t) > 1.6 ? [gx, gy] : [t.x, t.y];
        [dx, dy] = this.steerTo(u, goal[0], goal[1]);
      } else if (plan.intent !== 'hold' && t !== u && (!inReach || blocked)) {
        [dx, dy] = this.steerTo(u, t.x, t.y);
      }
    }
    // separation (spatial hash, no O(n²))
    for (const o of this.hash.query(u.x, u.y, u.base.radius + 0.45)) {
      if (o === u || !o.alive || o.downedLeft > 0) continue;
      const d = this.dist(u, o), min = u.base.radius + o.base.radius + 0.05;
      if (d < min && d > 1e-6) { const k = ((min - d) / min) * 1.4; dx += ((u.x - o.x) / d) * k; dy += ((u.y - o.y) / d) * k; }
      else if (d <= 1e-6) { dx += u.spawnIndex % 2 ? 0.3 : -0.3; dy += u.spawnIndex % 3 ? 0.2 : -0.2; }
    }
    const l = Math.hypot(dx, dy);
    if (l < 1e-3) { u.stuckT = 0; return; }
    const sp = this.stat(u, 'move') * Math.min(1, l);
    u.vx = (dx / l) * sp; u.vy = (dy / l) * sp;
    const nx = u.x + u.vx * TICK, ny = u.y + u.vy * TICK;
    const nav = this.field.nav;
    if (walkableAt(nav, nx + Math.sign(u.vx) * u.base.radius * 0.6, u.y)) u.x = nx;
    if (walkableAt(nav, u.x, ny + Math.sign(u.vy) * u.base.radius * 0.6)) u.y = ny;
    if (Math.hypot(u.vx, u.vy) > 0.05) { u.fx = u.vx; u.fy = u.vy; }
    // stuck detection: wanting to move but barely moving for a second
    if (this.tick % TICKS_PER_S === 0) {
      const moved = Math.hypot(u.x - u.lastX, u.y - u.lastY);
      if (moved < 0.1 && plan && plan.intent !== 'hold') { this.stuckSeconds += 1; u.stuckT += 1; }
      else u.stuckT = 0;
      u.lastX = u.x; u.lastY = u.y;
    }
  }

  // ----- actions -----

  private act(u: Unit) {
    if (!u.alive) return;
    if (u.windup) {
      if (!this.canAct(u)) { u.windup = undefined; return; }
      u.windup.left -= TICK;
      if (u.windup.left <= 0) { const w = u.windup; u.windup = undefined; this.resolve(u, w.ability, w.targetId, w.ax, w.ay); }
      return;
    }
    const plan = u.plan;
    if (!plan || !this.canAct(u)) return;
    const ab = ABILITIES[plan.ability];
    if ((u.cooldowns[ab.id] ?? 0) > 0) return;
    if (ab.kind === 'ult' && u.energy < 100) { u.plan = undefined; return; }
    const t = this.get(plan.targetId);
    if (!t || (!t.alive) || (t.downedLeft > 0 && !ab.effects.some((e) => e.type === 'revive'))) { u.plan = undefined; return; }
    const self = t === u || (ab.delivery === 'self' && ab.affects !== 'enemies');
    if (!self) {
      if (this.gap(u, t) > ab.range) return;
      if ((ab.delivery === 'projectile' || ab.delivery === 'telegraph') && !lineOfSight(this.field.nav, u.x, u.y, t.x, t.y)) return;
    }
    // start the wind-up
    if (u.order && u.order.ability === ab.id && u.order.targetId === t.id) {
      u.boostNext = u.order.boost;
      this.emit('order', { kind: u.order.kind, unit: u.id, target: t.id, outcome: 'obeyed' });
      u.order = undefined;
    }
    u.cooldowns[ab.id] = (ab.cooldown ?? 0) / this.stat(u, 'atkSpeed');
    if (ab.kind === 'ult') { u.energy = 0; u.s.ults++; this.emit('ult', { unit: u.id, ability: ab.id, cine: ab.cine ?? 3 }); }
    if (ab.kind === 'skill') this.gainEnergy(u, 15);
    if (t !== u) { u.fx = t.x - u.x; u.fy = t.y - u.y; }
    u.windup = { ability: ab.id, targetId: t.id, ax: t.x, ay: t.y, left: ab.windup };
    this.emit('windup', { unit: u.id, ability: ab.id, target: t.id, dur: ab.windup });
    if (ab.windup <= 0) { u.windup = undefined; this.resolve(u, ab.id, t.id, t.x, t.y); }
  }

  private resolve(u: Unit, abilityId: string, targetId: string, ax: number, ay: number) {
    this.resolveInner(u, abilityId, targetId, ax, ay);
    u.boostNext = 1;
  }

  private resolveInner(u: Unit, abilityId: string, targetId: string, ax: number, ay: number) {
    const ab = ABILITIES[abilityId];
    const t = this.get(targetId);
    if (!u.alive) return;
    if (ab.delivery === 'projectile') {
      const tx = t && t.alive ? t.x : ax, ty = t && t.alive ? t.y : ay;
      const d = Math.hypot(tx - u.x, ty - u.y);
      const speed = ab.projectile?.speed ?? 8;
      this.projectiles.push({ owner: u, ab, x: u.x, y: u.y, tx, ty, targetId, left: d / speed });
      this.emit('proj', { unit: u.id, ability: ab.id, to: [r2(tx), r2(ty)], dur: r2(d / speed) });
      return;
    }
    if (ab.delivery === 'telegraph') {
      const tx = t && t.alive ? t.x : ax, ty = t && t.alive ? t.y : ay;
      const delay = ab.telegraph?.delay ?? 0.6;
      this.telegraphs.push({ owner: u, ab, x: tx, y: ty, left: delay });
      this.emit('telegraph', { unit: u.id, ability: ab.id, x: r2(tx), y: r2(ty), r: ab.area?.r ?? 1, dur: delay });
      return;
    }
    if (ab.delivery === 'self') {
      this.applyAbility(u, ab, this.affected(u, ab, u.x, u.y, t), t);
      return;
    }
    // melee (also friendly touch abilities like Mend)
    if (!t || !t.alive || this.gap(u, t) > ab.range + 0.4) {
      if (t && !ab.friendly) { u.s.misses++; this.emit('miss', { src: u.id, dst: targetId, ability: ab.id, reason: 'moved' }); }
      return;
    }
    if (ab.dodgeable && !ab.area && !ab.friendly && !this.hitRoll(u, t, ab)) return;
    this.applyAbility(u, ab, ab.area ? this.affected(u, ab, u.x, u.y, t) : [t], t);
  }

  private hitRoll(u: Unit, t: Unit, ab: AbilityDef): boolean {
    const chance = Math.min(1, Math.max(0.1, u.base.accuracy - this.stat(t, 'evasion')));
    if (this.combat.next() < chance) return true;
    u.s.misses++;
    this.emit('miss', { src: u.id, dst: t.id, ability: ab.id, reason: 'dodge' });
    return false;
  }

  private flying() {
    for (const p of this.projectiles) {
      p.left -= TICK;
      if (p.left > 0) continue;
      const { owner, ab } = p;
      if (ab.area) {
        this.applyAbility(owner, ab, this.affected(owner, ab, p.tx, p.ty, undefined), undefined);
      } else {
        const t = this.get(p.targetId);
        if (t && t.alive && (t.downedLeft <= 0 || ab.friendly) && this.dist(t, { x: p.tx, y: p.ty }) <= 0.6 + t.base.radius) {
          if (!ab.dodgeable || ab.friendly || this.hitRoll(owner, t, ab)) this.applyAbility(owner, ab, [t], t);
        } else if (!ab.friendly) {
          owner.s.misses++;
          this.emit('miss', { src: owner.id, dst: p.targetId, ability: ab.id, reason: 'moved' });
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.left > 0);
    for (const tg of this.telegraphs) {
      tg.left -= TICK;
      if (tg.left <= 0) this.applyAbility(tg.owner, tg.ab, this.affected(tg.owner, tg.ab, tg.x, tg.y, undefined), undefined);
    }
    this.telegraphs = this.telegraphs.filter((t) => t.left > 0);
  }

  /** Units inside an ability's area. */
  private affected(u: Unit, ab: AbilityDef, cx: number, cy: number, t: Unit | undefined): Unit[] {
    if (ab.affects === 'self') return [u];
    if (ab.affects === 'target') return t ? [t] : [];
    const team = ab.affects === 'allies' ? u.team : 1 - u.team;
    const area = ab.area ?? { shape: 'circle', r: 1, at: 'self' };
    const ox = area.at === 'self' ? u.x : cx, oy = area.at === 'self' ? u.y : cy;
    const out: Unit[] = [];
    for (const o of this.hash.query(ox, oy, area.r + 0.6)) {
      if (o.team !== team || !o.alive || (o.downedLeft > 0 && team !== u.team)) continue;
      if (o.downedLeft > 0) continue;
      if (this.dist(o, { x: ox, y: oy }) > area.r + o.base.radius) continue;
      if (area.shape === 'cone' && t) {
        const ax = t.x - u.x, ay = t.y - u.y, bx = o.x - u.x, by = o.y - u.y;
        const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
        if (cos < Math.cos(((area.angle ?? 90) / 2) * (Math.PI / 180))) continue;
      }
      out.push(o);
    }
    return out;
  }

  // ----- effects (spec 03) -----

  private applyAbility(u: Unit, ab: AbilityDef, targets: Unit[], primary: Unit | undefined) {
    for (const e of ab.effects) {
      if (e.type === 'dash' || e.type === 'summon' || e.type === 'explode') { this.applyEffect(u, ab, e, primary ?? u); continue; }
      for (const t of targets) if (t.alive) this.applyEffect(u, ab, e, t);
    }
  }

  private applyEffect(u: Unit, ab: AbilityDef, e: Effect, t: Unit) {
    switch (e.type) {
      case 'damage': {
        if (e.ifTargetHpBelow !== undefined && t.hp / t.base.maxHp >= e.ifTargetHpBelow) return;
        let bonus = this.mult(u, 'damageDealt') * this.mult(t, 'damageTaken') * (e.mult ?? 1);
        if (e.vsTag) for (const tag of t.tags) bonus *= e.vsTag[tag] ?? 1;
        if (ab.behindMult) {
          const fl = Math.hypot(t.fx, t.fy) || 1;
          const dot = (t.fx / fl) * (u.x - t.x) + (t.fy / fl) * (u.y - t.y);
          if (dot < -0.2) bonus *= ab.behindMult;
        }
        const atk = { ...u.base, power: this.stat(u, 'power'), spell: this.stat(u, 'spell') };
        const def = { ...t.base, armor: this.stat(t, 'armor') };
        const roll = rollDamage(this.combat, e.dmgType, e.base, e.scale, atk, def, bonus, t.typeMods[e.dmgType] ?? 1);
        if (roll.crit) u.s.crits++;
        u.s.hits++;
        this.applyDamage(u, t, roll.dmg, roll.crit, e.dmgType, ab.id);
        if (ab.kind === 'basic') this.gainEnergy(u, 10);
        if (ab.interrupts && t.alive && t.windup) {
          this.emit('interrupted', { unit: t.id, by: u.id, ability: t.windup.ability });
          t.windup = undefined;
        }
        return;
      }
      case 'heal': {
        if (t.downedLeft > 0) return;
        const amt = (e.base + e.scale * this.stat(u, 'spell')) * u.base.healPower * u.boostNext * this.stat(t, 'healTaken') * (0.95 + 0.1 * this.combat.next());
        const real = Math.min(t.base.maxHp - t.hp, amt);
        t.hp += real;
        u.s.healed += Math.round(real);
        u.s.overheal += Math.round(amt - real);
        this.emit('heal', { src: u.id, dst: t.id, ability: ab.id, amount: Math.round(real) });
        return;
      }
      case 'shield':
        t.shield = Math.max(t.shield, e.base + e.scale * this.stat(u, 'spell'));
        t.shieldLeft = e.dur;
        return;
      case 'status':
        if (e.chance !== undefined && this.combat.next() >= e.chance) return;
        this.addStatus(t, e.status, e.dur, u, e.stacks ?? 1);
        return;
      case 'taunt':
        this.addStatus(t, 'taunted', e.dur, u, 1);
        return;
      case 'cleanse':
        t.statuses = t.statuses.filter((s) => STATUSES[s.id].kind === 'buff');
        return;
      case 'knockback': {
        const d = this.dist(u, t) || 1;
        const dx = (t.x - u.x) / d, dy = (t.y - u.y) / d;
        for (let i = 0; i < 4; i++) {
          const nx = t.x + (dx * e.dist) / 4, ny = t.y + (dy * e.dist) / 4;
          if (!walkableAt(this.field.nav, nx, ny)) break;
          t.x = nx; t.y = ny;
        }
        return;
      }
      case 'dash': {
        const d = this.dist(u, t) || 1;
        const off = t.base.radius + u.base.radius + 0.05;
        const sign = e.to === 'behind' ? 1 : -1;
        const nx = t.x + ((t.x - u.x) / d) * off * sign, ny = t.y + ((t.y - u.y) / d) * off * sign;
        if (walkableAt(this.field.nav, nx, ny)) { this.emit('dash', { unit: u.id, from: [r2(u.x), r2(u.y)], to: [r2(nx), r2(ny)] }); u.x = nx; u.y = ny; }
        return;
      }
      case 'summon': {
        const def = e.enemy === '@minion' ? SPECIES[ENEMIES[u.defId]?.species ?? 'skeleton'].minion : e.enemy;
        const alive = this.units.filter((o) => o.alive && o.summonerId === u.id).length;
        const n = Math.min(e.count, Math.max(0, e.max - alive));
        for (let i = 0; i < n; i++) {
          const m = this.addMonster(def, u.level, 'minion', u.team, u, this.ai);
          this.byId.delete(m.id);
          m.id = `${u.id}>${def}${++this.summonSeq}`;
          this.byId.set(m.id, m);
          m.kind = 'summon';
          if (e.dur) m.summonLeft = e.dur;
          this.emit('summon', { owner: u.id, unit: m.id, def });
          this.unitInfo(m);
          this.teamCache[m.team].push(m);
        }
        return;
      }
      case 'energy':
        if (t !== u) this.gainEnergy(t, e.amount);
        return;
      case 'revive':
        if (t.downedLeft > 0) {
          t.downedLeft = 0;
          t.hp = Math.max(1, Math.round(t.base.maxHp * e.hpPct));
          t.statuses = t.statuses.filter((s) => s.id !== 'downed');
          this.emit('revive', { src: u.id, dst: t.id });
        }
        return;
      case 'explode':
        this.die(u, undefined, 'exploded');
        return;
    }
  }

  private addStatus(t: Unit, id: string, dur: number, src: Unit, stacks: number) {
    const def = STATUSES[id];
    if (def.flags?.some((f) => f === 'stun' || f === 'sleep' || f === 'root')) {
      // diminishing returns: full, half, quarter, then immune for 6 s
      if (this.tick < t.cc.until) t.cc.n++; else t.cc.n = 0;
      if (t.cc.n >= 3) return;
      dur *= [1, 0.5, 0.25][t.cc.n];
      t.cc.until = this.tick + 6 * TICKS_PER_S;
    }
    const tickDmg = def.tick?.ofCasterSpell ? def.tick.ofCasterSpell * Math.max(this.stat(src, 'spell'), this.stat(src, 'power')) : 0;
    const cur = t.statuses.find((s) => s.id === id);
    if (cur) {
      cur.left = Math.max(cur.left, dur);
      if (def.stacking === 'stack') cur.stacks = Math.min(def.maxStacks ?? 5, cur.stacks + stacks);
      cur.tickDmg = Math.max(cur.tickDmg, tickDmg);
      cur.src = src.id;
    } else {
      t.statuses.push({ id, left: dur, stacks, src: src.id, tickDmg, tickType: def.tick?.dmgType });
    }
    if (def.flags?.includes('stun') || def.flags?.includes('sleep')) t.windup = undefined;
    this.emit('status', { unit: t.id, add: id, src: src.id });
  }

  private gainEnergy(u: Unit, amount: number) {
    if (!u.ult) return;
    u.energy = Math.min(100, u.energy + amount * u.base.energyGain);
  }

  private applyDamage(src: Unit | undefined, t: Unit, dmg: number, crit: boolean, type: DamageType, ability: string) {
    if (!t.alive) return;
    if (t.downedLeft > 0) {
      // Hardcore: hitting a Downed hero shortens their bleed-out.
      t.downedLeft -= 1;
      this.emit('hit', { src: src?.id, dst: t.id, ability, dmg: 0, type, crit, downed: true });
      if (t.downedLeft <= 0) this.die(t, src, 'finished');
      return;
    }
    let left = dmg;
    if (t.shield > 0) { const a = Math.min(t.shield, left); t.shield -= a; left -= a; }
    const before = t.hp;
    t.hp -= left;
    const real = Math.min(before, left);
    if (src) { src.s.dealt += real; t.threat.set(src.id, (t.threat.get(src.id) ?? 0) + real); }
    t.s.taken += real;
    if (t.statuses.some((s) => STATUSES[s.id].breakOnDamage)) t.statuses = t.statuses.filter((s) => !STATUSES[s.id].breakOnDamage);
    const lostPct = real / t.base.maxHp;
    this.gainEnergy(t, 5 + Math.min(5, Math.floor(lostPct / 0.05)));
    this.emit('hit', { src: src?.id, dst: t.id, ability, dmg, type, crit });
    if (t.hp <= 0) this.kill(t, src, ability);
  }

  /** Reaching 0 HP: heroes are Downed (Hardcore bleed-out), everything else dies. */
  private kill(t: Unit, src: Unit | undefined, cause: string) {
    if (!t.alive) return;
    if (t.kind === 'hero' && t.downedLeft <= 0 && cause !== 'expired') {
      t.hp = 0;
      t.downedLeft = 6;
      t.windup = undefined;
      t.plan = undefined;
      t.statuses = [];
      if (src) src.s.kills++;
      this.emit('downed', { unit: t.id, by: src?.id, ability: cause, cine: 2 });
      this.refreshTeams();
      for (const a of this.alliesOf(t)) this.gainEnergy(a, 10);
      return;
    }
    this.die(t, src, cause);
  }

  private die(t: Unit, src: Unit | undefined, cause: string) {
    if (!t.alive) return;
    t.alive = false;
    t.hp = 0;
    t.downedLeft = 0;
    t.windup = undefined;
    if (src && t.kind !== 'hero') src.s.kills++;
    this.refreshTeams();
    if (this.setup.leader && t.id === this.setup.leader.heroId) {
      this.emit('torch', { holder: t.id, state: 'dropped' });
      if (this.setup.leader.rank !== 'master') for (const a of this.teamCache[0]) this.addStatus(a, 'shaken', 5, a, 1);
    }
    const lastEnemy = t.team === 1 && !this.units.some((o) => o.team === 1 && o.alive);
    this.emit('death', { unit: t.id, by: src?.id, cause, cine: t.kind === 'hero' ? 3 : lastEnemy ? 3 : 0 });
  }

  private checkEnd() {
    const enemies = this.units.some((u) => u.team === 1 && u.alive);
    const heroesUp = this.units.some((u) => u.kind === 'hero' && this.active(u));
    if (this.fledOk) this.result = 'fled';
    else if (!enemies) this.result = 'victory';
    else if (!heroesUp) this.result = 'defeat';
    else if (this.tick >= this.maxTicks) this.result = 'timeout';
    if (!this.result) return;
    if (this.result !== 'victory') {
      for (const u of this.units) if (u.kind === 'hero' && u.alive && u.downedLeft > 0) this.die(u, undefined, 'left behind');
    }
    this.emit('end', { result: this.result });
  }

  // ----- hazards -----

  private hazardAt(u: Unit) {
    if (!u.alive || u.downedLeft > 0) return;
    const c = Math.floor(u.y) * this.field.w + Math.floor(u.x);
    for (const hz of this.field.hazards) {
      if (!hz.cells.includes(c)) continue;
      if (hz.kind === 'spikes') this.addStatus(u, 'bleed', 2, u, 1);
      if (hz.kind === 'spore_vent') this.addStatus(u, 'poison', 2, u, 1);
    }
  }

  // ----- Leader combat calls (spec 07) -----

  private call(name: string, cd: number): boolean {
    if ((this.callCd[name] ?? 0) > this.tick) return false;
    this.callCd[name] = this.tick + cd * TICKS_PER_S;
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    return true;
  }

  private leaderCalls() {
    const L = this.setup.leader;
    if (!L) return;
    const leader = this.get(L.heroId);
    if (!leader || !this.active(leader) || this.fleeUntil) return;
    const rank = ['novice', 'seasoned', 'veteran', 'master'].indexOf(L.rank);
    const party = this.teamCache[0], foes = this.teamCache[1];
    if (!party.length || !foes.length) return;
    const see = (v: number) => Math.max(0, Math.min(1, v + L.noise * (2 * this.leaderRng.next() - 1)));
    const hp = see(party.reduce((s, u) => s + u.hp / u.base.maxHp, 0) / party.length);
    const shout = (name: string, status: string, dur: number) => {
      for (const a of party) this.addStatus(a, status, dur, leader, 1);
      this.emit('call', { leader: leader.id, call: name });
    };
    // Charge! / Hold! (every rank)
    if (L.temperament === 'rage' || party.length >= foes.length) { if (this.call('charge', 20)) shout('charge', 'haste', 5); }
    else if (foes.length > party.length * 1.5) { if (this.call('hold', 20)) shout('hold', 'ward', 5); }
    if (rank >= 1) {
      // Focus that one! on a Rare, captain, Mender or Summoner
      const prey = foes.filter((e) => e.rare || ['mender', 'summoner'].includes(ENEMIES[e.defId]?.archetype ?? '') || (!e.minion && foes.some((m) => m.minion)));
      if (prey.length && this.call('focus', 12)) {
        const t = prey.reduce((a, b) => (b.hp < a.hp ? b : a));
        this.focusId = t.id; this.focusUntil = this.tick + 6 * TICKS_PER_S;
        this.emit('call', { leader: leader.id, call: 'focus', target: t.id });
      }
      // Fall back! when the party is breaking and the enemy is still strong
      const enemyLeft = foes.reduce((s, e) => s + e.hp, 0) / Math.max(1, this.units.filter((e) => e.team === 1).reduce((s, e) => s + e.base.maxHp, 0));
      if (hp < 0.25 && enemyLeft > 0.5 && !this.fallBackUsed && this.call('fallback', 9999)) this.startFallBack('leader');
    }
    if (rank >= 2 && party.filter((u) => u.hp / u.base.maxHp < 0.4).length >= 2 && this.call('rally', 15)) shout('rally', 'might', 6);
  }

  private startFallBack(by: 'leader' | 'player') {
    this.fallBackUsed = true;
    this.fleeUntil = this.tick + 3 * TICKS_PER_S;
    this.emit('fallback', { by });
  }

  /** After 3 s of disengaging: success if 75% of the standing party reached the entry edge. */
  private resolveFallBack() {
    const up = this.teamCache[0].filter((u) => u.kind === 'hero');
    const safe = up.filter((u) => u.x <= 2.2).length;
    this.fleeUntil = 0;
    if (up.length && safe / up.length >= 0.75) { this.fledOk = true; this.emit('fallback', { outcome: 'escaped' }); }
    else this.emit('fallback', { outcome: 'caught' });
  }

  // ----- Player Orders (DESIGN §4) -----

  /** Issue a Player Order. Returns why it failed, or 'ok'. */
  order(kind: OrderKind, targetId?: string): string {
    const o = ORDERS[kind];
    if (this.result) return 'over';
    if (this.embers < o.cost) return 'no embers';
    if (this.tick < this.globalOrderCd || (this.orderCd[kind] ?? 0) > this.tick) return 'cooldown';
    const party = this.teamCache[0], foes = this.teamCache[1];
    const target = targetId ? this.get(targetId) : undefined;
    const nearestTo = (list: Unit[], p: { x: number; y: number }) => list.reduce<Unit | undefined>((a, b) => (!a || this.dist(p, b) < this.dist(p, a) ? b : a), undefined);
    const queue = (u: Unit, ability: string, t: Unit, boost = 1) => { u.order = { kind, ability, targetId: t.id, until: this.tick + 2 * TICKS_PER_S, boost, cost: o.cost }; };
    switch (kind) {
      case 'mend': {
        if (!target || target.team !== 0 || !target.alive) return 'bad target';
        const healers = party.filter((u) => u.kind === 'hero' && u !== target && (u.roles.heal ?? 0) >= 2);
        const downed = target.downedLeft > 0;
        // a usable heal or revive: skills off cooldown, or the ultimate only when it's charged
        const usable = (h: Unit, a: string | undefined) => !!a && ABILITIES[a].friendly && ABILITIES[a].effects.some((e) => e.type === (downed ? 'revive' : 'heal'))
          && (h.cooldowns[a] ?? 0) <= 0.5 && (ABILITIES[a].kind !== 'ult' || h.energy >= 100);
        const pick = healers.map((h) => ({ h, ab: [...h.skills, h.ult].find((a) => usable(h, a)) }))
          .filter((x) => x.ab).sort((a, b) => this.dist(a.h, target) - this.dist(b.h, target))[0];
        if (!pick) return 'no healer ready';
        queue(pick.h, pick.ab!, target, 1.5);
        break;
      }
      case 'focus':
        if (!target || target.team !== 1 || !this.active(target)) return 'bad target';
        this.focusId = target.id; this.focusUntil = this.tick + 6 * TICKS_PER_S;
        break;
      case 'guard': {
        if (!target || target.team !== 0) return 'bad target';
        const tank = party.filter((u) => u !== target && (u.roles.tank ?? 0) >= 2).sort((a, b) => this.dist(a, target) - this.dist(b, target))[0];
        if (!tank) return 'no tank';
        this.addStatus(target, 'ward', 5, tank, 1);
        const threat = nearestTo(foes, target);
        if (threat) queue(tank, tank.basic, threat);
        break;
      }
      case 'interrupt': {
        if (!target || target.team !== 1 || !target.windup) return 'nothing to interrupt';
        // only heroes already within reach: an interrupt never pulls the front line across the field
        const pick = party.map((h) => ({ h, ab: [h.basic, ...h.skills].find((a) => ABILITIES[a].interrupts && (h.cooldowns[a] ?? 0) <= 0.5 && this.gap(h, target) <= ABILITIES[a].range + 1) }))
          .filter((x) => x.ab).sort((a, b) => this.dist(a.h, target) - this.dist(b.h, target))[0];
        if (!pick) return 'no interrupt ready';
        queue(pick.h, pick.ab!, target);
        break;
      }
      case 'unleash': {
        const hero = target && target.team === 0 ? target : party.filter((u) => u.ult && u.energy >= 80).sort((a, b) => b.energy - a.energy)[0];
        if (!hero || !hero.ult || hero.energy < 80) return 'not charged';
        hero.energy = 100;
        const ab = ABILITIES[hero.ult];
        const aim = ab.delivery === 'self' && ab.affects !== 'enemies' ? hero : this.target(hero, 'mostClustered', ab) ?? nearestTo(foes, hero);
        if (!aim) return 'no target';
        queue(hero, hero.ult, aim);
        break;
      }
      case 'hold': case 'charge':
        for (const a of party) this.addStatus(a, kind === 'hold' ? 'ward' : 'haste', 5, a, 1);
        break;
      case 'fallback':
        if (this.fallBackUsed) return 'already used';
        this.startFallBack('player');
        break;
    }
    this.embers -= o.cost;
    this.orderCd[kind] = this.tick + o.cooldown * TICKS_PER_S;
    this.globalOrderCd = this.tick + 2 * TICKS_PER_S;
    this.ordersIssued[kind] = (this.ordersIssued[kind] ?? 0) + 1;
    this.emit('order', { kind, target: targetId, outcome: 'issued' });
    return 'ok';
  }

  /** Headless order policies (spec 09 §5b): a sensible "good" player and a "spam" player. */
  private policyOrders() {
    const policy = this.setup.orderPolicy ?? 'none';
    if (policy === 'none' || this.embers <= 0) return;
    const party = this.teamCache[0], foes = this.teamCache[1];
    if (policy === 'spam') {
      const kinds: OrderKind[] = ['mend', 'focus', 'guard', 'interrupt', 'unleash', 'hold', 'charge'];
      const k = kinds[this.policyRng.int(kinds.length)];
      const pool = k === 'focus' || k === 'interrupt' ? foes : party;
      if (pool.length) this.order(k, pool[this.policyRng.int(pool.length)].id);
      return;
    }
    const downed = this.units.find((u) => u.kind === 'hero' && u.alive && u.downedLeft > 0);
    if (GOOD_POLICY.mend && downed && this.order('mend', downed.id) === 'ok') return;
    const hurt = party.filter((u) => u.kind === 'hero' && u.hp / u.base.maxHp < 0.3).sort((a, b) => a.hp / a.base.maxHp - b.hp / b.base.maxHp)[0];
    if (GOOD_POLICY.mend && hurt && this.order('mend', hurt.id) === 'ok') return;
    const caster = foes.find((e) => e.windup && ABILITIES[e.windup.ability].windup >= 0.4 && (e.base.maxHp > 300 || !e.minion));
    if (GOOD_POLICY.interrupt && caster && this.order('interrupt', caster.id) === 'ok') return;
    const prey = foes.find((e) => e.rare) ?? foes.find((e) => !e.minion && foes.some((m) => m.minion)) ?? foes.find((e) => ['mender', 'summoner'].includes(ENEMIES[e.defId]?.archetype ?? ''));
    if (GOOD_POLICY.focus && prey && this.focusId !== prey.id && this.order('focus', prey.id) === 'ok') return;
    // brace when outnumbered and hurting; that's when a party-wide ward pays for its embers
    const partyHp = party.reduce((s2, u) => s2 + u.hp / u.base.maxHp, 0) / Math.max(1, party.length);
    if (GOOD_POLICY.hold && foes.length > party.length && partyHp < 0.6 && this.order('hold') === 'ok') return;
    const charged = party.find((u) => u.ult && u.energy >= 80 && u.energy < 100);
    if (GOOD_POLICY.unleash && charged && foes.length >= 3 && this.order('unleash', charged.id) === 'ok') return;
  }

  private finish(): FightResult {
    const heroes = this.units.filter((u) => u.kind === 'hero');
    return {
      result: this.result!,
      duration: r2(this.tick * TICK),
      events: this.events,
      units: this.units.map((u) => ({
        id: u.id, name: u.name, team: u.team, kind: u.kind, defId: u.defId, alive: u.alive, downed: u.downedLeft > 0,
        hp: Math.max(0, Math.round(u.hp)), maxHp: u.base.maxHp, energy: Math.round(u.energy), ...u.s,
      })),
      carried: heroes.filter((u) => u.alive && u.downedLeft > 0).map((u) => u.id),
      died: heroes.filter((u) => !u.alive).map((u) => u.id),
      hash: this.runningHash,
      stuckSeconds: this.stuckSeconds,
      peakUnits: this.peakUnits,
      embersLeft: this.embers,
      orders: { issued: this.ordersIssued, lapsed: this.ordersLapsed },
      calls: this.calls,
      escaped: this.escaped,
      field: { w: this.field.w, h: this.field.h, attempt: this.field.attempt, fallback: this.field.fallback, cover: this.field.cover.length, hazards: this.field.hazards.length },
    };
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function runFight(setup: FightSetup): FightResult {
  return new Fight(setup).run();
}
