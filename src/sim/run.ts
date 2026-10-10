// A whole Delve run (spec 07 + DESIGN §7): fogged floor maps, many battles on generated
// battlefields, the torch, the loot pack, Leader decisions, Hardcore permadeath, and the
// Delve Ledger.
import { CLASSES, ENEMIES, LEADERSHIP, RANKS, TIERS } from './data';
import { FIGHT_TYPES, generateFloor, reveal, type FloorMap, type MapNode, type NodeType } from './delve';
import { buildEncounter } from './encounter';
import { Fight, type FightResult, type HeroSnapshot } from './fight';
import { decide, leaderProfile, type Decision, type Doctrine } from './leader';
import { stream } from './rng';
import type { RoomType } from './types';

export interface RunHero extends HeroSnapshot {
  leadership: number;
}

export interface RunSetup {
  seed: number;
  tier: string;
  party: RunHero[];
  leaderId: string;
  successorId?: string;
  doctrine?: Doctrine;
  torch?: number;
  packSlots?: number;
}

export interface LedgerEntry {
  floor: number;
  node: number;
  room: NodeType;
  named?: string;
  result: 'won' | 'lost' | 'passed';
  secs: number;
  mvp?: string;
  gained: string[];
  lost: string[];
  call?: Decision;
}

export interface RunResult {
  outcome: 'cleared' | 'retreat' | 'wipe';
  tier: string;
  floorsReached: number;
  rooms: number;
  fights: number;
  fightsWon: number;
  fightSeconds: number;
  died: string[];
  carried: string[];
  leaderDied: boolean;
  xp: number;
  pack: { items: number; value: number };
  banked: number;
  lostValue: number;
  namedMet: number;
  namedSpotted: number;
  decisions: Decision[];
  ledger: LedgerEntry[];
  maps: FloorMap[];
  /** Per-hero end state, for the after-action report. */
  heroes: Record<string, { hp: number; maxHp: number; fell: boolean; carried: boolean; dealt: number; healed: number; kills: number }>;
}

interface HeroState { snap: RunHero; hp: number; maxHp: number; energy: number; alive: boolean; carried: boolean; dealt: number; healed: number; kills: number }

const LOOT: Partial<Record<NodeType, [number, number]>> = { fight: [1, 10], elite: [2, 16], horde: [3, 14], boss: [4, 30], treasure: [2, 14], event: [1, 8] };

