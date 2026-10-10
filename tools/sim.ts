// npm run sim -- <suite> [--seeds N] [--tier I,II,III] [--out dir]
// Headless balance tool (spec 09). Writes report.md and report.json under reports/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ABILITIES, ARCHETYPES, CLASSES, ENEMIES, TIERS, validateData } from '../src/sim/data';
import { buildEncounter } from '../src/sim/encounter';
import { runFight } from '../src/sim/fight';
import { ALL_CLASSES, heroFor, LEADERS, party, PRESETS } from '../src/sim/presets';
import { hash32, stream } from '../src/sim/rng';
import { runRun, type RunPolicy, type RunResult } from '../src/sim/run';
import { runCampaign } from '../src/sim/campaign';
import type { RoomType } from '../src/sim/types';
import { fightOnce, runStats, TARGETS } from './metrics';

const args = process.argv.slice(2);
const suite = args.find((a) => !a.startsWith('--')) ?? 'smoke';
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SEEDS = +opt('seeds', suite === 'smoke' ? '20' : '200');
const TIER_LIST = opt('tier', 'I,II,III').split(',');
const ROOMS: RoomType[] = ['normal', 'elite', 'horde', 'boss'];

// ---- targets (spec 01/09/12, first pass) ----
// Hardcore room targets (spec 09 §2b): ordinary rooms are won but cost HP; danger sits in elites, hordes and bosses.

const lines: string[] = [];
const json: Record<string, unknown> = { suite, seeds: SEEDS, tiers: TIER_LIST, at: new Date().toISOString() };
const flags: string[] = [];
const md = (s = '') => lines.push(s);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const table = (head: string[], rows: (string | number)[][]) => {
  md(`| ${head.join(' | ')} |`);
  md(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) md(`| ${r.join(' | ')} |`);
  md();
};
const inBand = (v: number, [a, b]: number[]) => v >= a && v <= b;


// ---------------- suites ----------------

function smoke(): boolean {
  md('# Smoke');
  const errors = validateData();
  md(`Data validation: ${errors.length ? errors.join('; ') : 'ok'}`);
  if (errors.length) flags.push(...errors);
  let fights = 0, timeouts = 0, stuck = 0;
  for (const tier of TIER_LIST) for (const room of ROOMS) for (let s = 0; s < SEEDS; s++) {
    const r = fightOnce(PRESETS.starter, tier, room, s);
    fights++; if (r.result === 'timeout') timeouts++; stuck += r.stuckSeconds;
  }
  md(`Fights: ${fights}, timeouts: ${timeouts}, stuck unit-seconds per fight: ${(stuck / fights).toFixed(2)}`);
  let runs = 0;
  for (const tier of TIER_LIST) for (let s = 0; s < Math.max(5, SEEDS / 4); s++) { runRun({ seed: s, tier, party: party(PRESETS.starter, tier), leaderId: party(PRESETS.starter, tier)[0].id }); runs++; }
  md(`Runs: ${runs}`);
  const det = determinism(10);
  if (timeouts) flags.push(`${timeouts} fights hit the 180 s limit`);
  return errors.length === 0 && det;
}

function determinism(n = SEEDS): boolean {
  md('## Determinism');
  let bad = 0;
  for (const tier of TIER_LIST) for (let s = 0; s < n; s++) {
    const a = runFight({ seed: s, tier, roomType: 'normal', heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, 'normal', 2, stream(s, 'd')), mode: 'batch' });
    const b = runFight({ seed: s, tier, roomType: 'normal', heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, 'normal', 2, stream(s, 'd')), mode: 'full' });
    if (a.hash !== b.hash || a.result !== b.result) bad++;
    const r1 = runRun({ seed: s, tier, party: party(PRESETS.starter, tier), leaderId: 'fighter0' });
    const r2 = runRun({ seed: s, tier, party: party(PRESETS.starter, tier), leaderId: 'fighter0' });
    if (hash32(JSON.stringify(r1.ledger)) !== hash32(JSON.stringify(r2.ledger))) bad++;
  }
  md(`Batch vs full fight hashes and repeated runs: ${bad ? `${bad} MISMATCHES` : 'identical'}`);
  md();
  if (bad) flags.push(`determinism: ${bad} mismatches`);
  json.determinism = { mismatches: bad };
  return bad === 0;
}

