// Golden seeds (spec 09 §2): fixed fights and runs whose outcomes are snapshotted in test/golden.json.
// Regenerate deliberately with `npm run golden` after an intended balance or behaviour change, and say why in the commit.
import { writeFileSync } from 'node:fs';
import { buildEncounter } from '../src/sim/encounter';
import { runFight } from '../src/sim/fight';
import { party, PRESETS } from '../src/sim/presets';
import { hash32, stream } from '../src/sim/rng';
import { runRun } from '../src/sim/run';

export function goldenSnapshot() {
  const out: Record<string, string> = {};
  for (const tier of ['I', 'II', 'III']) for (const room of ['normal', 'elite', 'boss'] as const) for (let s = 1; s <= 4; s++) {
    const r = runFight({ seed: s, key: ['golden', tier, room], tier, roomType: room, heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, room, 2, stream(s, 'golden-enc', tier, room)) });
    out[`fight/${tier}/${room}/${s}`] = `${r.result} ${r.duration}s ${r.died.length}d ${r.hash.toString(16)}`;
  }
  for (const tier of ['I', 'II']) for (let s = 1; s <= 4; s++) {
    const p = party(PRESETS.starter, tier);
    const r = runRun({ seed: s, tier, party: p, leaderId: p[0].id });
    out[`run/${tier}/${s}`] = `${r.outcome} f${r.floorsReached} r${r.rooms} ${r.died.length}d ${hash32(JSON.stringify(r.ledger)).toString(16)}`;
  }
  return out;
}

if (process.argv[1]?.endsWith('golden.ts')) {
  writeFileSync('test/golden.json', JSON.stringify(goldenSnapshot(), null, 2) + '\n');
  console.log('wrote test/golden.json');
}
