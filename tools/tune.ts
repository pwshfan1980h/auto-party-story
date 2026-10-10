// npm run tune -- [--seeds N] [--evals N] [--only a,b] [--apply]
// Auto-tuner (spec 09): coordinate search over the knobs in tools/tune.json against the suite targets.
// Trials change data in memory only. It writes a report and a proposal; --apply patches the data files in place.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measureBaselines } from './baselines';
import { ABILITIES, ARCHETYPES, BASELINES, CLASSES, DELVE, ENEMIES, LEADERSHIP, MONSTER_SCALE, PROGRESSION, RACES, RANKS, SPECIES, TIERS } from '../src/sim/data';
import { fightOnce, runStats, TARGETS } from './metrics';
import { PRESETS } from '../src/sim/presets';
import type { RoomType } from '../src/sim/types';
import tuneJson from './tune.json';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = +opt('seeds', '40');
const MAX_EVALS = +opt('evals', '60');
const ONLY = opt('only', '');
const APPLY = args.includes('--apply');
const TIER_LIST = ['I', 'II', 'III'];
const ROOMS: RoomType[] = ['normal', 'elite', 'horde', 'boss'];
const VALIDATE_FROM = 10000; // held-out seeds for the before/after check

// The live data objects the sim reads, by file. Changing a value here changes the next trial.
const FILES: Record<string, Record<string, unknown>> = {
  monsters: { scale: MONSTER_SCALE, ranks: RANKS, enemies: ENEMIES, species: SPECIES, archetypes: ARCHETYPES },
  leadership: LEADERSHIP as unknown as Record<string, unknown>,
  progression: PROGRESSION as unknown as Record<string, unknown>,
  delve: DELVE as unknown as Record<string, unknown>,
  tiers: TIERS as unknown as Record<string, unknown>,
  classes: CLASSES as unknown as Record<string, unknown>,
  races: RACES as unknown as Record<string, unknown>,
  abilities: ABILITIES as unknown as Record<string, unknown>,
};

interface Param { path: string; min: number; max: number; step: number }
const PARAMS = (tuneJson.params as Param[]).filter((p) => !ONLY || ONLY.split(',').some((o) => p.path.includes(o)));

/** A path segment is a key, or [id] for the array element with that id. */
function step(o: unknown, k: string): unknown {
  const byId = /^\[(.+)\]$/.exec(k);
  if (byId) return (o as { id?: string }[]).find((e) => e.id === byId[1]);
  return (o as Record<string, unknown>)[k];
}

function locate(path: string): [Record<string, number>, string] {
  const [file, ...keys] = path.split('.');
  let o = FILES[file] as Record<string, unknown>;
  if (!o) throw new Error(`unknown data file in ${path}`);
  for (const k of keys.slice(0, -1)) { o = step(o, k) as Record<string, unknown>; if (!o) throw new Error(`no ${k} in ${path}`); }
  const last = keys[keys.length - 1];
  if (typeof o[last] !== 'number') throw new Error(`${path} is not a number`);
  return [o as Record<string, number>, last];
}
const get = (path: string) => { const [o, k] = locate(path); return o[k]; };
const set = (path: string, v: number) => { const [o, k] = locate(path); o[k] = v; };
const round = (v: number, step: number) => { const d = Math.max(0, -Math.floor(Math.log10(step)) + 2); return +v.toFixed(d); };

// ---- objective: how far the metrics sit outside their target bands ----
type Metrics = Record<string, number>;
interface Target { key: string; band: [number, number]; scale: number; weight: number }

const BANDS: Target[] = [];
for (const t of TIER_LIST) {
  BANDS.push({ key: `${t} normal win`, band: TARGETS.starterNormalWin as [number, number], scale: 0.03, weight: 1 });
  BANDS.push({ key: `${t} normal secs`, band: TARGETS.normalSeconds as [number, number], scale: 5, weight: 0.5 });
  BANDS.push({ key: `${t} elite win`, band: TARGETS.eliteWin as [number, number], scale: 0.05, weight: 1 });
  BANDS.push({ key: `${t} horde win`, band: TARGETS.hordeWin as [number, number], scale: 0.05, weight: 1 });
  BANDS.push({ key: `${t} boss win`, band: TARGETS.bossWin as [number, number], scale: 0.08, weight: 1 });
  BANDS.push({ key: `${t} seasoned deaths/hero`, band: TARGETS.deathsPerHeroPerRun as [number, number], scale: 0.03, weight: 1.5 });
  BANDS.push({ key: `${t} seasoned wipe`, band: [0, TARGETS.wipePerRun], scale: 0.04, weight: 1 });
  // a new player's novice Leader should lose some runs, not most of them
  BANDS.push({ key: `${t} novice wipe`, band: [0, 0.3], scale: 0.05, weight: 1 });
  // rank must pay: Master banks at least 10% more than Seasoned, and novices die at least twice as often as Masters
  BANDS.push({ key: `${t} master/seasoned banked`, band: [1.1, 99], scale: 0.1, weight: 1 });
  BANDS.push({ key: `${t} novice/master deaths`, band: [2, 99], scale: 0.5, weight: 0.5 });
  // a Master should bank most of what a reckless novice does, while losing far fewer heroes
  BANDS.push({ key: `${t} master/novice banked`, band: [0.8, 99], scale: 0.15, weight: 1 });
}

