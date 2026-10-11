// Derived stats and the damage maths (spec 01).
import { ARCHETYPES, CLASSES, ENEMIES, GEAR, ITEMS, MONSTER_SCALE, PROGRESSION, RACES, RANKS, SPECIES } from './data';
import type { Rng } from './rng';
import { PHYSICAL, type Attrs, type DamageType, type Stats } from './types';

export function baseStats(): Stats {
  return {
    maxHp: 1, power: 0, spell: 0, armor: 0, resist: {}, atkSpeed: 1, move: 1.5, crit: 0.05, critMult: 1.75,
    evasion: 0.03, parry: 0, block: 0, blockMissiles: 0, disarm: 0, armed: 0, accuracy: 1, energyGain: 1, healPower: 1, healTaken: 1, radius: 0.3,
  };
}

/** Spend level-up points by the class's Auto build weights (largest remainder, deterministic). */
export function autoAttrs(classId: string, level: number): Attrs {
  const w = CLASSES[classId].autoBuild;
  const keys: (keyof Attrs)[] = ['might', 'agility', 'arcana', 'vigor'];
  const points = Math.max(0, level - 1);
  const raw = keys.map((k) => (w[k] ?? 0) * points);
  const out = raw.map(Math.floor);
  let left = points - out.reduce((a, b) => a + b, 0);
  const order = keys.map((_, i) => i).sort((a, b) => raw[b] - out[b] - (raw[a] - out[a]) || a - b);
  for (const i of order) { if (left <= 0) break; out[i]++; left--; }
  return { might: out[0], agility: out[1], arcana: out[2], vigor: out[3] };
}

/** Attribute points past 40 count half. */
const soft = (n: number) => (n <= 40 ? n : 40 + (n - 40) / 2);

/** What a weapon and shield let a unit do: parry, block, stop missiles, disarm. */
function applyGear(s: Stats, weaponId?: string, shieldId?: string) {
  const w = weaponId ? GEAR.weapons[weaponId] : undefined, sh = shieldId ? GEAR.shields[shieldId] : undefined;
  s.parry = w?.parry ?? 0;
  s.block = (w?.block ?? 0) + (sh?.block ?? 0);
  s.blockMissiles = sh?.missiles ? 1 : 0;
  s.disarm = w?.disarm ?? 0;
  s.armed = w && !w.natural ? 1 : 0;
  s.move += sh?.move ?? 0;
}

export function heroStats(classId: string, raceId: string, level: number, attrs: Attrs, gearScore: number, items: string[] = []): Stats {
  const c = CLASSES[classId];
  const r = RACES[raceId];
  const s = baseStats();
  const lv = level - 1;
  s.maxHp = (c.stats.maxHp ?? 80) + (c.growth.maxHp ?? 0) * lv;
  s.power = (c.stats.power ?? 0) + (c.growth.power ?? 0) * lv;
  s.spell = (c.stats.spell ?? 0) + (c.growth.spell ?? 0) * lv;
  s.armor = (c.stats.armor ?? 0) + (c.growth.armor ?? 0) * lv;
  s.move = c.stats.move ?? 1.5;
  s.crit = c.stats.crit ?? 0.05;
  // gear sets the floor for parry and block; skill grows it with levels, and attributes sharpen it below
  // equipped items can change the weapon and shield carried (the equip rules keep it sensible)
  const worn = items.map((id) => ITEMS[id]).filter((x) => !!x);
  const weapon = worn.find((x) => x.slot === 'weapon')?.gear ?? c.gear?.weapon;
  const shield = c.gear?.shield ? worn.find((x) => x.slot === 'shield')?.gear ?? c.gear.shield : undefined;
  applyGear(s, weapon, shield);
  if (s.parry > 0) s.parry += (c.growth.parry ?? 0) * lv;
  if (s.block > 0) s.block += (c.growth.block ?? 0) * lv;

  const m = soft(attrs.might), a = soft(attrs.agility), ar = soft(attrs.arcana), v = soft(attrs.vigor);
  s.maxHp += m * 3 + v * 8;
  s.armor += v * 0.5;
  s.atkSpeed += a * 0.01;
  s.crit += a * 0.005;
  s.evasion += a * 0.004;
  if (s.parry > 0) s.parry += a * PROGRESSION.defense.parryPerAgility;
  if (s.block > 0) s.block += v * PROGRESSION.defense.blockPerVigor;
  s.parry = Math.min(PROGRESSION.defense.cap, s.parry);
  s.block = Math.min(PROGRESSION.defense.cap, s.block);
  s.move += a * 0.01;
  s.energyGain += ar * 0.015;
  s.healPower += ar * 0.02;
  for (const t of ['slash', 'pierce', 'blunt', 'fire', 'frost', 'storm', 'holy', 'shadow', 'poison'] as DamageType[]) s.resist[t] = v;
  // Might and Arcana add % damage; stored as multipliers on power and spell.
  s.power *= 1 + m * 0.02;
  s.spell *= 1 + ar * 0.02;

  for (const [k, p] of Object.entries(r.pct)) (s as unknown as Record<string, number>)[k] *= 1 + (p ?? 0);
  for (const [k, p] of Object.entries(r.add)) (s as unknown as Record<string, number>)[k] += p ?? 0;
  for (const [k, p] of Object.entries(r.resist ?? {})) s.resist[k as DamageType] = (s.resist[k as DamageType] ?? 0) + (p ?? 0);

  for (const it of worn) for (const [k, v] of Object.entries(it.add)) (s as unknown as Record<string, number>)[k] += v ?? 0;
  s.parry = Math.min(PROGRESSION.defense.cap, s.parry);
  s.block = Math.min(PROGRESSION.defense.cap, s.block);

  const gear = 1 + 0.012 * gearScore;
  s.maxHp *= gear; s.power *= gear; s.spell *= gear; s.armor *= gear;
  s.maxHp = Math.round(s.maxHp);
  return s;
}

