// One delve from Torchwatch: the player takes part room by room, then it is settled on the save.
// Hardcore: a delve under way is remembered, so closing the page plays it out rather than undoing it.
import { TIERS } from '../sim/data';
import type { Doctrine } from '../sim/leader';
import { hash32 } from '../sim/rng';
import { applyRun, type RunAftermath } from '../sim/roster';
import { delveSteps, runRun, type DelveAnswer, type DelveRequest, type RunResult, type RunSetup } from '../sim/run';
import { campEffect, candidate, hireCost, metRaces, refreshBoard, saveGame, TIER_IDS, type GameState } from './state';

export interface DelvePlan { partyIds: string[]; leaderId: string; tier: string; doctrine: Doctrine; fromWaystone: boolean }
export interface DelveOutcome { result: RunResult; aftermath: RunAftermath; unlockedTier?: string; names: Record<string, string>; classes: Record<string, string>; volunteers?: string[]; newRaces?: string[] }

export function partySizeFor(tier: string) { return TIERS[tier].partySize; }

/** Why a plan can't go yet, or null when it can. */
export function planProblem(state: GameState, plan: DelvePlan): string | null {
  const size = partySizeFor(plan.tier);
  if (plan.partyIds.length === 0) return 'Pick who goes.';
  if (plan.partyIds.length > size) return `Tier ${plan.tier} takes at most ${size} heroes.`;
  if (!plan.partyIds.includes(plan.leaderId)) return 'Pick a Leader from the party.';
  const tierIdx = TIER_IDS.indexOf(plan.tier);
  if (tierIdx < 0 || tierIdx > state.unlocked) return 'That tier is still sealed.';
  for (const id of plan.partyIds) {
    const h = state.roster.find((x) => x.hero.id === id);
    if (!h || !h.alive) return 'Someone in the party is gone.';
    if (h.benched > 0) return `${h.hero.name} is still recovering.`;
  }
  return null;
}

/** The run's setup: everything is fixed by the save's seed and the plan, so it can't be rerolled. */
function runSetup(state: GameState, plan: DelvePlan): RunSetup {
  const tier = TIERS[plan.tier];
  const party = plan.partyIds.map((id) => state.roster.find((h) => h.hero.id === id)!);
  return {
    seed: hash32(state.seed, 'run', state.runs), tier: plan.tier,
    party: party.map((h) => ({ ...h.hero, gearScore: tier.gearScore })), leaderId: plan.leaderId,
    doctrine: plan.doctrine, startFloor: plan.fromWaystone ? state.waystones[plan.tier] : undefined, record: true,
    torchBonus: campEffect(state, 'torch'),
  };
}

/**
 * Start a delve the player takes part in. The save remembers it's under way first, so closing the
 * page can't dodge the outcome (finishPending plays it out on the next load).
 */
export function beginDelve(state: GameState, plan: DelvePlan): Generator<DelveRequest, RunResult, DelveAnswer> {
  const problem = planProblem(state, plan);
  if (problem) throw new Error(problem);
  state.pending = { plan, run: state.runs };
  saveGame(state);
  return delveSteps(runSetup(state, plan));
}

/** How a hero fell, for the memorial: where, and to what. */
function causeOfDeath(result: RunResult, name: string): string {
  const e = result.ledger.find((x) => x.lost.some((l) => l.startsWith(`${name} `)));
  if (!e) return 'lost in the dark';
  const how = e.lost.find((l) => l.startsWith(`${name} `)) ?? '';
  if (how.includes('left behind')) return `left behind in the retreat on floor ${e.floor}`;
  if (e.named) return `slain by ${e.named} on floor ${e.floor}`;
  const room: Record<string, string> = { fight: 'a skirmish', elite: 'an elite fight', horde: 'a horde', boss: 'the boss fight' };
  return `fell in ${room[e.room] ?? 'the dark'} on floor ${e.floor}`;
}