function measure(seeds: number, from = 0, tiers = TIER_LIST): Metrics {
  const m: Metrics = {};
  for (const t of tiers) {
    for (const room of ROOMS) {
      let win = 0, secs = 0;
      for (let s = from; s < from + seeds; s++) { const r = fightOnce(PRESETS.starter, t, room, s); if (r.result === 'victory') win++; secs += r.duration; }
      m[`${t} ${room} win`] = win / seeds;
      if (room === 'normal') m[`${t} normal secs`] = secs / seeds;
    }
    const ladder = Object.fromEntries((['novice', 'seasoned', 'master'] as const).map((rank, i) =>
      [rank, runStats(t, `human-${rank}`, 'trust', seeds, { raceId: 'human', leadership: [2, 5, 10][i] }, from)]));
    m[`${t} seasoned deaths/hero`] = ladder.seasoned.deathsPerHero;
    m[`${t} seasoned wipe`] = ladder.seasoned.wipe;
    m[`${t} novice wipe`] = ladder.novice.wipe;
    m[`${t} master/seasoned banked`] = ladder.master.banked / Math.max(1, ladder.seasoned.banked);
    m[`${t} master/novice banked`] = ladder.master.banked / Math.max(1, ladder.novice.banked);
    m[`${t} novice/master deaths`] = ladder.novice.deathsPerHero / Math.max(0.005, ladder.master.deathsPerHero);
  }
  return m;
}

function loss(m: Metrics): number {
  let l = 0;
  for (const b of BANDS) {
    const v = m[b.key], off = v < b.band[0] ? b.band[0] - v : v > b.band[1] ? v - b.band[1] : 0;
    l += b.weight * (off / b.scale) ** 2;
  }
  return l;
}

// ---- search ----
const start = new Date();
const initial = Object.fromEntries(PARAMS.map((p) => [p.path, get(p.path)]));
const steps = Object.fromEntries(PARAMS.map((p) => [p.path, p.step]));
let evals = 0;
// a knob under tiers.<T> only changes tier T, so only that tier is re-measured
const tiersOf = (path: string) => { const m = /^tiers\.(\w+)\./.exec(path); return m ? [m[1]] : TIER_LIST; };
// Leaders plan with the baseline table, so keep it in step with the data being tried
const refreshBaselines = (tiers: string[]) => Object.assign(BASELINES, measureBaselines(tiers));
const initialBaselines = structuredClone(BASELINES);
refreshBaselines(TIER_LIST);
let current = measure(SEEDS);
evals++;
let trial: Metrics = current;
const evaluate = (path: string) => { evals++; trial = { ...current, ...measure(SEEDS, 0, tiersOf(path)) }; return loss(trial); };
let best = loss(current);
const log: string[] = [`start loss ${best.toFixed(2)}`];
console.log(`tune: ${PARAMS.length} knobs, ${SEEDS} seeds, budget ${MAX_EVALS} evals; start loss ${best.toFixed(2)}`);

let improved = true;
while (improved && evals < MAX_EVALS) {
  improved = false;
  for (const p of PARAMS) {
    if (evals >= MAX_EVALS) break;
    const cur = get(p.path);
    let moved = false;
    // on a plateau (e.g. a room won 100% either way) a small step shows no slope, so probe further out
    let flat = true;
    for (const [dir, mult] of [[1, 1], [-1, 1], [1, 2], [-1, 2], [1, 4]] as const) {
      if (mult > 1 && !flat) break;
      const v = round(Math.min(p.max, Math.max(p.min, cur + dir * mult * steps[p.path])), p.step);
      if (v === cur || evals >= MAX_EVALS) continue;
      set(p.path, v);
      const l = evaluate(p.path);
      if (Math.abs(l - best) > Math.max(0.05, best * 0.01)) flat = false;
      if (l < best - Math.max(0.05, best * 0.01)) {
        log.push(`${p.path}: ${cur} → ${v}, loss ${best.toFixed(2)} → ${l.toFixed(2)}`);
        console.log(`  ${p.path} ${cur} → ${v}  loss ${l.toFixed(2)}`);
        refreshBaselines(tiersOf(p.path));
        current = { ...current, ...measure(SEEDS, 0, tiersOf(p.path)) };
        best = loss(current); moved = improved = true;
        break;
      }
      set(p.path, cur);
    }
    // no luck either way: search finer next time round (keep going while any knob can still refine)
    if (!moved && steps[p.path] > p.step / 4) { steps[p.path] = Math.max(p.step / 4, steps[p.path] / 2); improved = true; }
  }
}