function fights() {
  md('# Fight matrix');
  // 1. presets × tiers × room types
  const rows: (string | number)[][] = [];
  const presetData: Record<string, unknown> = {};
  const classDealt: Record<string, number[]> = {}; // per class, damage share per fight
  const classHeal: Record<string, number[]> = {};
  for (const tier of TIER_LIST) for (const [name, classes] of Object.entries(PRESETS)) for (const room of ROOMS) {
    let win = 0, secs = 0, downs = 0, deaths = 0;
    const durs: number[] = [];
    for (let s = 0; s < SEEDS; s++) {
      const r = fightOnce(classes, tier, room, s);
      if (r.result === 'victory') win++;
      secs += r.duration; durs.push(r.duration);
      deaths += r.died.length; downs += r.carried.length;
      const heroes = r.units.filter((u) => u.kind === 'hero');
      const total = heroes.reduce((a, u) => a + u.dealt, 0) || 1;
      for (const u of heroes) {
        (classDealt[u.defId] ??= []).push(u.dealt / total);
        (classHeal[u.defId] ??= []).push(u.healed);
      }
    }
    durs.sort((a, b) => a - b);
    const wr = win / SEEDS;
    rows.push([tier, name, room, pct(wr), (secs / SEEDS).toFixed(1), durs[Math.floor(durs.length / 2)].toFixed(1), (deaths / SEEDS).toFixed(2), (downs / SEEDS).toFixed(2)]);
    presetData[`${tier}/${name}/${room}`] = { win: wr, secs: secs / SEEDS, deaths: deaths / SEEDS, carried: downs / SEEDS };
    if (name === 'starter' && room === 'normal') {
      if (!inBand(wr, TARGETS.starterNormalWin)) flags.push(`Tier ${tier} starter normal win ${pct(wr)} outside ${TARGETS.starterNormalWin.map(pct).join('–')}`);
      if (!inBand(secs / SEEDS, TARGETS.normalSeconds)) flags.push(`Tier ${tier} normal fight length ${(secs / SEEDS).toFixed(1)} s outside ${TARGETS.normalSeconds.join('–')} s`);
    }
    const band = { boss: TARGETS.bossWin, elite: TARGETS.eliteWin, horde: TARGETS.hordeWin }[room as 'boss' | 'elite' | 'horde'];
    if (name === 'starter' && band && !inBand(wr, band)) flags.push(`Tier ${tier} starter ${room} win ${pct(wr)} outside ${band.map(pct).join('–')}`);
  }
  md('## Presets by tier and room');
  table(['Tier', 'Party', 'Room', 'Win', 'Avg s', 'Median s', 'Deaths/fight', 'Carried/fight'], rows);
  json.presets = presetData;

  // 2. class contribution
  md('## Class contribution (share of party damage, healing per fight)');
  const crow = ALL_CLASSES.filter((c) => classDealt[c]).map((c) => {
    const d = classDealt[c], h = classHeal[c];
    return [CLASSES[c].name, pct(d.reduce((a, b) => a + b, 0) / d.length), (h.reduce((a, b) => a + b, 0) / h.length).toFixed(0), d.length];
  });
  table(['Class', 'Damage share', 'Healing/fight', 'Samples'], crow);

  // 3. class × archetype (party = class + two fillers, vs a pack of one archetype)
  md('## Class × enemy archetype (win rate)');
  md('Party: the class plus fillers from Fighter, Cleric, Ranger and Mage, up to the tier\'s party size, against a pack of one archetype (party size + 1, or 12 swarm units).');
  const archetypes = Object.keys(ARCHETYPES).filter((a) => a !== 'wailer');
  const matrix: Record<string, Record<string, number>> = {};
  for (const tier of TIER_LIST.slice(0, 2)) {
    const t = TIERS[tier];
    const level = t.floors[0] + 1;
    const pools = Object.keys({ ...t.normal.pool, ...t.elite.pool, ...(t.elite.elites ?? {}), ...t.horde.pool });
    const rowsM: (string | number)[][] = [];
    for (const c of ALL_CLASSES) {
      const fill = ['fighter', 'cleric', 'ranger', 'mage'].filter((x) => x !== c).slice(0, t.partySize - 1);
      const row: (string | number)[] = [CLASSES[c].name];
      for (const a of archetypes) {
        const enemy = pools.find((e) => ENEMIES[e].archetype === a && (a === 'swarm' || !ENEMIES[e].rank));
        if (!enemy) { row.push('–'); continue; }
        const n = a === 'swarm' ? 12 : t.partySize + 1;
        let win = 0;
        const S = Math.max(20, Math.floor(SEEDS / 4));
        for (let s = 0; s < S; s++) {
          const r = runFight({ seed: s, key: ['arch', a], tier, roomType: 'normal', heroes: [heroFor(c, tier, 0), ...fill.map((f, i) => heroFor(f, tier, i + 1))], monsters: Array.from({ length: n }, () => ({ enemyId: enemy, level })) });
          if (r.result === 'victory') win++;
        }
        const wr = win / S;
        (matrix[`${tier}/${c}`] ??= {})[a] = wr;
        row.push(pct(wr));
        if (!inBand(wr, TARGETS.matrixCell)) flags.push(`Tier ${tier}: ${CLASSES[c].name} vs ${a} pack ${pct(wr)}`);
      }
      rowsM.push(row);
    }
    md(`### Tier ${tier}`);
    table(['Class', ...archetypes], rowsM);
  }
  json.matrix = matrix;
}

