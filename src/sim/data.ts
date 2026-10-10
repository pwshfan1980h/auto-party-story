// Typed access to data/*.json. Every balanceable number lives in those files.
import abilitiesJson from '../../data/abilities.json';
import biomesJson from '../../data/biomes.json';
import classesJson from '../../data/classes.json';
import monstersJson from '../../data/monsters.json';
import racesJson from '../../data/races.json';
import rulesJson from '../../data/rules.json';
import statusesJson from '../../data/statuses.json';
import tiersJson from '../../data/tiers.json';
import leadershipJson from '../../data/leadership.json';
import progressionJson from '../../data/progression.json';
import baselinesJson from '../../data/leader-baselines.json';
import delveJson from '../../data/delve.json';
import ordersJson from '../../data/orders.json';
import gearJson from '../../data/gear.json';
import type { AbilityDef, Attrs, Role, RuleDef, StatusDef, Stats } from './types';

type StatBlock = Partial<Pick<Stats, 'maxHp' | 'power' | 'spell' | 'armor' | 'move' | 'crit' | 'evasion' | 'parry' | 'block'>>;

export interface ClassDef {
  name: string;
  tier: number;
  /** Base class this specialist is built from (Tier 2 only). */
  base?: string;
  roles: Partial<Record<Role, number>>;
  stats: StatBlock;
  growth: StatBlock;
  autoBuild: Partial<Attrs>;
  basic: string;
  skills: string[];
  ult: string;
  ruleTemplates: string[];
  model: string;
  gear?: GearRef;
}

export interface RaceDef {
  name: string;
  pct: Partial<Record<'maxHp' | 'power' | 'spell', number>>;
  add: Partial<Record<'armor' | 'move' | 'crit' | 'accuracy' | 'evasion', number>>;
  ruleSlots?: number;
  temperament: string;
}

export interface SpeciesDef {
  family: string;
  tags: string[];
  model: string;
  minion: string;
  /** Fights with teeth and claws: no parry, no block, nothing to knock away. */
  natural?: boolean;
  stats: StatBlock;
  typeMods?: Record<string, number>;
}

export interface ArchetypeDef {
  mult: Partial<Record<'maxHp' | 'power' | 'spell' | 'move', number>>;
  add?: Partial<Record<'armor', number>>;
  gear?: GearRef;
  basic: string;
  skills?: string[];
  rules: string;
  radius?: number;
}

export interface RankDef {
  hp: number;
  power: number;
  xp: number;
  radius?: number;
}

export interface EnemyDef {
  name: string;
  species: string;
  archetype: string;
  rank?: string;
  named?: boolean;
  levelBonus?: number;
  /** Per-enemy tuning multipliers (mostly bosses). */
  mult?: { hp?: number; power?: number };
}

export interface EncounterPool {
  count: number | [number, number];
  pool: Record<string, number>;
  elites?: Record<string, number>;
  captains?: Record<string, number>;
  /** Per-tier, per-room difficulty (tuner knob), on top of the global monster scale. */
  scale?: { hp: number; power: number };
}

export interface TierDef {
  name: string;
  floors: [number, number];
  biome: string;
  heroLevel: number;
  gearScore: number;
  partySize: number;
  field: { w: number; h: number; cover: [number, number]; hazards: number };
  normal: EncounterPool;
  elite: EncounterPool;
  horde: EncounterPool;
  boss: { boss: string; adds: Record<string, number>; scale?: { hp: number; power: number } };
  rooms: Record<string, number>;
  nodes: [number, number];
  named: string[];
  namedChance: number;
  floorsPerRun: number;
}

export interface BiomeDef {
  erosion: number;
  coverTypes: string[];
  hazards: string[];
  plateauChance: number;
}

export const ABILITIES: Record<string, AbilityDef> = Object.fromEntries(
  Object.entries(abilitiesJson).map(([id, a]) => [id, { id, ...(a as Omit<AbilityDef, 'id'>) }]),
);
export const STATUSES: Record<string, StatusDef> = Object.fromEntries(
  Object.entries(statusesJson).map(([id, s]) => [id, { id, ...(s as Omit<StatusDef, 'id'>) }]),
);
export const CLASSES = classesJson as Record<string, ClassDef>;
export const RACES = racesJson as Record<string, RaceDef>;
export const SPECIES = monstersJson.species as Record<string, SpeciesDef>;
export const ARCHETYPES = monstersJson.archetypes as Record<string, ArchetypeDef>;
export const RANKS = monstersJson.ranks as Record<string, RankDef>;
/** Global monster tuning knobs. Mutable so the sim tool's sweeps can try values. */
export const MONSTER_SCALE = monstersJson.scale as { hp: number; power: number };
export const ENEMIES = monstersJson.enemies as Record<string, EnemyDef>;
export const TIERS = tiersJson as unknown as Record<string, TierDef>;
export const BIOMES = biomesJson as Record<string, BiomeDef>;
export interface LeaderRankDef {
  id: string;
  levels: [number, number];
  checks: number;
  noise: number;
  vision: number;
  margin: number;
  hpThreshold: number | 'adaptive';
  discipline: number;
  readsVariance: boolean;
  knowsTypes: boolean;
  namedSense: number;
}
export interface TemperamentDef { greed: number; pushBias: number; streak: 'neutral' | 'ignore' | 'panic' | 'charge'; hpFloor?: number; visionBonus?: number }
export const LEADERSHIP = leadershipJson as unknown as {
  ranks: LeaderRankDef[];
  temperaments: Record<string, TemperamentDef>;
  expectedHpLossPerFight: number;
  streakThreshold: number;
  namedSignPenalty: number;
  ev: { heroValuePerLevel: number; heroValueFloor: number; wipeAversion: number; levelFactor: number; fullPackShare: number; lookahead: Record<string, number>; optimism: Record<string, number>; discount: number; dressing: number; doctrineMargin: Record<string, number>; doctrineHeroRisk: Record<string, number> };
};

