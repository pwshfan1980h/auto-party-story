// A whole Delve run (spec 07 + DESIGN §7): fogged floor maps, many battles on generated
// battlefields, the torch, the loot pack, Leader decisions, Hardcore permadeath, and the
// Delve Ledger.
import { CLASSES, ENEMIES, EVENTS, ITEMS, ITEMS_DATA, LEADERSHIP, PROGRESSION, RANKS, TIERS, DELVE, type EventDef } from './data';
const tierIndexOf = (t: string) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].indexOf(t) + 1;
const RUN_RULES = DELVE as unknown as { council: { bigRoomBelowHp: number; fuelSpare: number }; events: { riskWeight: number } };
import { FIGHT_TYPES, generateFloor, reveal, type FloorMap, type MapNode, type NodeType } from './delve';
import { buildEncounter } from './encounter';
import { LOOT } from './loot';
import { Fight, type FightResult, type FightSetup, type HeroSnapshot } from './fight';
import { decide, leaderProfile, type Decision, type Doctrine } from './leader';
import { stream } from './rng';
import type { RoomType } from './types';

export interface RunHero extends HeroSnapshot {
  leadership: number;
}

/**
 * How a headless run answers the Council's warnings (spec 07, 09):
 * - trust: always trust the Leader (the Leader baseline)
 * - cautious: on a serious observed warning, use Turn back (once per run) or This way (2 embers) if available
 * - orders: cautious, plus the good Player Order policy inside fights
 */
export type RunPolicy = 'trust' | 'cautious' | 'orders';

export interface RunWarning { kind: 'named' | 'mismatch' | 'returnFuel' | 'discipline' | 'bigRoom'; detail: string }

export interface RunSetup {
  seed: number;
  tier: string;
  party: RunHero[];
  leaderId: string;
  successorId?: string;
  doctrine?: Doctrine;
  torch?: number;
  packSlots?: number;
  policy?: RunPolicy;
  /** Start at a waystone: a floor of this tier already reached (defaults to the tier's first floor). */
  startFloor?: number;
  /** Keep each fight's setup on its ledger entry, so the game can replay the room. */
  record?: boolean;
  /** Extra torch fuel (a Torchwatch upgrade). */
  torchBonus?: number;
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
  /** Observed warnings before committing to this room, and how the policy answered them. */
  warnings?: RunWarning[];
  response?: 'trusted' | 'turned back' | 'this way';
  /** With `record`: the exact fight, replayable by re-simulating it. */
  fight?: FightSetup;
  /** An event room: what happened and what was chosen. */
  event?: { id: string; text: string; choice: string };
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
  policy: RunPolicy;
  warnings: number;
  turnBackUsed: boolean;
  thisWayUsed: number;
  embersSpent: number;
  fellBack: number;
  rares: { killed: number; escaped: number };
  calls: Record<string, number>;
  decisions: Decision[];
  ledger: LedgerEntry[];
  maps: FloorMap[];
  /** Equipment brought home (lost on a wipe). */
  found: string[];
  /** Per-hero end state, for the after-action report. */
  heroes: Record<string, { hp: number; maxHp: number; fell: boolean; carried: boolean; dealt: number; healed: number; kills: number }>;
}

interface HeroState { snap: RunHero; hp: number; maxHp: number; energy: number; alive: boolean; carried: boolean; dealt: number; healed: number; kills: number }


/**
 * What a delve asks of whoever is driving it. The headless sim answers with bots (runRun);
 * the game answers with the player: fights are played live, warnings go to the Council.
 */
export type DelveRequest =
  | { kind: 'fight'; setup: FightSetup; entry: LedgerEntry; maps: FloorMap[] }
  | { kind: 'between'; floor: number; node: number; canTurnBack: boolean }
  | { kind: 'council'; warnings: RunWarning[]; call: Decision; floor: number; target: number; safer: number[]; embers: number; thisWayOpen: boolean; turnBackOpen: boolean; maps: FloorMap[] }
  | { kind: 'room'; entry: LedgerEntry; maps: FloorMap[] }
  | { kind: 'event'; event: EventDef; open: number[]; suggested: number; entry: LedgerEntry; maps: FloorMap[] };
export type CouncilAnswer = 'trust' | 'turn back' | { thisWay: number };
export type DelveAnswer = FightResult | CouncilAnswer | 'go' | 'turn back' | number | undefined;