function runs() {
  md('# Runs and Leaders');
  const rows: (string | number)[][] = [];
  const data: Record<string, unknown> = {};
  for (const tier of TIER_LIST) for (const [lname, l] of Object.entries(LEADERS)) {
    const out = { cleared: 0, retreat: 0, wipe: 0 };
    let died = 0, heroes = 0, banked = 0, floors = 0, roomsN = 0, fightsN = 0, secs = 0, named = 0, spotted = 0, leaderDied = 0;
    const S = SEEDS;
    for (let s = 0; s < S; s++) {
      const p = party(PRESETS.starter, tier);
      p[0] = { ...p[0], raceId: l.raceId, leadership: l.leadership };
      const r: RunResult = runRun({ seed: s, tier, party: p, leaderId: p[0].id });
      out[r.outcome]++; died += r.died.length; heroes += p.length; banked += r.banked; floors += r.floorsReached; roomsN += r.rooms; fightsN += r.fights; secs += r.fightSeconds;
      named += r.namedMet; spotted += r.namedSpotted; if (r.leaderDied) leaderDied++;
    }
    rows.push([tier, lname, pct(out.cleared / S), pct(out.retreat / S), pct(out.wipe / S), (died / heroes).toFixed(3), (banked / S).toFixed(0), (roomsN / S).toFixed(1), (fightsN / S).toFixed(1), (secs / S / 60).toFixed(1), `${named}/${spotted}`]);
    data[`${tier}/${lname}`] = { ...out, deathsPerHero: died / heroes, banked: banked / S, rooms: roomsN / S, fights: fightsN / S };
    if (lname === 'seasoned-dwarf') {
      if (out.wipe / S > TARGETS.wipePerRun) flags.push(`Tier ${tier} seasoned Leader wipes ${pct(out.wipe / S)} of runs (target < ${pct(TARGETS.wipePerRun)})`);
      if (!inBand(died / heroes, TARGETS.deathsPerHeroPerRun)) flags.push(`Tier ${tier} seasoned Leader deaths per hero per run ${(died / heroes).toFixed(3)} outside 0.05–0.10`);
    }
  }
  md('Party: starter preset; the first hero leads with the given race and Leadership.');
  table(['Tier', 'Leader', 'Cleared', 'Retreated', 'Wiped', 'Deaths/hero', 'Banked', 'Rooms', 'Fights', 'Fight min', 'Named met/spotted'], rows);
  json.runs = data;
  for (const tier of TIER_LIST) {
    const n = data[`${tier}/novice-orc`] as { banked: number; deathsPerHero: number };
    const m = data[`${tier}/master-human`] as { banked: number; deathsPerHero: number };
    if (m.banked < n.banked * 1.4) flags.push(`Tier ${tier}: master banks ${m.banked.toFixed(0)} vs novice ${n.banked.toFixed(0)} (target ≥ +40%)`);
    if (m.deathsPerHero > n.deathsPerHero * 0.85) flags.push(`Tier ${tier}: master deaths ${m.deathsPerHero.toFixed(3)} vs novice ${n.deathsPerHero.toFixed(3)} (target ≥ 15% fewer)`);
  }
}


