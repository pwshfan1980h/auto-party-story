// The Delve's floor maps: a seeded layered graph of rooms, drawn as a fogged minimap.
// Each node is one room; fight-type rooms become a generated battlefield (field.ts).
import { TIERS } from './data';
import { stream, type Rng } from './rng';

export type NodeType = 'start' | 'fight' | 'elite' | 'treasure' | 'shrine' | 'campfire' | 'event' | 'horde' | 'stairs' | 'boss';

export interface MapNode {
  id: number;
  /** Column on the minimap (0 = entry). */
  layer: number;
  /** Row on the minimap. */
  lane: number;
  type: NodeType;
  next: number[];
  /** An out-of-depth Named enemy waits here (spec 11). */
  named?: string;
  /** Fog: has the party seen this node on the minimap? */
  seen: boolean;
  /** Fog: does the party know what's in it? Unknown nodes show as "?". */
  known: boolean;
  visited: boolean;
}

export interface FloorMap {
  tier: string;
  floor: number;
  layers: number;
  nodes: MapNode[];
}

export const FIGHT_TYPES: ReadonlySet<NodeType> = new Set(['fight', 'elite', 'horde', 'boss']);

function weighted(rng: Rng, table: Record<string, number>): string {
  const entries = Object.entries(table);
  let r = rng.next() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}

export function generateFloor(seed: number, tierId: string, floor: number, last: boolean): FloorMap {
  const tier = TIERS[tierId];
  const rng = stream(seed, 'map', floor);
  const inner = tier.nodes[0] + rng.int(tier.nodes[1] - tier.nodes[0] + 1);
  const nodes: MapNode[] = [];
  const add = (layer: number, lane: number, type: NodeType) => {
    const n: MapNode = { id: nodes.length, layer, lane, type, next: [], seen: false, known: false, visited: false };
    nodes.push(n);
    return n;
  };
  const layers: MapNode[][] = [[add(0, 1, 'start')]];
  for (let l = 1; l <= inner; l++) {
    const width = 2 + rng.int(2);
    const lanes = width === 2 ? [0, 2] : [0, 1, 2];
    layers.push(lanes.map((lane) => add(l, lane, weighted(rng, tier.rooms) as NodeType)));
  }
  const bossFloor = last && floor >= tier.floors[1];
  layers.push([add(inner + 1, 1, bossFloor ? 'boss' : 'stairs')]);
  // edges: each node links to 1–2 nodes in the next layer within one lane; every node gets an incoming edge
  for (let l = 0; l < layers.length - 1; l++) {
    const cur = layers[l], nxt = layers[l + 1];
    for (const n of cur) {
      const near = nxt.filter((m) => Math.abs(m.lane - n.lane) <= 1);
      const pool = near.length ? near : nxt;
      const a = pool[rng.int(pool.length)];
      n.next.push(a.id);
      if (pool.length > 1 && rng.chance(0.45)) { const b = pool.find((m) => m.id !== a.id)!; n.next.push(b.id); }
    }
    for (const m of nxt) if (!cur.some((n) => n.next.includes(m.id))) {
      const from = cur.reduce((a, b) => (Math.abs(b.lane - m.lane) < Math.abs(a.lane - m.lane) ? b : a));
      from.next.push(m.id);
    }
    for (const n of cur) n.next.sort((a, b) => a - b);
  }
  // every floor offers at least one campfire (a way out) from layer 2 on
  const mid = nodes.filter((n) => n.layer >= 2 && n.layer <= inner);
  if (mid.length && !mid.some((n) => n.type === 'campfire')) mid[rng.int(mid.length)].type = 'campfire';
  // an out-of-depth Named, rarely
  if (rng.chance(tier.namedChance)) {
    const fights = nodes.filter((n) => n.type === 'fight' || n.type === 'elite');
    if (fights.length) fights[rng.int(fights.length)].named = rng.pick(tier.named);
  }
  return { tier: tierId, floor, layers: inner + 2, nodes };
}

/** Lift the fog: nodes within `vision` steps become seen; `knowsTypes` reveals what's in them beyond the next step. */
export function reveal(map: FloorMap, from: number, vision: number, knowsTypes: boolean) {
  let frontier = [from];
  map.nodes[from].seen = map.nodes[from].known = true;
  for (let step = 1; step <= vision; step++) {
    const nextFrontier: number[] = [];
    for (const id of frontier) for (const n of map.nodes[id].next) {
      const node = map.nodes[n];
      node.seen = true;
      if (step === 1 || knowsTypes) node.known = true;
      nextFrontier.push(n);
    }
    frontier = nextFrontier;
  }
}

/** Steps from a node to the nearest campfire (or boss/stairs exit), or Infinity. */
export function stepsToExit(map: FloorMap, from: number): number {
  const seen = new Set([from]);
  let frontier = [from], d = 0;
  while (frontier.length) {
    for (const id of frontier) if (map.nodes[id].type === 'campfire' && id !== from) return d;
    d++;
    const next: number[] = [];
    for (const id of frontier) for (const n of map.nodes[id].next) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return Infinity;
}

/** ASCII minimap with fog, for reports and debugging. */
export function minimap(map: FloorMap, at?: number): string {
  const glyph: Record<NodeType, string> = { start: 'S', fight: 'F', elite: 'E', treasure: 'T', shrine: '+', campfire: 'C', event: '?', horde: 'H', stairs: '>', boss: 'B' };
  const rows: string[] = [];
  for (let lane = 0; lane < 3; lane++) {
    let row = '';
    for (let l = 0; l < map.layers; l++) {
      const n = map.nodes.find((x) => x.layer === l && x.lane === lane);
      if (!n) { row += '   '; continue; }
      const g = !n.seen ? '·' : !n.known ? '?' : glyph[n.type] + (n.named && n.known ? '!' : '');
      row += (n.id === at ? `[${g}]` : n.visited ? `(${g})` : ` ${g} `).slice(0, 3);
    }
    rows.push(row);
  }
  return rows.join('\n');
}
