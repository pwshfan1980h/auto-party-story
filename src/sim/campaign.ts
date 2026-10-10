// A simulated campaign (spec 09 §4): a bot plays from a fresh roster through the tiers, so
// progression pacing, permadeath and recovery can be measured without a human.
import { PROGRESSION, TIERS } from './data';
import { stream } from './rng';
import { applyRun, ZONE, type RosterHero } from './roster';
import { runRun, type RunPolicy, type RunResult } from './run';

export interface CampaignOptions {
  seed: number;
  maxRuns?: number;
  policy?: RunPolicy;
  /** The roster the Inn offers at the start. */
  start?: string[];
  /** Simulated player: play a tier once the roster is within this many levels of it. */
  tierSlack?: number;
  /** Simulated player: order a push for the boss once the party is this many levels over its newest tier. */
  pushAt?: number;
}


export interface CampaignResult {
  runs: number;
  hours: number;
  tierUnlocked: string;
  /** Hours of play when each tier was first unlocked, and when Tier III's boss first fell. */
  milestones: Record<string, number>;
  outcomes: Record<RunResult['outcome'], number>;
  deathsPerHeroRun: number;
  heroesLost: number;
  recruits: number;
  /** Longest streak of runs with no new level, floor or tier. */
  longestStall: number;
  /** [hours, average party level, tier index] after each run. */
  curve: [number, number, number][];
  /** One row per run: tier played, party's average level, outcome, heroes lost, floors reached. */
  log: { tier: string; level: number; outcome: string; died: number; floors: number; leadership: number; doctrine: string; ended?: string }[];
  /** Runs needed after a wipe until a party at the same tier won a fight again (−1: never). */
  recoveryRuns: number[];
}

const TIER_IDS = ['I', 'II', 'III'];
const CLASS_RACE = ['human', 'dwarf', 'elf', 'halfling'];
export { xpToNext } from './roster';

