// Shared by the sim reports and the auto-tuner: targets, and the fight and run measurements.
import { TIERS } from '../src/sim/data';
import { buildEncounter } from '../src/sim/encounter';
import { runFight, type FightResult, type MonsterSpawn } from '../src/sim/fight';
import { LEADERS, party, PRESETS } from '../src/sim/presets';
import { stream } from '../src/sim/rng';
import { runRun, type RunPolicy } from '../src/sim/run';
import type { RoomType } from '../src/sim/types';

export const TARGETS = {
  normalSeconds: [15, 35],
  starterNormalWin: [0.97, 1],
  eliteWin: [0.88, 0.96],
  bossWin: [0.6, 0.8],
  hordeWin: [0.85, 0.95],
  matrixCell: [0.25, 0.95],
  wipePerRun: 0.08,
  deathsPerHeroPerRun: [0.05, 0.10],
};

export function fightOnce(classes: string[], tier: string, room: RoomType, seed: number, monsters?: MonsterSpawn[]): FightResult {
  const t = TIERS[tier];
  const level = t.floors[0] + 1;
  const ms = monsters ?? buildEncounter(tier, room, level, stream(seed, 'enc-sim', tier, room));
  return runFight({ seed, key: ['sim', tier, room], tier, roomType: room, heroes: party(classes, tier), monsters: ms });
}

export function runStats(tier: string, lname: string, policy: RunPolicy, S: number, l = LEADERS[lname], from = 0) {
  let died = 0, heroes = 0, banked = 0, wipes = 0, good = 0, calls = 0, warns = 0, turnBack = 0, thisWay = 0, embers = 0, fellBack = 0, raresK = 0, raresE = 0;
  for (let s = from; s < from + S; s++) {
    const p = party(PRESETS.starter, tier);
    p[0] = { ...p[0], raceId: l.raceId, leadership: l.leadership };
    const r = runRun({ seed: s, tier, party: p, leaderId: p[0].id, policy });
    died += r.died.length; heroes += p.length; banked += r.banked; if (r.outcome === 'wipe') wipes++;
    for (const d of r.decisions) if (d.goodCall !== undefined) { calls++; if (d.goodCall) good++; }
    warns += r.warnings; if (r.turnBackUsed) turnBack++; thisWay += r.thisWayUsed; embers += r.embersSpent; fellBack += r.fellBack; raresK += r.rares.killed; raresE += r.rares.escaped;
  }
  return { deathsPerHero: died / heroes, banked: banked / S, bankedPerDeath: banked / Math.max(1, died), wipe: wipes / S, goodCalls: good / Math.max(1, calls), warnings: warns / S, turnBack: turnBack / S, thisWay: thisWay / S, embers: embers / S, fellBack: fellBack / S, rares: `${raresK}/${raresE}` };
}
