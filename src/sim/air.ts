// The air in a battlefield room: gases (fog, smoke, miasma) on a coarse per-tile grid.
// Each update they spread to open neighbours, drift on the room's draft, fade, pile up
// against walls, swirl into the wake of moving units and are blown outward by blasts.
// A few hundred cells at a few hertz: cheap enough to run inside every fight.
import { HAZARDS } from './data';
import type { Field } from './field';
import type { Rng } from './rng';

export class Air {
  readonly gases: string[];
  readonly grid: Record<string, Float32Array>;
  private readonly scratch: Float32Array;
  private readonly open: Uint8Array;
  readonly draft: [number, number];
  private readonly emitters: { gas: string; cell: number; rate: number }[] = [];

  constructor(readonly field: Field, rng: Rng) {
    const n = field.w * field.h;
    this.gases = Object.keys(HAZARDS.gases);
    this.grid = Object.fromEntries(this.gases.map((g) => [g, new Float32Array(n)]));
    this.scratch = new Float32Array(n);
    // gas fills floor and hazard tiles; walls, cover and the void hold it back
    this.open = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.open[i] = field.tiles[i] === 1 || field.tiles[i] === 3 ? 1 : 0;
    const a = rng.next() * Math.PI * 2, speed = HAZARDS.air.draft.min + rng.next() * (HAZARDS.air.draft.max - HAZARDS.air.draft.min);
    this.draft = [Math.cos(a) * speed, Math.sin(a) * speed];
    for (const hz of field.hazards) {
      const def = HAZARDS.ground[hz.kind];
      if (!def) continue;
      if (def.emits) for (const c of hz.cells) this.emitters.push({ gas: def.emits, cell: c, rate: def.rate ?? 0.4 });
      if (def.seeds) {
        // a bank of gas already hanging in the room
        const g = this.grid[def.seeds];
        for (const c of hz.cells) {
          const cx = c % field.w, cy = Math.floor(c / field.w), r = def.spread ?? 1;
          for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
            if (x < 0 || y < 0 || x >= field.w || y >= field.h || !this.open[y * field.w + x]) continue;
            const d = Math.hypot(x - cx, y - cy);
            g[y * field.w + x] = Math.max(g[y * field.w + x], (def.amount ?? 0.8) * Math.max(0, 1 - d / (r + 1)));
          }
        }
      }
    }
  }

  get any(): boolean { return this.emitters.length > 0 || this.gases.some((g) => this.grid[g].some((v) => v > 0.01)); }

  /** Advance the air by dt seconds. */
  update(dt: number) {
    const { w, h } = this.field, cap = HAZARDS.air.cap;
    for (const e of this.emitters) { const g = this.grid[e.gas]; g[e.cell] = Math.min(cap, g[e.cell] + e.rate * dt); }
    for (const gas of this.gases) {
      const def = HAZARDS.gases[gas], g = this.grid[gas], out = this.scratch;
      const k = Math.min(0.24, def.spread * dt * 4);
      // spread: each cell evens out with its open neighbours (closed ones don't take any)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!this.open[i]) { out[i] = 0; continue; }
        let sum = 0, nbrs = 0;
        if (x > 0 && this.open[i - 1]) { sum += g[i - 1]; nbrs++; }
        if (x < w - 1 && this.open[i + 1]) { sum += g[i + 1]; nbrs++; }
        if (y > 0 && this.open[i - w]) { sum += g[i - w]; nbrs++; }
        if (y < h - 1 && this.open[i + w]) { sum += g[i + w]; nbrs++; }
        out[i] = g[i] + k * (sum - nbrs * g[i]);
      }
      // drift on the draft: a share of each cell moves one cell downwind, if that cell is open
      const [dx, dy] = this.draft;
      const sx = Math.sign(dx), sy = Math.sign(dy), fx = Math.min(0.5, Math.abs(dx) * dt), fy = Math.min(0.5, Math.abs(dy) * dt);
      g.set(out);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = out[i];
        if (v <= 0.001) continue;
        const tx = x + sx, ty = y + sy;
        if (sx && tx >= 0 && tx < w && this.open[y * w + tx]) { const m = v * fx; g[i] -= m; g[y * w + tx] += m; }
        if (sy && ty >= 0 && ty < h && this.open[ty * w + x]) { const m = v * fy; g[i] -= m; g[ty * w + x] += m; }
      }
      const fade = Math.pow(1 - def.fade, dt * 4);
      for (let i = 0; i < g.length; i++) g[i] = Math.min(cap, Math.max(0, g[i] * fade));
    }
  }

  /** A unit walking through pushes gas into its wake. */
  stir(x: number, y: number, vx: number, vy: number) {
    const { w, h } = this.field;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    const bx = Math.floor(x - Math.sign(vx)), by = Math.floor(y - Math.sign(vy));
    if (bx < 0 || by < 0 || bx >= w || by >= h || !this.open[by * w + bx]) return;
    const i = cy * w + cx, j = by * w + bx, k = HAZARDS.air.stir * 0.25;
    for (const gas of this.gases) { const g = this.grid[gas], m = g[i] * k; g[i] -= m; g[j] += m; }
  }

  /** A blast throws the air outward: the middle clears and the gas piles into a ring around it. */
  blast(x: number, y: number, r: number) {
    const { w, h } = this.field;
    const R = Math.ceil(r + 1), share = HAZARDS.air.blast;
    for (const gas of this.gases) {
      const g = this.grid[gas];
      let pushed = 0;
      const ring: number[] = [];
      for (let ty = Math.floor(y) - R; ty <= Math.floor(y) + R; ty++) for (let tx = Math.floor(x) - R; tx <= Math.floor(x) + R; tx++) {
        if (tx < 0 || ty < 0 || tx >= w || ty >= h || !this.open[ty * w + tx]) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y), i = ty * w + tx;
        if (d <= r) { const m = g[i] * share; g[i] -= m; pushed += m; }
        else if (d <= r + 1.2) ring.push(i);
      }
      if (ring.length) for (const i of ring) g[i] = Math.min(HAZARDS.air.cap, g[i] + pushed / ring.length);
    }
  }

  /** How thick a gas is at a point (0–1). */
  at(gas: string, x: number, y: number): number {
    const { w, h } = this.field;
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return 0;
    return this.grid[gas][cy * w + cx];
  }

  /** The air for the renderer: each gas as bytes (0–255) per tile. */
  snapshot(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const gas of this.gases) { const g = this.grid[gas]; if (g.some((v) => v > 0.02)) out[gas] = Array.from(g, (v) => Math.round(v * 255)); }
    return out;
  }
}