export function runCampaign(options: CampaignOptions): CampaignResult {
  const opt = { tierSlack: PROGRESSION.bot.tierSlack, pushAt: PROGRESSION.bot.pushAt, ...options };
  const rng = stream(opt.seed, 'campaign');
  const maxRuns = opt.maxRuns ?? 120;
  let seq = 0;
  const hire = (classId: string, level: number, born: number): RosterHero => {
    const race = CLASS_RACE[rng.int(CLASS_RACE.length)];
    const id = `${classId}-${++seq}`;
    return { hero: { id, name: id, classId, raceId: race, level, gearScore: 10, zone: ZONE[classId] ?? 'middle', leadership: race === 'human' ? 3 : 1 }, xp: 0, benched: 0, runsLed: 0, alive: true, born };
  };
  const roster: RosterHero[] = (opt.start ?? ['fighter', 'cleric', 'ranger', 'mage', 'rogue']).map((c) => hire(c, 1, 0));
  let unlocked = 0, hours = 0, recruits = 0, lost = 0, stall = 0, longestStall = 0, heroRuns = 0, deaths = 0;
  let bestFloor = 0;
  const milestones: Record<string, number> = { I: 0 };
  const outcomes = { cleared: 0, retreat: 0, wipe: 0 };
  const curve: [number, number, number][] = [];
  const log: CampaignResult['log'] = [];
  // deepest floor reached in each tier: a waystone the next push can start from
  const waystone: Record<string, number> = {};
  const recoveryRuns: number[] = [];
  let sinceWipe = -1;
  let run = 0;
  for (; run < maxRuns; run++) {
    // the Inn keeps at least five heroes on the books; replacements are trained toward the current tier
    const living = roster.filter((h) => h.alive);
    const band = TIERS[TIER_IDS[unlocked]].heroLevel;
    while (living.length < 5) {
      const needs = ['cleric', 'fighter', 'ranger', 'mage', 'rogue'].find((c) => !living.some((h) => h.hero.classId === c)) ?? 'fighter';
      const h = hire(needs, Math.max(1, band - 2), hours);
      roster.push(h); living.push(h); recruits++;
    }
    // pick the tier: the highest unlocked one that the party actually going is ready for
    // (judging by the whole roster kept strong heroes farming a tier that no longer taught them anything)
    const avg = (hs: RosterHero[]) => hs.reduce((s, h) => s + h.hero.level, 0) / Math.max(1, hs.length);
    const strongest = (n: number) => living.filter((h) => h.benched <= 0).sort((a, b) => b.hero.level - a.hero.level).slice(0, n);
    let ti = unlocked;
    while (ti > 0 && avg(strongest(TIERS[TIER_IDS[ti]].partySize)) < TIERS[TIER_IDS[ti]].heroLevel - opt.tierSlack) ti--;
    const tier = TIER_IDS[ti];
    const size = TIERS[tier].partySize;
    // a balanced party: a healer if there is one, then the strongest of the rest
    const ready = living.filter((h) => h.benched <= 0).sort((a, b) => b.hero.level - a.hero.level || a.hero.id.localeCompare(b.hero.id));
    const party: RosterHero[] = [];
    const healer = ready.find((h) => h.hero.classId === 'cleric');
    if (healer) party.push(healer);
    for (const h of ready) if (party.length < size && !party.includes(h)) party.push(h);
    if (!party.length) { for (const h of living) h.benched--; continue; }
    const leader = party.reduce((a, b) => (b.hero.leadership > a.hero.leadership ? b : a));
    const gear = TIERS[tier].gearScore;
    // once the party outlevels its newest tier, the player orders a push for the boss
    const doctrine = ti === unlocked && avg(party) >= TIERS[tier].heroLevel + opt.pushAt ? 'depth' : 'balanced';
    const r = runRun({ seed: opt.seed * 1000 + run, tier, party: party.map((h) => ({ ...h.hero, gearScore: gear })), leaderId: leader.hero.id, policy: opt.policy, doctrine, startFloor: doctrine === 'depth' ? waystone[tier] : undefined });
    outcomes[r.outcome]++;
    if (r.outcome !== 'wipe') waystone[tier] = Math.max(waystone[tier] ?? 0, r.floorsReached);
    const lastCall = r.decisions.filter((d) => d.decision === 'retreat').pop();
    log.push({ tier, level: +avg(party).toFixed(1), outcome: r.outcome, died: r.died.length, floors: r.floorsReached, leadership: leader.hero.leadership, doctrine, ended: r.outcome === 'retreat' ? lastCall?.reason : undefined });
    hours += (r.fightSeconds / 60 + r.rooms * 0.4 + 2) / 60;
    heroRuns += party.length;
    const after = applyRun(roster, party, leader, r, tier);
    let progressed = after.levelled.length > 0;
    deaths += after.died.length; lost += after.died.length;
    if (r.floorsReached > bestFloor) { bestFloor = r.floorsReached; progressed = true; }
    if (r.outcome === 'cleared' && ti === unlocked) {
      progressed = true;
      if (unlocked + 1 < TIER_IDS.length) { unlocked++; milestones[TIER_IDS[unlocked]] = +hours.toFixed(2); }
      else if (milestones.clearedIII === undefined) milestones.clearedIII = +hours.toFixed(2);
    }
    stall = progressed ? 0 : stall + 1;
    longestStall = Math.max(longestStall, stall);
    if (r.outcome === 'wipe') { if (sinceWipe >= 0) recoveryRuns.push(-1); sinceWipe = 0; }
    else if (sinceWipe >= 0) { sinceWipe++; if (r.fightsWon > 0) { recoveryRuns.push(sinceWipe); sinceWipe = -1; } }
    const team = roster.filter((h) => h.alive);
    curve.push([+hours.toFixed(2), +avg(team).toFixed(1), unlocked + 1]);
    if (milestones.clearedIII !== undefined) break;
  }
  return {
    runs: run + 1, hours: +hours.toFixed(2), tierUnlocked: TIER_IDS[unlocked], milestones, outcomes,
    deathsPerHeroRun: deaths / Math.max(1, heroRuns), heroesLost: lost, recruits, longestStall, curve, log, recoveryRuns,
  };
}
