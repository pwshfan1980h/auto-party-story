// One delve from Torchwatch: run the sim, then settle it on the save before anything is shown.
// Hardcore: the outcome is written first, so reloading the page can't undo a death.
import { TIERS } from '../sim/data';
import type { Doctrine } from '../sim/leader';
import { hash32 } from '../sim/rng';
import { applyRun, type RunAftermath } from '../sim/roster';
import { runRun, type RunResult } from '../sim/run';
import { hireCost, refreshBoard, saveGame, TIER_IDS, type GameState } from './state';

export interface DelvePlan { partyIds: string[]; leaderId: string; tier: string; doctrine: Doctrine; fromWaystone: boolean }
export interface DelveOutcome { result: RunResult; aftermath: RunAftermath; unlockedTier?: string; names: Record<string, string>; classes: Record<string, string> }

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

export function delve(state: GameState, plan: DelvePlan): DelveOutcome {
  const problem = planProblem(state, plan);
  if (problem) throw new Error(problem);
  const party = plan.partyIds.map((id) => state.roster.find((h) => h.hero.id === id)!);
  const leader = party.find((h) => h.hero.id === plan.leaderId)!;
  const tier = TIERS[plan.tier];
  const names = Object.fromEntries(party.map((h) => [h.hero.id, h.hero.name]));
  const classes = Object.fromEntries(party.map((h) => [h.hero.id, h.hero.classId]));
  const result = runRun({
    seed: hash32(state.seed, 'run', state.runs), tier: plan.tier,
    party: party.map((h) => ({ ...h.hero, gearScore: tier.gearScore })), leaderId: leader.hero.id,
    doctrine: plan.doctrine, startFloor: plan.fromWaystone ? state.waystones[plan.tier] : undefined, record: true,
  });
  const aftermath = applyRun(state.roster, party, leader, result, plan.tier);
  for (const id of aftermath.died) {
    const h = state.roster.find((x) => x.hero.id === id)!;
    state.memorial.push({ id, name: h.hero.name, classId: h.hero.classId, raceId: h.hero.raceId, level: h.hero.level, run: state.runs + 1, tier: plan.tier });
  }
  state.roster = state.roster.filter((h) => h.alive);
  state.coin += result.banked;
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
  refreshBoard(state);
  saveGame(state);
  return { result, aftermath, unlockedTier, names, classes };
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
