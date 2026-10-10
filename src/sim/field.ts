// Battlefield generation (spec 04) plus the nav grid, flow fields, line of sight and
// spatial hash used for movement (spec 05). Pure and seeded.
import { BIOMES, HAZARDS } from './data';
import { stream, type Rng } from './rng';
import type { Team, Zone } from './types';

export const NAV = 2; // nav cells per tile
export const enum Tile { Void = 0, Floor = 1, Cover = 2, Hazard = 3 }

export interface Cover { x: number; y: number; type: string }
export interface Hazard { kind: string; cells: number[] }

export interface Field {
  w: number;
  h: number;
  tiles: Uint8Array;
  cover: Cover[];
  hazards: Hazard[];
  /** Spawn cells (tile index) per team and zone. */
  spawns: Record<Team, Record<Zone, number[]>>;
  attempt: number;
  fallback: boolean;
  nav: NavGrid;
}

export interface FieldOptions {
  seed: number;
  key: (string | number)[];
  biome: string;
  w: number;
  h: number;
  cover: [number, number];
  hazards: number;
  /** Hazard kinds allowed here (a tier can be gentler than its biome); defaults to the biome's list. */
  hazardKinds?: string[];
}

const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function generateField(opt: FieldOptions): Field {
  const biome = BIOMES[opt.biome];
  for (let attempt = 0; attempt < 30; attempt++) {
    const rng = stream(opt.seed, 'field', ...opt.key, attempt);
    const f = tryGenerate(opt, biome.erosion, biome.coverTypes, opt.hazardKinds ?? biome.hazards, rng);
    if (f) return finish(f, attempt, false);
  }
  return finish(plainField(opt), 30, true);
}

interface Draft { w: number; h: number; tiles: Uint8Array; cover: Cover[]; hazards: Hazard[]; spawns: Field['spawns'] }

function spawnColumns(w: number): Record<Team, Record<Zone, number[]>> {
  // Each team owns the outer third; front is the column nearest the middle.
  const third = Math.max(3, Math.floor(w / 3));
  const cols = (team: Team, zone: Zone) => {
    const i = zone === 'front' ? 2 : zone === 'middle' ? 1 : 0;
    const span = third / 3;
    const a = Math.floor(i * span), b = Math.max(a + 1, Math.floor((i + 1) * span));
    const out: number[] = [];
    for (let c = a; c < b; c++) out.push(team === 0 ? c : w - 1 - c);
    return out;
  };
  return {
    0: { front: cols(0, 'front'), middle: cols(0, 'middle'), back: cols(0, 'back') },
    1: { front: cols(1, 'front'), middle: cols(1, 'middle'), back: cols(1, 'back') },
  };
}