function leaders() {
  md('# Leaders (policy: trust)');
  const rows: (string | number)[][] = [];
  const data: Record<string, unknown> = {};
  for (const tier of TIER_LIST) for (const lname of Object.keys(LEADERS)) {
    const r = runStats(tier, lname, 'trust', SEEDS);
    data[`${tier}/${lname}`] = r;
    rows.push([tier, lname, pct(r.wipe), r.deathsPerHero.toFixed(3), r.banked.toFixed(0), r.bankedPerDeath.toFixed(0), pct(r.goodCalls), r.fellBack.toFixed(2)]);
  }
  table(['Tier', 'Leader', 'Wiped', 'Deaths/hero', 'Banked', 'Banked per death', 'Good calls (heuristic)', 'Fall backs/run'], rows);
  json.leaders = data;
  // the same race at each rank, so rank is measured apart from racial traits
  md('## Rank ladder (human Leader)');
  const ladder: (string | number)[][] = [];
  const ranks: Record<string, Record<string, ReturnType<typeof runStats>>> = {};
  for (const tier of TIER_LIST) for (const [rank, leadership] of [['novice', 2], ['seasoned', 5], ['veteran', 8], ['master', 10]] as const) {
    const r = runStats(tier, `human-${rank}`, 'trust', SEEDS, { raceId: 'human', leadership });
    (ranks[tier] ??= {})[rank] = r;
    ladder.push([tier, rank, pct(r.wipe), r.deathsPerHero.toFixed(3), r.banked.toFixed(0), r.bankedPerDeath.toFixed(0), pct(r.goodCalls)]);
  }
  table(['Tier', 'Rank', 'Wiped', 'Deaths/hero', 'Banked', 'Banked per death', 'Good calls'], ladder);
  json.rankLadder = ranks;
  for (const tier of TIER_LIST) {
    const n = ranks[tier].novice, m = ranks[tier].master;
    if (m.bankedPerDeath < n.bankedPerDeath * 1.3) flags.push(`Tier ${tier}: human master banks ${m.bankedPerDeath.toFixed(0)} per death vs human novice ${n.bankedPerDeath.toFixed(0)} (target ≥ +30%)`);
  }
  for (const tier of TIER_LIST) {
    const n = data[`${tier}/novice-orc`] as { goodCalls: number; bankedPerDeath: number }, m = data[`${tier}/master-human`] as { goodCalls: number; bankedPerDeath: number };
    if (m.bankedPerDeath < n.bankedPerDeath * 1.3) flags.push(`Tier ${tier}: master banks ${m.bankedPerDeath.toFixed(0)} per death vs novice ${n.bankedPerDeath.toFixed(0)}`);
  }
}

function policies() {
  md('# Intervention policies (seasoned dwarf Leader, matched seeds)');
  const rows: (string | number)[][] = [];
  const data: Record<string, unknown> = {};
  for (const tier of TIER_LIST) for (const pol of ['trust', 'cautious', 'orders'] as RunPolicy[]) {
    const r = runStats(tier, 'seasoned-dwarf', pol, SEEDS);
    data[`${tier}/${pol}`] = r;
    rows.push([tier, pol, pct(r.wipe), r.deathsPerHero.toFixed(3), r.banked.toFixed(0), r.warnings.toFixed(2), pct(r.turnBack), r.thisWay.toFixed(2), r.embers.toFixed(1), r.rares]);
  }
  table(['Tier', 'Policy', 'Wiped', 'Deaths/hero', 'Banked', 'Warnings/run', 'Turned back', 'This way/run', 'Embers spent/run', 'Rares killed/escaped'], rows);
  json.policies = data;
  md('### Player Orders in single fights (none / good / spam)');
  const orows: (string | number)[][] = [];
  for (const tier of TIER_LIST) for (const room of ['elite', 'boss'] as RoomType[]) {
    const cell: (string | number)[] = [tier, room];
    const res: Record<string, number> = {};
    for (const pol of ['none', 'good', 'spam'] as const) {
      let w = 0;
      const N = Math.max(40, SEEDS);
      for (let s = 0; s < N; s++) {
        const r = runFight({ seed: s, key: ['o', tier, room], tier, roomType: room, heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, room, TIERS[tier].floors[0] + 1, stream(s, 'enc-o', tier, room)), embers: 3, orderPolicy: pol, leader: { heroId: 'fighter0', rank: 'seasoned', noise: 0.15, temperament: 'stubborn' } });
        if (r.result === 'victory') w++;
      }
      res[pol] = w / N;
      cell.push(pct(w / N));
    }
    orows.push(cell);
    const lift = res.good - res.none;
    if (lift < 0.08 && res.none < 0.9) flags.push(`Tier ${tier} ${room}: good orders lift ${(lift * 100).toFixed(0)} pts (target +8 to +15)`);
    if (res.spam > res.good) flags.push(`Tier ${tier} ${room}: spam orders (${pct(res.spam)}) beat good orders (${pct(res.good)})`);
  }
  table(['Tier', 'Room', 'No orders', 'Good bot', 'Spam bot'], orows);
}