/** Write a finished delve onto the save: XP, the fallen, coin, waystones, unlocks. */
export function settleDelve(state: GameState, plan: DelvePlan, result: RunResult): DelveOutcome {
  const party = plan.partyIds.map((id) => state.roster.find((h) => h.hero.id === id)!);
  const leader = party.find((h) => h.hero.id === plan.leaderId)!;
  const names = Object.fromEntries(party.map((h) => [h.hero.id, h.hero.name]));
  const classes = Object.fromEntries(party.map((h) => [h.hero.id, h.hero.classId]));
  const metBefore = new Set(metRaces(state));
  const aftermath = applyRun(state.roster, party, leader, result, plan.tier, 2 + campEffect(state, 'recovery'));
  for (const id of aftermath.died) {
    const h = state.roster.find((x) => x.hero.id === id)!;
    state.memorial.push({ id, name: h.hero.name, classId: h.hero.classId, raceId: h.hero.raceId, level: h.hero.level, run: state.runs + 1, tier: plan.tier, cause: causeOfDeath(result, h.hero.name) });
  }
  state.roster = state.roster.filter((h) => h.alive);
  state.coin += result.banked;
  // what the party carried home goes to the stores; the fallen are buried with their gear
  state.stash = [...(state.stash ?? []), ...result.found];
  if (result.outcome !== 'wipe') state.waystones[plan.tier] = Math.max(state.waystones[plan.tier] ?? 0, result.floorsReached);
  let unlockedTier: string | undefined;
  const tierIdx = TIER_IDS.indexOf(plan.tier);
  if (result.outcome === 'cleared' && tierIdx === state.unlocked && state.unlocked + 1 < TIER_IDS.length) {
    state.unlocked++;
    unlockedTier = TIER_IDS[state.unlocked];
  }
  state.runs++;
  state.history.unshift({ run: state.runs, tier: plan.tier, outcome: result.outcome, banked: result.banked, floors: result.floorsReached, died: aftermath.died.map((id) => names[id]), levelled: aftermath.levelled.length });
  state.history = state.history.slice(0, 30);
  delete state.pending;
  const newRaces = metRaces(state).filter((r) => !metBefore.has(r));
  refreshBoard(state);
  const volunteers = assist(state);
  saveGame(state);
  return { result, aftermath, unlockedTier, names, classes, volunteers: volunteers.length ? volunteers : undefined, newRaces: newRaces.length ? newRaces : undefined };
}

/**
 * Launch assistance: a company that can't field a starting party, and can't afford to hire one,
 * gets volunteers from the Inn for free. Losing everyone is a setback, never the end of the save.
 */
export function assist(state: GameState): string[] {
  const need = TIERS[TIER_IDS[0]].partySize;
  const cheapest = Math.min(...state.hireBoard.map((h) => hireCost(h)), Infinity);
  const canHire = Number.isFinite(cheapest) ? Math.floor(state.coin / cheapest) : 0;
  const short = need - state.roster.length - Math.min(canHire, state.hireBoard.length);
  const names: string[] = [];
  for (let i = 0; i < short; i++) {
    const roles = ['fighter', 'cleric', 'ranger'];
    const have = new Set(state.roster.map((h) => h.hero.classId));
    const v = candidate(state, 1, roles.find((r) => !have.has(r)) ?? 'fighter');
    v.born = state.runs;
    state.roster.push(v);
    names.push(v.hero.name);
  }
  return names;
}

/** When everyone is still recovering, time can pass in town: everyone's recovery moves on by one delve. */
export function rest(state: GameState): void {
  for (const h of state.roster) if (h.benched > 0) h.benched--;
  saveGame(state);
}

/** A delve the page closed on: the party carried on without the player (no orders, the Leader's calls stand). */
export function finishPending(state: GameState): DelveOutcome | null {
  if (!state.pending || state.pending.run !== state.runs) { delete state.pending; return null; }
  const { plan } = state.pending;
  return settleDelve(state, plan, runRun(runSetup(state, plan)));
}

/** A whole delve without the player (tests, and anywhere the outcome is wanted at once). */
export function delve(state: GameState, plan: DelvePlan): DelveOutcome {
  const problem = planProblem(state, plan);
  if (problem) throw new Error(problem);
  return settleDelve(state, plan, runRun(runSetup(state, plan)));
}

export function hire(state: GameState, id: string): string | null {
  const i = state.hireBoard.findIndex((h) => h.hero.id === id);
  if (i < 0) return 'They already left.';
  const h = state.hireBoard[i];
  const cost = hireCost(h);
  if (state.coin < cost) return `Hiring ${h.hero.name} costs ${cost} coin.`;
  state.coin -= cost;
  h.born = state.runs;
  state.roster.push(h);
  state.hireBoard.splice(i, 1);
  saveGame(state);
  return null;
}
