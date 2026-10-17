// The save file: one persistent Torchwatch per save (DESIGN §7b), kept in the browser.
import namesJson from '../../data/names.json';
import campJson from '../../data/camp.json';
import { CLASSES, PROGRESSION, RACES, TIERS } from '../sim/data';
import { stream } from '../sim/rng';
import { ZONE, type RosterHero } from '../sim/roster';
import { ITEMS } from '../sim/data';
import { canEquip } from '../sim/items';
import type { RunResult } from '../sim/run';
import { saves } from './persistence';
import type { RunReceipt, RewardChoice } from './receipt';
export type { RunReceipt } from './receipt';

export const TIER_IDS = ['I', 'II', 'III'];
export const BASE_CLASSES = Object.keys(CLASSES).filter((c) => !CLASSES[c].base);

export interface Fallen { id: string; name: string; classId: string; raceId: string; level: number; run: number; tier: string; cause?: string }
export interface RunSummary { run: number; tier: string; outcome: RunResult['outcome']; banked: number; floors: number; died: string[]; levelled: number }

export interface GameState {
  version: 2;
  revision: number;
  milestones: Record<string, number>;
  bossDryStreak: Record<string, number>;
  legacyCompletion?:boolean;
  lastReceipt?: RunReceipt;
  rewards?: RewardChoice[];
  refinements?:Record<string,number>;
  favorites?:string[];
  seed: number;
  runs: number;
  coin: number;
  /** Index into TIER_IDS of the highest tier unlocked. */
  unlocked: number;
  /** Deepest floor reached and survived, per tier. */
  waystones: Record<string, number>;
  roster: RosterHero[];
  hireBoard: RosterHero[];
  memorial: Fallen[];
  history: RunSummary[];
  hired: number;
  /** A delve in progress. Hardcore: if the page closes mid-delve, it is finished without the player on next load. */
  pending?: { id: string; plan: import('./expedition').DelvePlan; run: number };
  /** Torchwatch upgrades built so far (they last for the whole save). */
  camp?: string[];
  /** Equipment waiting in Torchwatch's stores. */
  stash?: string[];
}

/** The Specialists a hero could train as now, and why not if they can't. */
export function promotions(state: GameState, heroId: string): { options: string[]; blocked?: string } {
  const h = state.roster.find((x) => x.hero.id === heroId);
  if (!h) return { options: [] };
  const options = Object.keys(CLASSES).filter((c) => CLASSES[c].base === h.hero.classId);
  if (!options.length) return { options };
  if (h.hero.level < PROGRESSION.promoteLevel) return { options, blocked: `Trains at level ${PROGRESSION.promoteLevel}.` };
  if (!campEffect(state, 'academy')) return { options, blocked: 'Needs the Academy in Torchwatch.' };
  return { options };
}

/** Train a hero as a Specialist (T2). Gear the new class can't use goes back to the stores. */
export function promote(state: GameState, heroId: string, classId: string): string | null {
  const h = state.roster.find((x) => x.hero.id === heroId);
  if (!h) return 'No such hero.';
  const p = promotions(state, heroId);
  if (p.blocked) return p.blocked;
  if (!p.options.includes(classId)) return `${h.hero.name} can't train as that.`;
  const keep = (h.hero.items ?? []).filter((i) => canEquip(classId, i));
  const back = (h.hero.items ?? []).filter((i) => !keep.includes(i));
  state.stash = [...(state.stash ?? []), ...back];
  h.hero = { ...h.hero, classId, zone: ZONE[classId] ?? h.hero.zone, items: keep };
  saveGame(state);
  return null;
}

/** Put an item from the stash on a hero (or take one off into the stash, with itemId null). */
export function equip(state: GameState, heroId: string, slot: string, itemId: string | null): string | null {
  const h = state.roster.find((x) => x.hero.id === heroId);
  if (!h) return 'No such hero.';
  const items = [...(h.hero.items ?? [])];
  const current = items.findIndex((id) => ITEMS[id]?.slot === slot);
  const stash = [...(state.stash ?? [])];
  if (itemId) {
    const at = stash.indexOf(itemId);
    if (at < 0) return 'That item isn\u2019t in the stores.';
    if (ITEMS[itemId]?.slot !== slot || !canEquip(h.hero.classId, itemId)) return `${h.hero.name} can\u2019t use that.`;
    stash.splice(at, 1);
  }
  if (current >= 0) stash.push(items.splice(current, 1)[0]);
  if (itemId) items.push(itemId);
  h.hero = { ...h.hero, items };
  state.stash = stash;
  saveGame(state);
  return null;
}

