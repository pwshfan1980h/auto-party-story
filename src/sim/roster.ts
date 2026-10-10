// The roster between runs (spec 08): XP and levels, rest after being carried out, Leadership
// growth and permadeath. Shared by the game and the simulated campaign so both follow one rulebook.
import { PROGRESSION, TIERS } from './data';
import type { RunHero, RunResult } from './run';
import type { Zone } from './types';

export interface RosterHero { hero: RunHero; xp: number; benched: number; runsLed: number; alive: boolean; born: number }

export const ZONE: Record<string, Zone> = { fighter: 'front', knight: 'front', berserker: 'front', rogue: 'middle', assassin: 'middle', bard: 'middle', cleric: 'back', ranger: 'back', sniper: 'back', mage: 'back', alchemist: 'back', necromancer: 'back' };

export const xpToNext = (level: number) => Math.round(PROGRESSION.xpCurve.base * Math.pow(level, PROGRESSION.xpCurve.exponent));

export interface RunAftermath {
  /** Heroes who gained at least one level, with their new level. */
  levelled: { id: string; level: number }[];
  /** Heroes lost for good. */
  died: string[];
  /** XP each survivor received. */
  xp: Record<string, number>;
}

/** Apply a finished run to the roster: survivors share XP, the carried rest, the Leader grows, the dead are gone. */
export function applyRun(roster: RosterHero[], party: RosterHero[], leader: RosterHero, r: RunResult, tier: string, recovery = 2): RunAftermath {
  const out: RunAftermath = { levelled: [], died: [], xp: {} };
  const survivors = party.filter((h) => !r.died.includes(h.hero.id));
  for (const h of survivors) {
    // XP, with the over-level penalty and catch-up bonus
    let share = r.xp / Math.max(1, survivors.length);
    if (h.hero.level >= TIERS[tier].heroLevel + PROGRESSION.overLevelGap) share *= PROGRESSION.overLevelMult;
    else if (h.hero.level < TIERS[tier].heroLevel) share *= PROGRESSION.underLevelMult;
    h.xp += share;
    out.xp[h.hero.id] = share;
    const was = h.hero.level;
    while (h.hero.level < PROGRESSION.maxLevel && h.xp >= xpToNext(h.hero.level)) { h.xp -= xpToNext(h.hero.level); h.hero = { ...h.hero, level: h.hero.level + 1 }; }
    if (h.hero.level > was) out.levelled.push({ id: h.hero.id, level: h.hero.level });
    if (r.carried.includes(h.hero.id) && recovery > 0) h.benched = recovery;
  }
  leader.runsLed++;
  if (leader.runsLed % 4 === 0 && leader.hero.leadership < 10) leader.hero = { ...leader.hero, leadership: leader.hero.leadership + 1 };
  for (const h of party) if (r.died.includes(h.hero.id)) { h.alive = false; out.died.push(h.hero.id); }
  for (const h of roster) if (!party.includes(h) && h.benched > 0) h.benched--;
  return out;
}