function tryGenerate(opt: FieldOptions, erosion: number, coverTypes: string[], hazardTypes: string[], rng: Rng): Draft | null {
  const { w, h } = opt;
  const tiles = new Uint8Array(w * h).fill(Tile.Floor);
  const at = (x: number, y: number) => y * w + x;
  // 1. erode the border, then one cellular-automata pass
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.min(x, y, w - 1 - x, h - 1 - y) === 0 && rng.chance(erosion)) tiles[at(x, y)] = Tile.Void;
  }
  const copy = tiles.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || copy[at(nx, ny)] === Tile.Void) v++;
    }
    if (v >= 5) tiles[at(x, y)] = Tile.Void;
  }
  // spawn zones: outer thirds, rows 1..h-2, always floor
  const cols = spawnColumns(w);
  const spawnCols = new Set<number>([...Object.values(cols[0]).flat(), ...Object.values(cols[1]).flat()]);
  for (let y = 1; y < h - 1; y++) for (const x of spawnCols) tiles[at(x, y)] = Tile.Floor;
  // 3. cover in the middle band, Poisson-disc spaced
  const cover: Cover[] = [];
  const want = opt.cover[0] + rng.int(opt.cover[1] - opt.cover[0] + 1);
  const third = Math.max(3, Math.floor(w / 3));
  for (let tries = 0; cover.length < want && tries < 400; tries++) {
    const x = third + rng.int(Math.max(1, w - 2 * third)), y = rng.int(h);
    if (tiles[at(x, y)] !== Tile.Floor) continue;
    if (cover.some((c) => Math.hypot(c.x - x, c.y - y) < 2.2)) continue;
    tiles[at(x, y)] = Tile.Cover;
    cover.push({ x, y, type: rng.pick(coverTypes) });
  }
  // 4. hazards: small clusters in the middle band
  const hazards: Hazard[] = [];
  for (let i = 0; i < opt.hazards && hazardTypes.length; i++) {
    const kind = rng.pick(hazardTypes);
    const cx = third + rng.int(Math.max(1, w - 2 * third)), cy = 1 + rng.int(Math.max(1, h - 2));
    const cells: number[] = [];
    for (const [dx, dy] of [[0, 0], ...DIR4]) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || tiles[at(x, y)] !== Tile.Floor || spawnCols.has(x)) continue;
      if (rng.chance(dx || dy ? 0.5 : 1)) { if (HAZARDS.ground[kind]?.tile !== false) tiles[at(x, y)] = Tile.Hazard; cells.push(at(x, y)); }
    }
    if (cells.length) hazards.push({ kind, cells });
  }
  // 7. validate: every spawn cell reaches every other; at least 70% walkable
  const spawnCells: number[] = [];
  for (let y = 1; y < h - 1; y++) for (const x of spawnCols) spawnCells.push(at(x, y));
  const seen = new Uint8Array(w * h);
  const q = [spawnCells[0]];
  seen[q[0]] = 1;
  while (q.length) {
    const c = q.pop()!;
    const x = c % w, y = (c / w) | 0;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = at(nx, ny);
      if (!seen[n] && (tiles[n] === Tile.Floor || tiles[n] === Tile.Hazard)) { seen[n] = 1; q.push(n); }
    }
  }
  if (spawnCells.some((c) => !seen[c])) return null;
  let walk = 0;
  for (let i = 0; i < w * h; i++) if (tiles[i] === Tile.Floor || tiles[i] === Tile.Hazard) walk++;
  if (walk / (w * h) < 0.7) return null;

  const spawns = { 0: {}, 1: {} } as Field['spawns'];
  for (const team of [0, 1] as Team[]) for (const zone of ['front', 'middle', 'back'] as Zone[]) {
    spawns[team][zone] = [];
    for (const x of cols[team][zone]) for (let y = 1; y < h - 1; y++) spawns[team][zone].push(at(x, y));
  }
  return { w, h, tiles, cover, hazards, spawns };
}

function plainField(opt: FieldOptions): Draft {
  const { w, h } = opt;
  const tiles = new Uint8Array(w * h).fill(Tile.Floor);
  const cols = spawnColumns(w);
  const spawns = { 0: {}, 1: {} } as Field['spawns'];
  for (const team of [0, 1] as Team[]) for (const zone of ['front', 'middle', 'back'] as Zone[]) {
    spawns[team][zone] = [];
    for (const x of cols[team][zone]) for (let y = 1; y < h - 1; y++) spawns[team][zone].push(y * w + x);
  }
  return { w, h, tiles, cover: [], hazards: [], spawns };
}

function finish(d: Draft, attempt: number, fallback: boolean): Field {
  return { ...d, attempt, fallback, nav: buildNav(d.w, d.h, d.tiles, d.hazards) };
}

// ---------------- nav grid + flow fields ----------------

export interface NavGrid {
  w: number;
  h: number;
  walk: Uint8Array;
  hazardCost: Float32Array;
}

const costOf = (kind: string) => (HAZARDS.ground[kind]?.tile === false ? 0 : HAZARDS.ground[kind]?.pathCost ?? 3);

function buildNav(tw: number, th: number, tiles: Uint8Array, hazards: Hazard[]): NavGrid {
  const w = tw * NAV, h = th * NAV;
  const walk = new Uint8Array(w * h);
  const hazardCost = new Float32Array(w * h);
  const hz = new Map<number, number>();
  for (const hzd of hazards) { const cost = costOf(hzd.kind); if (cost) for (const c of hzd.cells) hz.set(c, cost); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.floor(y / NAV) * tw + Math.floor(x / NAV);
    walk[y * w + x] = tiles[t] === Tile.Floor || tiles[t] === Tile.Hazard ? 1 : 0;
    hazardCost[y * w + x] = hz.get(t) ?? 0;
  }
  return { w, h, walk, hazardCost };
}