export function monsterStats(enemyId: string, level: number, rankOverride?: string, room: { hp: number; power: number } = { hp: 1, power: 1 }): { stats: Stats; tags: string[]; typeMods: Record<string, number> } {
  const e = ENEMIES[enemyId];
  const sp = SPECIES[e.species];
  const ar = ARCHETYPES[e.archetype];
  const rank = RANKS[rankOverride ?? e.rank ?? 'normal'];
  const curve = Math.pow(1.07, level - 1);
  const s = baseStats();
  const em = e.mult ?? {};
  s.maxHp = Math.round((sp.stats.maxHp ?? 50) * (ar.mult.maxHp ?? 1) * rank.hp * curve * MONSTER_SCALE.hp * (em.hp ?? 1) * room.hp);
  s.power = (sp.stats.power ?? 5) * (ar.mult.power ?? 1) * rank.power * curve * MONSTER_SCALE.power * (em.power ?? 1) * room.power;
  s.spell = (sp.stats.spell ?? 5) * (ar.mult.spell ?? 1) * rank.power * curve * MONSTER_SCALE.power * (em.power ?? 1) * room.power;
  s.armor = (sp.stats.armor ?? 0) + (ar.add?.armor ?? 0);
  s.move = (sp.stats.move ?? 1.4) * (ar.mult.move ?? 1);
  s.evasion = sp.stats.evasion ?? 0.03;
  applyGear(s, sp.natural ? 'natural' : ar.gear?.weapon, sp.natural ? undefined : ar.gear?.shield);
  s.radius = (ar.radius ?? 0.3) * (rank.radius ?? 1);
  return { stats: s, tags: sp.tags, typeMods: sp.typeMods ?? {} };
}

export interface DamageRoll {
  dmg: number;
  crit: boolean;
}

/**
 * The damage formula, in spec order: raw → % bonuses → buffs → vs-tag → variance → crit → mitigation → family mod.
 * `bonus` is the product of attacker buffs, target vulnerability and any situational multiplier (e.g. backstab).
 */
export function rollDamage(
  rng: Rng, type: DamageType, base: number, scale: number,
  atk: Stats, def: Stats, bonus: number, familyMod: number,
): DamageRoll {
  const physical = PHYSICAL.has(type);
  let raw = base + scale * (physical ? atk.power : atk.spell);
  raw *= bonus;
  raw *= 0.9 + 0.2 * rng.next();
  const crit = rng.next() < atk.crit;
  if (crit) raw *= atk.critMult;
  let mitig = physical ? def.armor / (Math.max(0, def.armor) + 50) : (def.resist[type] ?? 0) / 100;
  mitig = Math.min(0.75, mitig);
  const dmg = Math.max(1, Math.round(raw * (1 - mitig) * familyMod));
  return { dmg, crit };
}