export function runRun(setup: RunSetup): RunResult {
  const tier = TIERS[setup.tier];
  const tierIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].indexOf(setup.tier) + 1;
  const rng = stream(setup.seed, 'run');
  const leaderRng = stream(setup.seed, 'leader');
  const slots = setup.packSlots ?? 8;
  // the party brings torches for the planned depth (the Market sells them in the full game)
  let torch = setup.torch ?? 8 + 5 * tier.floorsPerRun;
  const heroes = new Map<string, HeroState>(setup.party.map((h) => [h.id, { snap: h, hp: -1, maxHp: -1, energy: 0, alive: true, carried: false, dealt: 0, healed: 0, kills: 0 }]));
  let leaderId = setup.leaderId;
  let leaderDied = false;
  const pack: number[] = [];
  let lostValue = 0;
  let xp = 0;
  const ledger: LedgerEntry[] = [];
  const decisions: Decision[] = [];
  const maps: FloorMap[] = [];
  const hpLoss: number[] = [];
  let fights = 0, fightsWon = 0, fightSeconds = 0, rooms = 0, namedMet = 0, namedSpotted = 0;
  let outcome: RunResult['outcome'] | null = null;
  let floorsReached = 0;
  /** Rooms walked since the entrance: the way home, unless a campfire offers a shortcut. */
  let roomsHome = 0;

  const active = () => [...heroes.values()].filter((h) => h.alive && !h.carried);
  const partyHp = () => {
    const all = [...heroes.values()].filter((h) => h.alive);
    if (!all.length) return 0;
    return all.reduce((s, h) => s + (h.carried ? 0 : h.maxHp > 0 ? h.hp / h.maxHp : 1), 0) / all.length;
  };
  const fallen = () => [...heroes.values()].filter((h) => !h.alive || h.carried).length;
  const luck = () => {
    const last = hpLoss.slice(-3);
    if (!last.length) return 0;
    const exp = LEADERSHIP_EXPECTED;
    return Math.max(-1, Math.min(1, last.reduce((s, l) => s + (exp - l) / exp, 0) / last.length));
  };
  const addLoot = (items: number, each: number, gained: string[], lost: string[]) => {
    for (let i = 0; i < items; i++) {
      const v = Math.round(each * (0.6 + rng.next() * 0.8));
      if (pack.length < slots) { pack.push(v); gained.push(`item (${v})`); }
      else {
        const min = Math.min(...pack);
        if (v > min) { pack.splice(pack.indexOf(min), 1, v); lostValue += min; gained.push(`item (${v})`); lost.push(`dropped item (${min})`); }
        else { lostValue += v; lost.push(`left item (${v})`); }
      }
    }
  };
  const ensureLeader = () => {
    const l = heroes.get(leaderId);
    if (l && l.alive && !l.carried) return;
    leaderDied = leaderDied || !!(l && !l.alive);
    const succ = setup.successorId && heroes.get(setup.successorId);
    const next = succ && succ.alive && !succ.carried ? succ : active().sort((a, b) => b.snap.leadership - a.snap.leadership)[0];
    if (next) leaderId = next.snap.id;
  };

  function fightRoom(n: MapNode, fl: number, entry: LedgerEntry, ambush = false): boolean {
    const roomType: RoomType = n.type === 'elite' || n.type === 'horde' || n.type === 'boss' ? n.type : 'normal';
    const dark = torch <= 0 || ambush;
    const monsters = buildEncounter(setup.tier, roomType, fl + (dark ? 2 : 0), stream(setup.seed, 'enc', fl, n.id), n.named);
    if (n.named) { namedMet++; entry.named = n.named; }
    const team = active();
    const before = team.map((h) => (h.hp < 0 ? 1 : h.hp / h.maxHp));
    const fight = new Fight({
      seed: setup.seed, key: [fl, n.id], tier: setup.tier, roomType,
      heroes: team.map((h) => ({ ...h.snap, hp: h.hp < 0 ? undefined : h.hp, energy: h.energy })),
      monsters,
    });
    const r: FightResult = fight.run();
    fights++;
    fightSeconds += r.duration;
    entry.secs = r.duration;
    const byId = new Map(r.units.map((u) => [u.id, u]));
    let mvp: { id: string; dealt: number } | undefined;
    for (const h of team) {
      const u = byId.get(h.snap.id)!;
      h.maxHp = u.maxHp;
      h.hp = u.hp;
      h.energy = u.energy * 0.5;
      h.dealt += u.dealt; h.healed += u.healed; h.kills += u.kills;
      if (!mvp || u.dealt + u.healed > mvp.dealt) mvp = { id: h.snap.id, dealt: u.dealt + u.healed };
      if (!u.alive) { h.alive = false; entry.lost.push(`${h.snap.name} fell`); }
      else if (u.downed) { h.carried = true; h.hp = 0; entry.lost.push(`${h.snap.name} Downed, carried out`); }
    }
    entry.mvp = mvp?.id;
    const after = team.map((h) => (h.alive && !h.carried ? h.hp / h.maxHp : 0));
    hpLoss.push(before.reduce((s, b, i) => s + Math.max(0, b - after[i]), 0) / team.length);
    if (r.result !== 'victory') {
      entry.result = 'lost';
      for (const h of heroes.values()) if (h.alive) { h.alive = false; if (!entry.lost.includes(`${h.snap.name} fell`)) entry.lost.push(`${h.snap.name} fell`); }
      lostValue += pack.reduce((s, v) => s + v, 0);
      entry.lost.push(`the whole pack (${pack.length} items)`);
      pack.length = 0;
      return false;
    }
    fightsWon++;
    // field dressing between rooms: survivors patch up, more with a healer along
    const medic = active().some((h) => (CLASSES[h.snap.classId].roles.heal ?? 0) >= 2);
    for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (medic ? 0.2 : 0.1));
    entry.result = 'won';
    let gainedXp = 0;
    for (const m of monsters) { const rk = RANKS[m.rank ?? ENEMIES[m.enemyId].rank ?? 'normal']; gainedXp += 6 * m.level * rk.xp; }
    xp += Math.round(gainedXp);
    entry.gained.push(`${Math.round(gainedXp)} XP`);
    const loot = LOOT[n.type] ?? LOOT.fight!;
    addLoot(loot[0] + (n.named ? 3 : 0), loot[1] * fl, entry.gained, entry.lost);
    return true;
  }

  for (let f = 0; f < tier.floorsPerRun && !outcome; f++) {
    const floor = Math.min(tier.floors[1], tier.floors[0] + f);
    const last = f === tier.floorsPerRun - 1;
    const map = generateFloor(setup.seed, setup.tier, floor, last);
    maps.push(map);
    floorsReached = floor;
    let at = 0;
    map.nodes[0].visited = true;
    for (;;) {
      ensureLeader();
      const leader = heroes.get(leaderId)!;
      const L = leaderProfile({ id: leader.snap.id, name: leader.snap.name, raceId: leader.snap.raceId, leadership: leader.snap.leadership });
      reveal(map, at, L.rank.vision + (L.temper.visionBonus ?? 0), L.rank.knowsTypes);
      const node = map.nodes[at];
      if (node.type === 'stairs') break;
      if (node.type === 'boss') break;
      const packValue = pack.reduce((s, v) => s + v, 0) / (slots * 20);
      const home = node.type === 'campfire' ? 0 : roomsHome;
      const call = decide(L, { hp: partyHp(), fallen: fallen(), torch, pack: pack.length / slots, packValue: Math.min(1, packValue), luck: luck(), tier: tierIndex, floor, roomsHome: home }, map, at, leaderRng, setup.doctrine);
      decisions.push(call);
      if (call.namedSpotted) namedSpotted++;
      if (call.decision === 'retreat') {
        // Walk home through cleared rooms (free from a campfire). Each room costs torch; in the dark, the way back is ambushed.
        const entry: LedgerEntry = { floor, node: at, room: node.type, result: 'passed', secs: 0, gained: [], lost: [], call };
        ledger.push(entry);
        torch -= home;
        const ambushes = torch < 0 ? Math.ceil(-torch / 2) : 0;
        if (ambushes) entry.lost.push(`the torch died on the way back: ${ambushes} ambush${ambushes > 1 ? 'es' : ''}`);
        torch = Math.max(0, torch);
        let survived = true;
        for (let a = 0; a < ambushes && survived; a++) survived = fightRoom({ ...node, id: 900 + a, type: 'fight', named: undefined }, floor, entry, true);
        outcome = survived ? 'retreat' : 'wipe';
        break;
      }
      if (call.next === undefined) break;
      at = call.next;
      const next = map.nodes[at];
      next.visited = true;
      torch = Math.max(0, torch - 1);
      rooms++;
      roomsHome++;
      const entry: LedgerEntry = { floor, node: at, room: next.type, named: next.named, result: 'passed', secs: 0, gained: [], lost: [], call };
      ledger.push(entry);
      if (FIGHT_TYPES.has(next.type) || next.named) {
        const res = fightRoom(next, floor, entry);
        if (!res) { outcome = 'wipe'; break; }
        if (next.type === 'boss') { outcome = 'cleared'; break; }
      } else if (next.type === 'campfire') {
        for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.25);
        entry.gained.push('rest (+25% HP)');
      } else if (next.type === 'treasure') {
        addLoot(2, 14 * floor, entry.gained, entry.lost);
      } else if (next.type === 'shrine') {
        for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1);
        entry.gained.push('blessing (+10% HP)');
      } else if (next.type === 'event') {
        const r = rng.next();
        if (r < 0.5) addLoot(1, 8 * floor, entry.gained, entry.lost);
        else if (r < 0.8) { for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1); entry.gained.push('a kind stranger (+10% HP)'); }
        else { for (const h of active()) h.hp = Math.max(1, h.hp - h.maxHp * 0.1); entry.lost.push('a trap (−10% HP)'); }
      }
      if (next.type === 'stairs') break;

    }
  }
  if (!outcome) outcome = 'retreat';
  const banked = outcome === 'wipe' ? 0 : pack.reduce((s, v) => s + v, 0);
  const all = [...heroes.values()];
  return {
    outcome, tier: setup.tier, floorsReached, rooms, fights, fightsWon, fightSeconds: Math.round(fightSeconds),
    died: all.filter((h) => !h.alive).map((h) => h.snap.id),
    carried: all.filter((h) => h.alive && h.carried).map((h) => h.snap.id),
    leaderDied, xp, pack: { items: pack.length, value: banked }, banked, lostValue, namedMet, namedSpotted,
    decisions, ledger, maps,
    heroes: Object.fromEntries(all.map((h) => [h.snap.id, { hp: Math.round(Math.max(0, h.hp)), maxHp: h.maxHp, fell: !h.alive, carried: h.carried, dealt: h.dealt, healed: h.healed, kills: h.kills }])),
  };
}

const LEADERSHIP_EXPECTED = LEADERSHIP.expectedHpLossPerFight;