export function walkableAt(nav: NavGrid, x: number, y: number): boolean {
  const cx = Math.floor(x * NAV), cy = Math.floor(y * NAV);
  return cx >= 0 && cy >= 0 && cx < nav.w && cy < nav.h && nav.walk[cy * nav.w + cx] === 1;
}

/** Dijkstra from the given source points (in tiles), 8-neighbour, no corner cutting. */
export function flowField(nav: NavGrid, sources: { x: number; y: number }[], hazardFear: number): Float32Array {
  const { w, h, walk, hazardCost } = nav;
  const dist = new Float32Array(w * h).fill(Infinity);
  const heap = new MinHeap(w * h);
  for (const s of sources) {
    const cx = Math.min(w - 1, Math.max(0, Math.floor(s.x * NAV))), cy = Math.min(h - 1, Math.max(0, Math.floor(s.y * NAV)));
    const c = cy * w + cx;
    if (dist[c] > 0) { dist[c] = 0; heap.push(c, 0); }
  }
  while (heap.size) {
    const c = heap.pop(), d = heap.lastKey;
    if (d > dist[c]) continue;
    const x = c % w, y = (c / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (!walk[n]) continue;
      if (dx && dy && (!walk[y * w + nx] || !walk[ny * w + x])) continue;
      const nd = d + (dx && dy ? 1.414 : 1) + hazardCost[n] * hazardFear;
      if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
    }
  }
  return dist;
}

/** Direction (unit vector) to step along a flow field from position (x, y). */
export function flowDir(nav: NavGrid, dist: Float32Array, x: number, y: number): [number, number] {
  const { w, h, walk } = nav;
  const cx = Math.floor(x * NAV), cy = Math.floor(y * NAV);
  let best = Infinity, bx = cx, by = cy;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h || !walk[ny * w + nx]) continue;
    if (dx && dy && (!walk[cy * w + nx] || !walk[ny * w + cx])) continue;
    const v = dist[ny * w + nx];
    if (v < best) { best = v; bx = nx; by = ny; }
  }
  const tx = (bx + 0.5) / NAV - x, ty = (by + 0.5) / NAV - y;
  const l = Math.hypot(tx, ty);
  return l < 1e-6 ? [0, 0] : [tx / l, ty / l];
}

/** Clear straight line between two points, sampled every quarter tile. */
export function lineOfSight(nav: NavGrid, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (!walkableAt(nav, ax + (bx - ax) * k, ay + (by - ay) * k)) return false;
  }
  return true;
}

/** Binary min-heap on typed arrays (flow fields are the sim's hottest code). */
class MinHeap {
  private ids: Int32Array;
  private keys: Float32Array;
  size = 0;
  constructor(cap: number) { this.ids = new Int32Array(cap); this.keys = new Float32Array(cap); }
  push(id: number, key: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2), keys = new Float32Array(this.size * 2);
      ids.set(this.ids); keys.set(this.keys); this.ids = ids; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  /** Pops the min; returns its id and leaves its key in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const top = this.ids[0];
    this.lastKey = this.keys[0];
    const n = --this.size;
    if (n > 0) {
      const id = this.ids[n], key = this.keys[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && this.keys[r] < this.keys[l] ? r : l;
        if (this.keys[m] >= key) break;
        this.ids[i] = this.ids[m]; this.keys[i] = this.keys[m]; i = m;
      }
      this.ids[i] = id; this.keys[i] = key;
    }
    return top;
  }
}

// ---------------- spatial hash ----------------

/** 1-tile buckets, rebuilt every tick. Used for separation and area queries (no O(n²) loops). */
export class SpatialHash<T extends { x: number; y: number }> {
  private cells = new Map<number, T[]>();
  constructor(private w: number) {}
  clear() { this.cells.clear(); }
  insert(item: T) {
    const k = Math.floor(item.y) * (this.w + 2) + Math.floor(item.x);
    let b = this.cells.get(k);
    if (!b) { b = []; this.cells.set(k, b); }
    b.push(item);
  }
  /** Items within r of (x, y), in insertion order per bucket (deterministic). */
  query(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const b = this.cells.get(cy * (this.w + 2) + cx);
      if (!b) continue;
      for (const it of b) if ((it.x - x) ** 2 + (it.y - y) ** 2 <= r * r) out.push(it);
    }
    return out;
  }
}
