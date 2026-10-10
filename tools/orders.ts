import { buildEncounter } from '../src/sim/encounter';
import { runFight } from '../src/sim/fight';
import { party, PRESETS } from '../src/sim/presets';
import { stream } from '../src/sim/rng';
import { TIERS } from '../src/sim/data';
for (const tier of ['I', 'II', 'III']) for (const room of ['normal', 'elite', 'boss'] as const) {
  const row: string[] = [];
  for (const pol of ['none', 'good', 'spam'] as const) {
    let w = 0, deaths = 0; const N = 150;
    for (let s = 0; s < N; s++) {
      const r = runFight({ seed: s, key: ['o', tier, room], tier, roomType: room, heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, room, TIERS[tier].floors[0] + 1, stream(s, 'enc-o', tier, room)), embers: 3, orderPolicy: pol, leader: { heroId: 'fighter0', rank: 'seasoned', noise: 0.15, temperament: 'stubborn' } });
      if (r.result === 'victory') w++; deaths += r.died.length;
    }
    row.push(`${pol} ${Math.round(w / N * 100)}% d${(deaths / N).toFixed(2)}`);
  }
  console.log(tier, room.padEnd(6), row.join(' | '));
}
