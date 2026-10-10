// The Leader's run decisions (spec 07): perception with noise, the ordered decision tree,
// route choice on the fogged map, and everything the Council view needs to show the call.
import { BASELINES, LEADERSHIP, RACES, TIERS, type BaselineRow, type LeaderRankDef, type TemperamentDef } from './data';
import { lootValue } from './loot';
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
  /** For expected-value planning (Seasoned+). */
  tierId?: string;
  packRaw?: number;
  heroes?: number;
  heroLevel?: number;
  /** The party's average level, so Leaders credit a party that outlevels the tier. */
  partyLevel?: number;
}

const FIGHT_ROOM: Partial<Record<NodeType | '?', string>> = { fight: 'normal', elite: 'elite', horde: 'horde', boss: 'boss', '?': 'normal' };

/** What a Leader puts on losing one hero for good: their training, with a floor for the cost of replacing them. */
function heroValueOf(s: PartyState): number {
  const ev = LEADERSHIP.ev;
  return Math.max(ev.heroValueFloor, ev.heroValuePerLevel * (s.heroLevel ?? 2));
}

/** Baseline for a room at a party HP level, interpolated between measured rows. */
function baseline(tier: string, type: NodeType | '?', hp: number): BaselineRow {
  const room = FIGHT_ROOM[type];
  const rows = room && BASELINES[tier]?.[room];
  if (!rows) return { hp, win: 1, hpCost: 0, deaths: 0 };
  if (hp <= rows[0].hp) return rows[0];
  for (let i = 1; i < rows.length; i++) if (hp <= rows[i].hp) {
    const a = rows[i - 1], b = rows[i], k = (hp - a.hp) / (b.hp - a.hp);
    return { hp, win: a.win + (b.win - a.win) * k, hpCost: a.hpCost + (b.hpCost - a.hpCost) * k, deaths: a.deaths + (b.deaths - a.deaths) * k };
  }
  return rows[rows.length - 1];
}

/**
 * Expected value of entering a room (spec 07, rank-dependent): loot and XP gained if the party wins, minus
 * the pack lost on a wipe and the heroes expected to die for good. Better Leaders estimate it more truly
 * (Seasoned are optimistic) and look further ahead (Veteran 1 room, Master 2).
 */
function roomEV(L: LeaderProfile, s: PartyState, map: FloorMap, id: number, hp: number, depth: number, greed: number): number {
  const ev = LEADERSHIP.ev;
  const n = map.nodes[id];
  const type: NodeType | '?' = n.known ? n.type : '?';
  let b = baseline(s.tierId ?? 'I', type, hp);
  const opt = ev.optimism[L.rank.id] ?? 0;
  if (opt) b = { ...b, win: b.win + (1 - b.win) * opt, deaths: b.deaths * (1 - opt) };
  // the table is measured at the tier's hero level against monsters from its first floor: each level of
  // advantage shrinks the risk, and each floor deeper (monsters a level stronger) grows it
  const t = TIERS[s.tierId ?? 'I'];
  const deeper = t ? Math.max(0, s.floor - (t.floors[0] + 1)) : 0;
  const gap = Math.max(-6, Math.min(8, (s.partyLevel ?? s.heroLevel ?? 2) - (s.heroLevel ?? 2) - deeper));
  if (gap) { const k = Math.pow(ev.levelFactor, gap); b = { ...b, win: 1 - (1 - b.win) * k, deaths: Math.min(1, b.deaths * k) }; }
  const heroValue = heroValueOf(s);
  const heroes = s.heroes ?? 3;
  // with a full pack, new loot is only worth the upgrades it brings
  const gain = lootValue(type, s.floor) * (0.6 + greed) * b.win * (s.pack >= 1 ? ev.fullPackShare : 1);
  // losing the fight can end the whole party: experienced Leaders weigh that beyond its average cost
  const loss = (1 - b.win) * ((s.packRaw ?? 0) + ev.wipeAversion * heroes * heroValue) + b.deaths * heroes * heroValue + (n.named && n.seen ? heroValue * heroes * 0.5 : 0);
  let value = gain - loss;
  if (type === 'campfire') value += (1 - hp) * heroValue * 0.3;
  if (depth > 0 && n.known) {
    const hpAfter = Math.max(0.05, Math.min(1, hp - b.hpCost + ev.dressing + (type === 'campfire' ? 0.25 : type === 'shrine' ? 0.1 : 0)));
    const next = n.next.filter((c) => map.nodes[c].seen).map((c) => roomEV(L, s, map, c, hpAfter, depth - 1, greed));
    if (next.length) value += ev.discount * Math.max(0, ...next);
  }
  return value;
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
  const planner = L.rank.id !== 'novice';
  const depth = LEADERSHIP.ev.lookahead[L.rank.id] ?? 0;
  const options = here.next.map((id) => {
    const n = map.nodes[id];
    const type: NodeType | '?' = n.known ? n.type : '?';
    if (planner) {
      // Seasoned+ Leaders weigh each room by expected value, as well as their rank lets them read it
      // misjudgement scales with what's at stake: the party's lives
      const stake = heroValueOf(truth) * (truth.heroes ?? 3);
      const score = (roomEV(L, truth, map, id, read.hp, depth, greed) + rank.noise * LEADERSHIP.ev.noiseScale * stake * (rng.next() - 0.5) * 2) / 100;
      return { node: id, type, score, pref: 0 };
    }
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
  // under the depth doctrine the party is here for the boss, not the loot
  if (allowed(3) && !planner && doc !== 'depth') {
    checks[3] = 'pass';
    if (read.pack >= 0.85 && read.packValue >= 0.7 && greed < 0.8) return result('retreat', 3, 'The pack is full of good things. Bank it.', 0.7);
  }
  // 5. worth it? Planners compare the best room's expected value with banking now.
  if (allowed(4) && planner) {
    checks[4] = 'pass';
    const best = Math.max(...options.map((o) => o.score)) * 100;
    // a standing order to push accepts real risk, measured in heroes rather than coin
    const marginEv = (LEADERSHIP.ev.doctrineMargin[doc] ?? 0) - (LEADERSHIP.ev.doctrineHeroRisk[doc] ?? 0) * heroValueOf(truth);
    if (best < marginEv - push * 40) return result('retreat', 4, `Not worth it: the best room ahead is worth ${Math.round(best)} against what we'd risk.`, 0.65);
  } else if (allowed(4)) {
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