export interface BaselineRow { hp: number; win: number; hpCost: number; deaths: number }
/** Measured by `npm run baselines`: tier → room → rows by entering party HP. */
export const BASELINES = (baselinesJson as unknown as { table: Record<string, Record<string, BaselineRow[]>> }).table;

export const DELVE = delveJson as unknown as { torch: { base: number; perFloor: number }; loot: Record<string, [number, number]> };

export interface WeaponDef { parry: number; block: number; disarm: number; natural?: boolean }
export interface ShieldDef { block: number; missiles: boolean; move?: number }
export interface GearRef { weapon: string; shield?: string }
export const GEAR = gearJson as unknown as { weapons: Record<string, WeaponDef>; shields: Record<string, ShieldDef>; disarm: { dur: number } };

export const ORDERS_DATA = ordersJson as unknown as {
  orders: Record<string, { cost: number; cooldown: number }>;
  goodBot: { mendBelowHp: number; unleashBelowHp: number; holdBelowHp: number; reserveForInterrupt: number };
};

export const PROGRESSION = progressionJson as { defense: { parryPerAgility: number; blockPerVigor: number; cap: number }; bot: { tierSlack: number; pushAt: number }; killXpPerLevel: number; roomClearBonus: number; xpCurve: { base: number; exponent: number }; overLevelGap: number; overLevelMult: number; underLevelMult: number; maxLevel: number };

export const RULES = Object.fromEntries(
  Object.entries(rulesJson).filter(([k]) => !k.startsWith('_')),
) as Record<string, RuleDef[]>;

/** Fail loudly on broken references, so data mistakes surface at load, not mid-fight. */
export function validateData(): string[] {
  const errors: string[] = [];
  const ability = (id: string, where: string) => { if (!ABILITIES[id]) errors.push(`${where}: unknown ability ${id}`); };
  for (const [id, c] of Object.entries(CLASSES)) {
    [c.basic, ...c.skills, c.ult].forEach((a) => ability(a, `class ${id}`));
    c.ruleTemplates.forEach((t) => { if (!RULES[t]) errors.push(`class ${id}: unknown rule template ${t}`); });
  }
  const gear = (g: GearRef | undefined, where: string) => {
    if (g && !GEAR.weapons[g.weapon]) errors.push(`${where}: unknown weapon ${g.weapon}`);
    if (g?.shield && !GEAR.shields[g.shield]) errors.push(`${where}: unknown shield ${g.shield}`);
  };
  for (const [id, c] of Object.entries(CLASSES)) gear(c.gear, `class ${id}`);
  for (const [id, a] of Object.entries(ARCHETYPES)) gear(a.gear, `archetype ${id}`);
  for (const [id, a] of Object.entries(ARCHETYPES)) {
    [a.basic, ...(a.skills ?? [])].forEach((x) => ability(x, `archetype ${id}`));
    if (!RULES[a.rules]) errors.push(`archetype ${id}: unknown rules ${a.rules}`);
  }
  for (const [id, e] of Object.entries(ENEMIES)) {
    if (!SPECIES[e.species]) errors.push(`enemy ${id}: unknown species ${e.species}`);
    if (!ARCHETYPES[e.archetype]) errors.push(`enemy ${id}: unknown archetype ${e.archetype}`);
    if (e.rank && !RANKS[e.rank]) errors.push(`enemy ${id}: unknown rank ${e.rank}`);
  }
  for (const [id, s] of Object.entries(SPECIES)) if (!ENEMIES[s.minion]) errors.push(`species ${id}: unknown minion ${s.minion}`);
  for (const [id, ab] of Object.entries(ABILITIES)) {
    for (const e of ab.effects) {
      if (e.type === 'status' && !STATUSES[e.status]) errors.push(`ability ${id}: unknown status ${e.status}`);
      if (e.type === 'summon' && e.enemy !== '@minion' && !ENEMIES[e.enemy]) errors.push(`ability ${id}: unknown summon ${e.enemy}`);
    }
  }
  for (const [id, t] of Object.entries(TIERS)) {
    if (!BIOMES[t.biome]) errors.push(`tier ${id}: unknown biome ${t.biome}`);
    const pools = [t.normal.pool, t.elite.pool, t.elite.elites ?? {}, t.horde.pool, t.horde.captains ?? {}, t.boss.adds, { [t.boss.boss]: 1 }];
    for (const p of pools) for (const e of Object.keys(p)) if (!ENEMIES[e]) errors.push(`tier ${id}: unknown enemy ${e}`);
    for (const e of t.named) if (!ENEMIES[e]?.named) errors.push(`tier ${id}: ${e} is not a Named enemy`);
  }
  for (const [id, r] of Object.entries(RACES)) if (!LEADERSHIP.temperaments[r.temperament]) errors.push(`race ${id}: unknown temperament ${r.temperament}`);
  return errors;
}
