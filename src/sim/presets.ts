// Party presets for the sim tool and tests (spec 09 §2). Heroes are level-appropriate for the tier.
import { TIERS } from './data';
import type { RunHero } from './run';
import { ZONE } from './roster';

const RACE: Record<string, string> = { fighter: 'dwarf', cleric: 'human', ranger: 'elf', rogue: 'halfling', mage: 'elf', bard: 'human', alchemist: 'halfling', necromancer: 'human' };

/** Three core members, plus a fourth for tiers that expect a party of 4. */
export const PRESETS: Record<string, string[]> = {
  starter: ['fighter', 'cleric', 'ranger', 'mage'],
  turtle: ['fighter', 'cleric', 'bard', 'ranger'],
  glass: ['rogue', 'mage', 'ranger', 'alchemist'],
  'no-healer': ['fighter', 'rogue', 'mage', 'ranger'],
  summoner: ['necromancer', 'fighter', 'cleric', 'alchemist'],
  'horde-clear': ['fighter', 'mage', 'alchemist', 'cleric'],
};

export const ALL_CLASSES = ['fighter', 'rogue', 'cleric', 'mage', 'ranger', 'bard', 'alchemist', 'necromancer'];

export function heroFor(classId: string, tier: string, i: number, over: Partial<RunHero> = {}): RunHero {
  const t = TIERS[tier];
  return {
    id: `${classId}${i}`, name: `${classId[0].toUpperCase()}${classId.slice(1)}`, classId, raceId: RACE[classId] ?? 'human',
    level: t.heroLevel, gearScore: t.gearScore, zone: ZONE[classId] ?? 'middle', leadership: 5, ...over,
  };
}

export function party(classes: string[], tier: string, size = TIERS[tier].partySize): RunHero[] {
  return classes.slice(0, size).map((c, i) => heroFor(c, tier, i));
}

/** Leader profiles used by the `runs` and `leaders` suites. */
export const LEADERS: Record<string, { raceId: string; leadership: number }> = {
  'novice-orc': { raceId: 'orc', leadership: 2 },
  'novice-goblin': { raceId: 'goblin', leadership: 2 },
  'seasoned-dwarf': { raceId: 'dwarf', leadership: 5 },
  'veteran-elf': { raceId: 'elf', leadership: 8 },
  'master-human': { raceId: 'human', leadership: 10 },
};