function campaign() {
  md('# Simulated campaigns (balanced bot, trust policy)');
  const N = Math.max(6, Math.floor(SEEDS / 10));
  const rows: (string | number)[][] = [];
  const all = [];
  for (let s = 1; s <= N; s++) {
    const c = runCampaign({ seed: s, maxRuns: 150 });
    all.push(c);
    rows.push([s, c.runs, c.hours, c.tierUnlocked, c.milestones.II ?? '–', c.milestones.III ?? '–', c.milestones.clearedIII ?? '–', c.deathsPerHeroRun.toFixed(3), c.heroesLost, c.longestStall, c.curve.at(-1)?.[1] ?? 0]);
  }
  table(['Seed', 'Runs', 'Hours', 'Tier', 'h to II', 'h to III', 'h to clear III', 'Deaths/hero/run', 'Heroes lost', 'Longest stall', 'Avg level'], rows);
  const d = all.reduce((s, c) => s + c.deathsPerHeroRun, 0) / all.length;
  if (!inBand(d, TARGETS.deathsPerHeroPerRun)) flags.push(`campaign deaths per hero per run ${d.toFixed(3)} outside 0.05–0.10`);
  const stall = Math.max(...all.map((c) => c.longestStall));
  if (stall > 6) flags.push(`campaign longest stall ${stall} runs (target ≤ 6)`);
  json.campaign = all.map(({ curve, ...rest }) => ({ ...rest, curveTail: curve.slice(-5) }));
}

function perf() {
  md('# Performance');
  const t0 = performance.now(); let n = 0;
  for (let s = 0; s < 300; s++) { fightOnce(PRESETS.starter, 'I', 'normal', s); n++; }
  const normal = (performance.now() - t0) / n;
  const t1 = performance.now(); let peak = 0;
  for (let s = 0; s < 20; s++) peak = Math.max(peak, fightOnce(PRESETS.starter, 'III', 'horde', s).peakUnits);
  const horde = (performance.now() - t1) / 20;
  table(['Fight', 'ms', 'Target'], [['Tier I normal 3v3–5', normal.toFixed(2), '≤ 2'], [`Tier III horde (peak ${peak} units)`, horde.toFixed(1), '≤ 40']]);
  json.perf = { normalMs: normal, hordeMs: horde, peak };
  if (normal > 2) flags.push(`normal fight ${normal.toFixed(2)} ms > 2 ms`);
  if (horde > 40) flags.push(`horde fight ${horde.toFixed(1)} ms > 40 ms`);
}

// ---------------- main ----------------
const t0 = performance.now();
let ok = true;
if (suite === 'smoke') ok = smoke();
else if (suite === 'determinism') ok = determinism();
else if (suite === 'fights') fights();
else if (suite === 'runs') runs();
else if (suite === 'perf') perf();
else if (suite === 'leaders') leaders();
else if (suite === 'policies') policies();
else if (suite === 'campaign') campaign();
else if (suite === 'all') { ok = smoke(); fights(); runs(); leaders(); policies(); campaign(); perf(); }
else { console.error(`unknown suite ${suite}`); process.exit(2); }

md('## Flags (outside targets)');
md(flags.length ? flags.map((f) => `- ${f}`).join('\n') : 'None.');
json.flags = flags;
json.seconds = (performance.now() - t0) / 1000;
void ABILITIES;

const out = opt('out', join('reports', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${suite}`));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), lines.join('\n') + '\n');
writeFileSync(join(out, 'report.json'), JSON.stringify(json, null, 2));
console.log(lines.join('\n'));
console.log(`\n${suite}: ${((performance.now() - t0) / 1000).toFixed(1)} s → ${out}/report.md`);
process.exit(ok ? 0 : 1);
