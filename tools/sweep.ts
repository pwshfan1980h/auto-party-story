import { buildEncounter } from '../src/sim/encounter';
import { runFight } from '../src/sim/fight';
import { party, PRESETS } from '../src/sim/presets';
import { stream } from '../src/sim/rng';
import { TIERS } from '../src/sim/data';
const N = 80;
for (const tier of ['I', 'II', 'III']) {
  const out: string[] = [];
  for (const room of ['normal', 'elite', 'horde', 'boss'] as const) {
    let w = 0, secs = 0, deaths = 0, cost = 0;
    for (let s = 0; s < N; s++) {
      const r = runFight({ seed: s, key: ['sw', tier, room], tier, roomType: room, heroes: party(PRESETS.starter, tier), monsters: buildEncounter(tier, room, TIERS[tier].floors[0] + 1, stream(s, 'enc-sim', tier, room)) });
      const hs = r.units.filter((u) => u.kind === 'hero');
      if (r.result === 'victory') { w++; cost += 1 - hs.reduce((a, u) => a + u.hp / u.maxHp, 0) / hs.length; }
      secs += r.duration; deaths += r.died.length;
    }
    out.push(`${room} ${Math.round(w / N * 100)}% ${(secs / N).toFixed(0)}s cost${Math.round(cost / Math.max(1, w) * 100)}% d${(deaths / N).toFixed(2)}`);
  }
  console.log(tier + ': ' + out.join(' | '));
}