export interface CampUpgrade { name: string; cost: number; about: string; effect: { recovery?: number; torch?: number; recruitLevel?: number; academy?: number } }
export const CAMP = (campJson as unknown as { upgrades: Record<string, CampUpgrade> }).upgrades;

/** The sum of one effect across everything built. */
export function campEffect(state: GameState, key: keyof CampUpgrade['effect']): number {
  return (state.camp ?? []).reduce((s, id) => s + (CAMP[id]?.effect[key] ?? 0), 0);
}

export function build(state: GameState, id: string): string | null {
  const u = CAMP[id];
  if (!u) return 'No such building.';
  if (state.camp?.includes(id)) return `${u.name} is already built.`;
  if (state.coin < u.cost) return `${u.name} costs ${u.cost} coin.`;
  state.coin -= u.cost;
  state.camp = [...(state.camp ?? []), id];
  if (CAMP[id].effect.recruitLevel) refreshBoard(state);
  saveGame(state);
  return null;
}

const names = namesJson as unknown as Record<string, { start: string[]; middle: string[]; end: string[] }>;

export function heroName(raceId: string, seed: string): string {
  const parts = names[raceId] ?? names.human;
  const r = stream('name', seed);
  return r.pick(parts.start) + r.pick(parts.middle) + r.pick(parts.end);
}

/** Has the company met this race yet (DESIGN §2: races arrive over time)? */
export function raceMet(state: GameState, raceId: string): boolean {
  const u = RACES[raceId]?.unlock;
  if (!u) return false;
  switch (u.kind) {
    case 'start': return true;
    case 'delves': return state.runs >= (u.n ?? 0);
    case 'cleared': return state.unlocked > TIER_IDS.indexOf(u.tier ?? 'I');
    case 'reached': return state.unlocked >= TIER_IDS.indexOf(u.tier ?? 'I');
    case 'built': return (state.camp ?? []).length >= (u.n ?? 0);
    case 'memorial': return state.memorial.length >= (u.n ?? 0);
    default: return false;
  }
}
export const metRaces = (state: GameState) => Object.keys(RACES).filter((r) => raceMet(state, r));

/** A hireable hero. Race, class and looks come from the seed: the player only picks from the board. */
export function candidate(state: GameState, level: number, classId?: string): RosterHero {
  const n = ++state.hired;
  const r = stream(state.seed, 'hire', n);
  const raceId = r.pick(metRaces(state));
  const cls = classId ?? r.pick(BASE_CLASSES);
  const id = `h${state.seed.toString(36)}-${n}`;
  const baseName=heroName(raceId,id),used=new Set([...state.roster,...state.hireBoard,...state.memorial].map(h=>'hero' in h?h.hero.name:h.name));
  let name=baseName,ordinal=2;while(used.has(name))name=`${baseName} ${ordinal++}`;
  return {
    hero: { id, name, classId: cls, raceId, level, gearScore: 10, zone: ZONE[cls] ?? 'middle', leadership: raceId === 'human' ? 3 : 1 + r.int(3) },
    xp: 0, benched: 0, runsLed: 0, alive: true, born: state.runs,
  };
}

export const hireCost = (h: RosterHero) => 20 + 15 * (h.hero.level - 1);

/** The board shows a few recruits, trained toward the newest unlocked tier. */
export function refreshBoard(state: GameState) {
  const band = TIERS[TIER_IDS[state.unlocked]].heroLevel;
  state.hireBoard = [];
  for(let i=0;i<3;i++)state.hireBoard.push(candidate(state, Math.max(1, band - 2) + campEffect(state, 'recruitLevel')));
}

export function newGame(seed = Math.floor(Math.random() * 1e9)): GameState {
  const state: GameState = { version: 2, revision:0, milestones:{}, bossDryStreak:{}, seed, runs: 0, coin: 40, unlocked: 0, waystones: {}, roster: [], hireBoard: [], memorial: [], history: [], hired: 0 };
  // the starting company: someone to hold the line, someone to heal, someone to shoot
  for(const cls of ['fighter','cleric','ranger'])state.roster.push(candidate(state,1,cls));
  refreshBoard(state);
  return state;
}

export function loadGame(): GameState | null {
  return saves.read().state ?? null;
}

export function saveGame(state: GameState): boolean {
  return saves.write(state);
}

export function eraseGame() {
  return saves.clear();
}
