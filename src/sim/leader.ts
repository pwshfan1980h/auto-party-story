// The Leader's run decisions (spec 07): perception with noise, the ordered decision tree,
// route choice on the fogged map, and everything the Council view needs to show the call.
import { LEADERSHIP, RACES, type LeaderRankDef, type TemperamentDef } from './data';
import type { FloorMap, NodeType } from './delve';
import type { Rng } from './rng';

export type Doctrine = 'balanced' | 'home' | 'pack' | 'depth';

export interface LeaderProfile {
  heroId: string;
  name: string;
  level: number;
  rank: LeaderRankDef;
  temperament: string;
  temper: TemperamentDef;
}

export function leaderProfile(hero: { id: string; name: string; raceId: string; leadership: number }): LeaderProfile {
  const level = Math.max(1, Math.min(10, hero.leadership));
  const rank = LEADERSHIP.ranks.find((r) => level >= r.levels[0] && level <= r.levels[1]) ?? LEADERSHIP.ranks[0];
  const temperament = RACES[hero.raceId].temperament;
  return { heroId: hero.id, name: hero.name, level, rank, temperament, temper: LEADERSHIP.temperaments[temperament] };
}

/** The party's true state, in 0–1 terms where possible. */
export interface PartyState {
  hp: number;
  fallen: number;
  torch: number;
  pack: number;
  packValue: number;
  luck: number;
  tier: number;
  floor: number;
  /** Rooms to walk back through to get out (0 at a campfire, which is a shortcut out). */
  roomsHome: number;
}

export type CheckState = 'fired' | 'pass' | 'skip';

export interface Decision {
  leader: string;
  decision: 'push' | 'retreat';
  check: number;
  reason: string;
  checks: CheckState[];
  read: { hp: number; torch: number; pack: number; packValue: number; luck: number };
  truth: PartyState;
  confidence: number;
  next?: number;
  options: { node: number; type: NodeType | '?'; score: number; pref: number }[];
  disciplineBroken: boolean;
  namedSpotted: boolean;
  /** Judged afterwards: a push followed by a room with no losses, or a retreat when it was needed (spec 07). */
  goodCall?: boolean;
}

const VALUE: Record<string, number> = { fight: 0.5, elite: 0.75, horde: 0.7, treasure: 0.85, shrine: 0.45, campfire: 0.25, event: 0.45, stairs: 0.6, boss: 0.9, '?': 0.5, start: 0 };
const DANGER: Record<string, number> = { fight: 0.4, elite: 0.7, horde: 0.75, treasure: 0.05, shrine: 0.05, campfire: 0, event: 0.2, stairs: 0.1, boss: 0.95, '?': 0.45, start: 0 };