// ---- validate on held-out seeds and report ----
const final = Object.fromEntries(PARAMS.map((p) => [p.path, get(p.path)]));
const finalBaselines = structuredClone(BASELINES);
const after = measure(SEEDS * 2, VALIDATE_FROM);
for (const p of PARAMS) set(p.path, initial[p.path]);
Object.assign(BASELINES, initialBaselines);
const before = measure(SEEDS * 2, VALIDATE_FROM);
for (const p of PARAMS) set(p.path, final[p.path]);
Object.assign(BASELINES, finalBaselines);

const changes = PARAMS.filter((p) => final[p.path] !== initial[p.path]);
const fmt = (k: string, v: number) => (k.includes('win') || k.includes('wipe') ? `${(v * 100).toFixed(0)}%` : v.toFixed(k.includes('deaths/hero') ? 3 : 2));
const lines = [
  '# Auto-tuner', '',
  `${start.toISOString()} · ${SEEDS} search seeds, ${SEEDS * 2} held-out validation seeds · ${evals} evaluations`, '',
  `Held-out loss: **${loss(before).toFixed(2)} → ${loss(after).toFixed(2)}** (0 = every metric inside its band)`, '',
  '## Proposed changes', '',
  changes.length ? '| Knob | Now | Proposed |\n|---|---|---|\n' + changes.map((p) => `| ${p.path} | ${initial[p.path]} | ${final[p.path]} |`).join('\n') : 'None: no move beat the noise floor.', '',
  '## Metrics on held-out seeds', '',
  '| Metric | Target | Before | After |', '|---|---|---|---|',
  ...BANDS.map((b) => `| ${b.key} | ${fmt(b.key, b.band[0])}–${b.band[1] >= 99 ? '∞' : fmt(b.key, b.band[1])} | ${fmt(b.key, before[b.key])} | ${fmt(b.key, after[b.key])} |`), '',
  '## Search log', '', ...log.map((l) => `- ${l}`), '',
  changes.length ? 'With --apply the baseline table is rewritten too; then run `npm run golden`.' : '',
];
const stamp = start.toISOString().slice(0, 19).replace(/[T:]/g, '-');
const dir = join('reports', `${stamp}-tune`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'report.md'), lines.join('\n'));
writeFileSync(join(dir, 'proposal.json'), JSON.stringify({ initial, proposed: final, heldOutLoss: { before: loss(before), after: loss(after) } }, null, 2));
console.log(`held-out loss ${loss(before).toFixed(2)} → ${loss(after).toFixed(2)}; ${changes.length} change(s) → ${dir}/report.md`);

/** Patch one number in a hand-formatted JSON file without reformatting it, then check the result parses to the intended value. */
function patchFile(path: string, value: number) {
  const [file, ...keys] = path.split('.');
  const fp = join('data', `${file}.json`);
  let text = readFileSync(fp, 'utf8'), pos = 0;
  for (const k of keys) {
    const byId = /^\[(.+)\]$/.exec(k);
    const re = byId ? new RegExp(`"id"\\s*:\\s*"${byId[1]}"`, 'g') : new RegExp(`"${k}"`, 'g');
    re.lastIndex = pos;
    const hit = re.exec(text);
    if (!hit) throw new Error(`can't find ${k} for ${path}`);
    pos = hit.index + hit[0].length;
  }
  const re = /\s*:\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)/y;
  re.lastIndex = pos;
  const m = re.exec(text);
  if (!m) throw new Error(`no number after ${path}`);
  const numAt = pos + m[0].length - m[1].length;
  text = text.slice(0, numAt) + String(value) + text.slice(numAt + m[1].length);
  let o = JSON.parse(text);
  for (const k of keys) o = step(o, k);
  if (o !== value) throw new Error(`patching ${path} went wrong; nothing written`);
  writeFileSync(fp, text);
}
if (APPLY && changes.length && loss(after) < loss(before)) {
  for (const p of changes) patchFile(p.path, final[p.path]);
  writeFileSync('data/leader-baselines.json', JSON.stringify({ _doc: 'Generated by npm run baselines (tools/baselines.ts). Win rate, HP cost and per-hero death rate by tier, room and entering party HP.', table: finalBaselines }, null, 1) + '\n');
  console.log(`applied ${changes.length} change(s) to data/; review with git diff`);
} else if (APPLY) console.log('not applied: no change, or the held-out loss did not improve');