/** A whole Delve run, played headlessly with the policy's bots. */
export function runRun(setup: RunSetup): RunResult {
  const policy: RunPolicy = setup.policy ?? 'trust';
  const steps = delveSteps(setup);
  let answer: DelveAnswer;
  let turnedBack = false;
  for (;;) {
    const step = steps.next(answer);
    if (step.done) return step.value;
    const q = step.value;
    answer = undefined;
    if (q.kind === 'fight') answer = new Fight(q.setup).run();
    else if (q.kind === 'between') answer = 'go';
    else if (q.kind === 'event') answer = q.suggested;
    else if (q.kind === 'council') {
      // the bots: trust always trusts; cautious and orders steer around serious warnings when they can
      const serious = q.warnings.some((w) => w.kind !== 'discipline' && w.kind !== 'bigRoom');
      if (policy === 'trust' || !serious) answer = 'trust';
      else if (q.safer.length && q.embers >= 2 && q.thisWayOpen) answer = { thisWay: q.safer[0] };
      else if (q.turnBackOpen && !turnedBack) { turnedBack = true; answer = 'turn back'; }
      else answer = 'trust';
    }
  }
}

/** The run as a sequence of steps that pause for fights and decisions. */
export function* delveSteps(setup: RunSetup): Generator<DelveRequest, RunResult, DelveAnswer> {
  const tier = TIERS[setup.tier];
  const tierIndex = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].indexOf(setup.tier) + 1;
  const rng = stream(setup.seed, 'run');
  // equipment drops roll on their own dice, so they never shift anything else
  const itemRng = stream(setup.seed, 'items');
  const found: string[] = [];
  const dropPool = Object.entries(ITEMS).filter(([, it]) => it.tier <= tierIndexOf(setup.tier)).map(([id]) => id);
  const rollItems = (rolls: number, entry: LedgerEntry) => {
    for (let i = 0; i < rolls; i++) if (dropPool.length && itemRng.next() < ITEMS_DATA.dropChance) {
      const id = dropPool[Math.floor(itemRng.next() * dropPool.length)];
      found.push(id);
      entry.gained.push(`found ${ITEMS[id].name}`);
    }
  };
  const leaderRng = stream(setup.seed, 'leader');
  const slots = setup.packSlots ?? 8;
  // the party brings torches for the planned depth (the Market sells them in the full game)
  // a waystone skips the floors above it; the party packs torches for the floors left
  const first = Math.max(tier.floors[0], Math.min(tier.floors[1], setup.startFloor ?? tier.floors[0]));
  const floorCount = Math.min(tier.floorsPerRun, tier.floors[1] - first + 1);
  let torch = setup.torch ?? DELVE.torch.base + DELVE.torch.perFloor * floorCount + (setup.torchBonus ?? 0);
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
  const policy: RunPolicy = setup.policy ?? 'trust';
  let embers = 3;
  const EMBER_CAP = 3;
  let embersSpent = 0, warnCount = 0, thisWayUsed = 0, fellBack = 0, raresKilled = 0, raresEscaped = 0;
  let turnBackUsed = false;
  let thisWayFloor = -1;
  const callCounts: Record<string, number> = {};

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

  function* fightRoom(n: MapNode, fl: number, entry: LedgerEntry, ambush = false): Generator<DelveRequest, 'won' | 'lost' | 'fled', DelveAnswer> {
    const roomType: RoomType = n.type === 'elite' || n.type === 'horde' || n.type === 'boss' ? n.type : 'normal';
    const dark = torch <= 0 || ambush;
    const monsters = buildEncounter(setup.tier, roomType, fl + (dark ? 2 : 0), stream(setup.seed, 'enc', fl, n.id), n.named);
    ensureLeader();
    const lh = heroes.get(leaderId)!;
    const LP = leaderProfile({ id: lh.snap.id, name: lh.snap.name, raceId: lh.snap.raceId, leadership: lh.snap.leadership });
    if (n.named) { namedMet++; entry.named = n.named; }
    const team = active();
    const before = team.map((h) => (h.hp < 0 ? 1 : h.hp / h.maxHp));
    const fightSetup: FightSetup = {
      seed: setup.seed, key: [fl, n.id], tier: setup.tier, roomType,
      heroes: team.map((h) => ({ ...h.snap, hp: h.hp < 0 ? undefined : h.hp, energy: h.energy })),
      monsters,
      leader: { heroId: lh.snap.id, rank: LP.rank.id as 'novice', noise: LP.rank.noise, temperament: LP.temperament },
      embers,
      orderPolicy: policy === 'orders' ? 'good' : 'none',
    };
    if (setup.record) entry.fight = fightSetup;
    const r = (yield { kind: 'fight', setup: fightSetup, entry, maps }) as FightResult;
    embersSpent += Math.max(0, embers - r.embersLeft);
    embers = r.embersLeft;
    for (const [k, v] of Object.entries(r.calls)) callCounts[k] = (callCounts[k] ?? 0) + v;
    raresEscaped += r.escaped.length;
    if (r.escaped.length) entry.lost.push(`a Rare got away`);
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
    if (r.result === 'fled') {
      // Fall back!: the party got out, at the cost of one pack item and a torch's worth of fuel
      fellBack++;
      entry.result = 'lost';
      for (const h of heroes.values()) if (h.alive && h.carried) { h.alive = false; entry.lost.push(`${h.snap.name} was left behind`); }
      if (pack.length) { const v = pack.splice(Math.floor(rng.next() * pack.length), 1)[0]; lostValue += v; entry.lost.push(`dropped item (${v}) in the retreat`); }
      torch = Math.max(0, torch - 1);
      return 'fled';
    }
    if (r.result !== 'victory') {
      entry.result = 'lost';
      for (const h of heroes.values()) if (h.alive) { h.alive = false; if (!entry.lost.includes(`${h.snap.name} fell`)) entry.lost.push(`${h.snap.name} fell`); }
      lostValue += pack.reduce((s, v) => s + v, 0);
      entry.lost.push(`the whole pack (${pack.length} items)`);
      pack.length = 0;
      return 'lost';
    }
    fightsWon++;
    embers = Math.min(EMBER_CAP, embers + 1);
    const rareKills = r.units.filter((u) => u.team === 1 && !u.alive && monsters.some((m) => m.rare && u.defId === m.enemyId) && !r.escaped.includes(u.id)).length;
    if (rareKills) { raresKilled += rareKills; addLoot(2 * rareKills, 20 * fl, entry.gained, entry.lost); entry.gained.push('Rare spoils'); }
    // field dressing between rooms: survivors patch up, more with a healer along
    const medic = active().some((h) => (CLASSES[h.snap.classId].roles.heal ?? 0) >= 2);
    for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (medic ? 0.2 : 0.1));
    entry.result = 'won';
    let gainedXp = 0;
    for (const m of monsters) { const rk = RANKS[m.rank ?? ENEMIES[m.enemyId].rank ?? 'normal']; gainedXp += PROGRESSION.killXpPerLevel * m.level * rk.xp; }
    gainedXp *= 1 + PROGRESSION.roomClearBonus;
    xp += Math.round(gainedXp);
    entry.gained.push(`${Math.round(gainedXp)} XP`);
    const loot = LOOT[n.type] ?? LOOT.fight!;
    addLoot(loot[0] + (n.named ? 3 : 0), loot[1] * fl, entry.gained, entry.lost);
    rollItems(loot[0] + (n.named ? 3 : 0), entry);
    return 'won';
  }

  /** Walk home through cleared rooms (free from a campfire). Each room costs torch; in the dark the way back is ambushed. */
  function* walkHome(node: MapNode, fl: number, home: number, entry: LedgerEntry): Generator<DelveRequest, RunResult['outcome'], DelveAnswer> {
    torch -= home;
    const ambushes = torch < 0 ? Math.ceil(-torch / 2) : 0;
    if (ambushes) entry.lost.push(`the torch died on the way back: ${ambushes} ambush${ambushes > 1 ? 'es' : ''}`);
    torch = Math.max(0, torch);
    for (let a = 0; a < ambushes; a++) {
      const res = yield* fightRoom({ ...node, id: 900 + a, type: 'fight', named: undefined }, fl, entry, true);
      if (res === 'lost') return 'wipe';
    }
    return 'retreat';
  }

  for (let f = 0; f < floorCount && !outcome; f++) {
    const floor = Math.min(tier.floors[1], first + f);
    const last = f === floorCount - 1;
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
      const call = decide(L, { hp: partyHp(), fallen: fallen(), torch, pack: pack.length / slots, packValue: Math.min(1, packValue), luck: luck(), tier: tierIndex, floor, roomsHome: home, tierId: setup.tier, packRaw: pack.reduce((s2, v) => s2 + v, 0), heroes: active().length, heroLevel: TIERS[setup.tier].heroLevel, partyLevel: active().reduce((a, h) => a + (h.snap.level ?? 1), 0) / Math.max(1, active().length) }, map, at, leaderRng, setup.doctrine);
      decisions.push(call);
      if (call.namedSpotted) namedSpotted++;
      if (call.decision === 'retreat') call.goodCall = partyHp() < 0.4 || pack.length / slots >= 0.7 || torch <= home + 2 || fallen() > 0;
      if (call.decision === 'retreat') {
        const entry: LedgerEntry = { floor, node: at, room: node.type, result: 'passed', secs: 0, gained: [], lost: [], call };
        ledger.push(entry);
        outcome = yield* walkHome(node, floor, home, entry);
        yield { kind: 'room', entry, maps };
        break;
      }
      if (call.next === undefined) break;
      // the player's one emergency Turn back, between rooms
      if (!turnBackUsed && (yield { kind: 'between', floor, node: at, canTurnBack: true }) === 'turn back') {
        turnBackUsed = true;
        const entry: LedgerEntry = { floor, node: at, room: node.type, result: 'passed', secs: 0, gained: [], lost: [], call, response: 'turned back' };
        ledger.push(entry);
        outcome = yield* walkHome(node, floor, home, entry);
        yield { kind: 'room', entry, maps };
        break;
      }
      // Warnings the player can observe before committing (spec 07): never hidden contents, only signs and known facts.
      let target = call.next;
      const observe = (id: number): RunWarning[] => {
        const n = map.nodes[id], w: RunWarning[] = [];
        if (n.named && n.seen) w.push({ kind: 'named', detail: 'claw marks and an unnatural silence' });
        const big = n.known && (n.type === 'elite' || n.type === 'horde' || n.type === 'boss');
        if (big && partyHp() < RUN_RULES.council.bigRoomBelowHp) w.push({ kind: 'mismatch', detail: `${n.type === 'elite' ? 'an' : 'a'} ${n.type} room with the party at ${Math.round(partyHp() * 100)}%` });
        else if (big) w.push({ kind: 'bigRoom', detail: `${n.type === 'boss' ? 'the boss' : `a${n.type === 'elite' ? 'n' : ''} ${n.type}`} ahead` });
        if (torch - 1 <= roomsHome + RUN_RULES.council.fuelSpare) w.push({ kind: 'returnFuel', detail: `torch ${torch} with ${roomsHome + 1} rooms back` });
        if (fallen() > 0) w.push({ kind: 'mismatch', detail: `pressing on with ${fallen()} of the party down` });
        return w;
      };
      const warnings = observe(target);
      if (call.disciplineBroken) warnings.push({ kind: 'discipline', detail: 'the Leader ignored the Standing Orders' });
      let response: LedgerEntry['response'];
      if (warnings.length) {
        warnCount++;
        response = 'trusted';
        // the Council: the Leader's call and its warnings, put to whoever is watching
        const safer = call.options.map((o) => o.node).filter((id) => id !== target && observe(id).length === 0 && map.nodes[id].known);
        const answer = (yield { kind: 'council', warnings, call, floor, target, safer, embers, thisWayOpen: thisWayFloor !== floor, turnBackOpen: !turnBackUsed, maps }) as CouncilAnswer;
        if (typeof answer === 'object' && safer.includes(answer.thisWay) && embers >= 2 && thisWayFloor !== floor) {
          target = answer.thisWay; embers -= 2; embersSpent += 2; thisWayUsed++; thisWayFloor = floor; response = 'this way';
        } else if (answer === 'turn back' && !turnBackUsed) {
          turnBackUsed = true; response = 'turned back';
          const entry: LedgerEntry = { floor, node: at, room: node.type, result: 'passed', secs: 0, gained: [], lost: [], call, warnings, response };
          ledger.push(entry);
          outcome = yield* walkHome(node, floor, home, entry);
          yield { kind: 'room', entry, maps };
          break;
        }
      }
      at = target;
      const next = map.nodes[at];
      next.visited = true;
      torch = Math.max(0, torch - 1);
      rooms++;
      roomsHome++;
      const entry: LedgerEntry = { floor, node: at, room: next.type, named: next.named, result: 'passed', secs: 0, gained: [], lost: [], call, warnings: warnings.length ? warnings : undefined, response };
      ledger.push(entry);
      if (FIGHT_TYPES.has(next.type) || next.named) {
        const res = yield* fightRoom(next, floor, entry);
        call.goodCall = res === 'won' && !entry.lost.some((l) => l.includes('fell') || l.includes('Downed'));
        if (res === 'lost') { outcome = 'wipe'; yield { kind: 'room', entry, maps }; break; }
        if (res === 'fled') { outcome = yield* walkHome(next, floor, roomsHome, entry); yield { kind: 'room', entry, maps }; break; }
        if (next.type === 'boss') { outcome = 'cleared'; yield { kind: 'room', entry, maps }; break; }
      } else if (next.type === 'campfire') {
        // a campfire is a way out: from here on, the way home is measured from this fire
        roomsHome = 0;
        embers = Math.min(EMBER_CAP, embers + 1);
        for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.25);
        entry.gained.push('rest (+25% HP)');
      } else if (next.type === 'treasure') {
        addLoot(2, 14 * floor, entry.gained, entry.lost);
        rollItems(3, entry);
      } else if (next.type === 'shrine') {
        for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.1);
        entry.gained.push('blessing (+10% HP)');
      } else if (next.type === 'event') {
        // an event: a choice, put to the player (or made by the Leader's temperament), then a roll
        const ev = rng.pick(EVENTS);
        const open = ev.choices.map((_, i) => i).filter((i) => !ev.choices[i].needsPack || pack.length > 0);
        const temper = leaderProfile({ id: leaderId, name: '', raceId: heroes.get(leaderId)!.snap.raceId, leadership: heroes.get(leaderId)!.snap.leadership }).temper;
        // a gamble weighs more the more hurt the party is; bold temperaments shrug a little of it off
        const score = (i: number) => ev.choices[i].reward * (0.6 + temper.greed) - ev.choices[i].risk * (RUN_RULES.events.riskWeight - partyHp() - temper.pushBias);
        const suggested = open.reduce((a, b) => (score(b) > score(a) ? b : a));
        const asked = (yield { kind: 'event', event: ev, open, suggested, entry, maps }) as number;
        const choice = ev.choices[open.includes(asked) ? asked : suggested];
        entry.event = { id: ev.id, text: ev.text, choice: choice.label };
        let roll = rng.next(), o = choice.outcomes[choice.outcomes.length - 1];
        for (const x of choice.outcomes) { if (roll < x.chance) { o = x; break; } roll -= x.chance; }
        if (o.say) entry.gained.push(o.say);
        if (o.loot) addLoot(o.loot.items, o.loot.each * floor, entry.gained, entry.lost);
        if (o.heal) { for (const h of active()) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * o.heal.pct); entry.gained.push(`+${Math.round(o.heal.pct * 100)}% HP`); }
        if (o.hurt) { for (const h of active()) h.hp = Math.max(1, h.hp - h.maxHp * o.hurt.pct); entry.lost.push(`−${Math.round(o.hurt.pct * 100)}% HP`); }
        if (o.torch) { torch = Math.max(0, torch + o.torch.n); (o.torch.n > 0 ? entry.gained : entry.lost).push(`${o.torch.n > 0 ? '+' : '−'}${Math.abs(o.torch.n)} torch`); }
        if (o.embers) { embers = Math.min(EMBER_CAP, embers + o.embers.n); entry.gained.push(`+${o.embers.n} ember`); }
        if (o.xp) { xp += o.xp.n * floor; entry.gained.push(`${o.xp.n * floor} XP`); }
        if (o.dropItem && pack.length) { for (let k = 0; k < o.dropItem.n && pack.length; k++) { const v = pack.splice(pack.indexOf(Math.min(...pack)), 1)[0]; entry.lost.push(`offered item (${v})`); } }
        if (o.reveal) { for (const n of map.nodes) { n.seen = true; n.known = true; } entry.gained.push('the floor revealed'); }
        if (o.ambush) {
          const res = yield* fightRoom({ ...next, type: o.ambush.room === 'elite' ? 'elite' : 'fight' }, floor, entry, false);
          if (res === 'lost') { outcome = 'wipe'; yield { kind: 'room', entry, maps }; break; }
          if (res === 'fled') { outcome = yield* walkHome(next, floor, roomsHome, entry); yield { kind: 'room', entry, maps }; break; }
        }
      }
      yield { kind: 'room', entry, maps };
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
    policy, warnings: warnCount, turnBackUsed, thisWayUsed, embersSpent, fellBack, rares: { killed: raresKilled, escaped: raresEscaped }, calls: callCounts,
    decisions, ledger, maps, found: outcome === 'wipe' ? [] : found,
    heroes: Object.fromEntries(all.map((h) => [h.snap.id, { hp: Math.round(Math.max(0, h.hp)), maxHp: h.maxHp, fell: !h.alive, carried: h.carried, dealt: h.dealt, healed: h.healed, kills: h.kills }])),
  };
}

const LEADERSHIP_EXPECTED = LEADERSHIP.expectedHpLossPerFight;