export function decide(L: LeaderProfile, truth: PartyState, map: FloorMap, at: number, rng: Rng, doctrine: Doctrine = 'balanced'): Decision {
  const { rank, temper } = L;
  const disciplineBroken = doctrine !== 'balanced' && rng.chance(rank.discipline);
  const doc = disciplineBroken ? 'balanced' : doctrine;
  const see = (v: number) => Math.max(0, Math.min(1, v + rank.noise * (2 * rng.next() - 1)));
  const read = {
    hp: see(truth.hp), torch: see(truth.torch / 10) * 10, pack: see(truth.pack), packValue: see(truth.packValue),
    luck: Math.max(-1, Math.min(1, truth.luck + rank.noise * (2 * rng.next() - 1))),
  };
  const checks: CheckState[] = ['skip', 'skip', 'skip', 'skip', 'skip', 'skip'];
  const margin = rank.margin + (doc === 'home' ? 1 : 0);
  const baseT = rank.hpThreshold === 'adaptive' ? 0.30 + 0.04 * truth.fallen + 0.02 * (truth.tier - 1) : rank.hpThreshold;
  const hpT = (temper.hpFloor !== undefined && !rank.readsVariance ? temper.hpFloor : baseT) + (doc === 'home' ? 0.05 : doc === 'depth' ? -0.05 : 0);
  const greed = temper.greed + (doc === 'pack' ? 0.2 : 0);
  const push = temper.pushBias + (doc === 'depth' ? 0.15 : 0);
  const toExit = truth.roomsHome;

  // route options the Leader can see from here
  const here = map.nodes[at];
  const named = here.next.map((n) => map.nodes[n]).some((n) => n.named);
  const namedSpotted = named && (rank.namedSense >= 1 || (rank.namedSense > 0 && rng.chance(rank.namedSense)));
  const options = here.next.map((id) => {
    const n = map.nodes[id];
    const type: NodeType | '?' = n.known ? n.type : '?';
    // danger always counts a little, and much more as the party wears down
    let score = VALUE[type] * (0.6 + greed) - DANGER[type] * (0.35 + (1 - read.hp) * 1.6) * (1 + 0.1 * truth.tier);
    if (type === 'campfire' && read.hp < 0.6) score += 0.6;
    if (type === 'shrine' && read.hp < 0.6) score += 0.2;
    if (type === '?') score += temper.streak === 'charge' ? 0.15 : -0.1;
    if (n.named && namedSpotted) score -= LEADERSHIP.namedSignPenalty * 2;
    // Seasoned+ Leaders look past the next room: half the value of the best room after it
    if (rank.vision >= 2 && n.known) {
      const after = n.next.map((c) => map.nodes[c]).filter((c) => c.known);
      if (after.length) score += 0.5 * Math.max(...after.map((c) => VALUE[c.type] * (0.6 + greed) - DANGER[c.type] * (0.35 + (1 - read.hp) * 1.6)));
    }
    score += rank.noise * (rng.next() - 0.5) * 2;
    return { node: id, type, score, pref: 0 };
  });
  const lo = Math.min(...options.map((o) => o.score)), hi = Math.max(...options.map((o) => o.score));
  for (const o of options) o.pref = options.length > 1 ? 0.15 + 0.85 * ((o.score - lo) / ((hi - lo) || 1)) : 1;

  const result = (decision: 'push' | 'retreat', check: number, reason: string, confidence: number): Decision => {
    checks[check] = 'fired';
    let next: number | undefined;
    if (decision === 'push') {
      next = options.reduce((a, b) => (b.score > a.score ? b : a), options[0])?.node;
    }
    return { leader: L.heroId, decision, check, reason, checks, read, truth, confidence: Math.max(0.3, Math.min(0.97, confidence - rank.noise / 2)), next, options, disciplineBroken, namedSpotted };
  };

  const allowed = (i: number) => i < rank.checks;
  // 1. broken party
  checks[0] = 'pass';
  if (read.hp < hpT || (truth.fallen > 0 && read.hp < hpT + 0.1)) return result('retreat', 0, `Read the party at ${pct(read.hp)}. Too thin.`, 0.6 + (hpT - read.hp));
  // 2. torch
  checks[1] = 'pass';
  if (read.torch <= toExit + 1 + margin) return result('retreat', 1, `Torch reads ${Math.round(read.torch)}, and it's ${toExit} rooms back out.`, 0.75);
  // 3. streak (every rank asks; how it's answered depends on rank)
  checks[2] = 'pass';
  if (read.luck < LEADERSHIP.streakThreshold) {
    if (rank.readsVariance) {
      if (read.hp < 0.6 || namedSpotted) return result('retreat', 2, namedSpotted ? 'Signs of a Named ahead. Not today.' : "It isn't just bad dice. We're hurt.", 0.8);
    } else if (temper.streak === 'panic') return result('retreat', 2, 'Everything is going wrong. Run!', 0.55);
    else if (temper.streak === 'charge') return result('push', 2, 'They bloodied us. Now we bloody them!', 0.7);
  }
  // 4. pack
  if (allowed(3)) {
    checks[3] = 'pass';
    if (read.pack >= 0.85 && read.packValue >= 0.7 && greed < 0.8) return result('retreat', 3, 'The pack is full of good things. Bank it.', 0.7);
  }
  // 5. worth it?
  if (allowed(4)) {
    checks[4] = 'pass';
    const visible = options.map((o) => DANGER[o.type]);
    const threat = visible.length ? Math.min(...visible) : 0.5;
    const risk = 0.75 * (1 - read.hp) * (0.5 + threat) * (1 + 0.1 * truth.tier) + (namedSpotted ? LEADERSHIP.namedSignPenalty : 0);
    const reward = 0.35 * (1 + greed) * (1 - read.pack * 0.5) * (1 + 0.15 * (truth.floor - 1));
    const ev = reward - risk * (1 - push);
    if (ev < 0) return result('retreat', 4, `Not worth it: risk ${risk.toFixed(2)} against reward ${reward.toFixed(2)}.`, 0.6 + Math.min(0.3, -ev));
  }
  // 6. pick the room
  checks[5] = 'pass';
  const best = options.reduce((a, b) => (b.score > a.score ? b : a), options[0]);
  return result('push', 5, best ? `On to the ${best.type === '?' ? 'unknown room' : best.type}.` : 'Onward.', 0.5 + ((best?.pref ?? 0.5) - 0.5) * 0.6);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
