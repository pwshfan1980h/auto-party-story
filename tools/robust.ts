// Robustness sweep: random parties from every class and race, every tier and room type, watched tick
// by tick for anything an auto-battler must never do: crash, time out, stand idle while foes live,
// get stuck, stack on top of another unit, or leave the walkable field.
import { CLASSES, ITEMS, RACES, STATUSES, TIERS } from '../src/sim/data';
import { buildEncounter } from '../src/sim/encounter';
import { Fight, type FightSetup, type HeroSnapshot, type OrderPolicy, type Unit } from '../src/sim/fight';
import { walkableAt } from '../src/sim/field';
import { stream, type Rng } from '../src/sim/rng';
import type { RoomType, Zone } from '../src/sim/types';

const ROOMS: RoomType[] = ['normal', 'elite', 'horde', 'boss'];
const POLICIES: OrderPolicy[] = ['none', 'good', 'spam'];
/** Seconds without moving or starting an action, with foes alive and nothing stopping it, that count as idle. */
export const IDLE_AFTER = 3;
/** Seconds two units may sit inside each other before it counts as an overlap. */
const OVERLAP_AFTER = 1;
const CHECK_EVERY = 5; // ticks (0.25 s)

export interface Problem { kind: string; seed: number; tier: string; room: RoomType; detail: string }

export interface RobustReport {
  fights: number;
  crashes: number;
  timeouts: number;
  badPos: number;
  idleSeconds: number;
  idleByClass: Record<string, number>;
  idleByEnemy: Record<string, number>;
  stuckSeconds: number;
  /** Units stuck two seconds or more, by unit kind and movement intent (sampled). */
  stuckBy: Record<string, number>;
  overlapSeconds: number;
  fightSeconds: number;
  problems: Problem[];
}

function zoneFor(classId: string): Zone {
  const r = CLASSES[classId].roles as Record<string, number>;
  if ((r.tank ?? 0) >= 2 || (r.bruiser ?? 0) >= 2) return 'front';
  if ((r.heal ?? 0) >= 2 || (r.artillery ?? 0) >= 2 || (r.area ?? 0) >= 2 || (r.summon ?? 0) >= 2) return 'back';
  return 'middle';
}

export function randomParty(rng: Rng, tier: string): HeroSnapshot[] {
  const t = TIERS[tier];
  const classes = Object.keys(CLASSES).filter((c) => !c.startsWith('_'));
  const races = Object.keys(RACES);
  const items = Object.entries(ITEMS);
  const size = Math.min(6, t.partySize + rng.int(3));
  return Array.from({ length: size }, (_, i) => {
    const classId = rng.pick(classes);
    const gear: string[] = [];
    for (const slot of ['weapon', 'shield', 'armour', 'trinket']) {
      const pool = items.filter(([, d]) => d.slot === slot && d.tier <= Number(tier === 'I' ? 1 : tier === 'II' ? 2 : 3));
      if (pool.length && rng.chance(0.5)) gear.push(rng.pick(pool)[0]);
    }
    return {
      id: `${classId}${i}`, name: `${classId}${i}`, classId, raceId: rng.pick(races),
      level: Math.max(1, t.heroLevel + rng.int(5) - 2), gearScore: t.gearScore, zone: rng.chance(0.8) ? zoneFor(classId) : rng.pick(['front', 'middle', 'back'] as Zone[]),
      hp: undefined, items: gear,
    };
  });
}

const flagged = (u: Unit, f: string) => u.statuses.some((s) => STATUSES[s.id].flags?.includes(f as never));
const free = (u: Unit) => u.alive && u.downedLeft <= 0 && !flagged(u, 'stun') && !flagged(u, 'sleep') && !flagged(u, 'fear');

export function robustSweep(seeds: number, tiers: string[], from = 0): RobustReport {
  const rep: RobustReport = { fights: 0, crashes: 0, timeouts: 0, badPos: 0, idleSeconds: 0, idleByClass: {}, idleByEnemy: {}, stuckSeconds: 0, stuckBy: {}, overlapSeconds: 0, fightSeconds: 0, problems: [] };
  const note = (p: Problem) => { if (rep.problems.filter((q) => q.kind === p.kind).length < 12) rep.problems.push(p); };
  for (const tier of tiers) for (const room of ROOMS) for (let seed = from; seed < from + seeds; seed++) {
    const rng = stream(seed, 'robust', tier, room);
    const t = TIERS[tier];
    const setup: FightSetup = {
      seed, key: ['robust', tier, room], tier, roomType: room,
      heroes: randomParty(rng, tier),
      monsters: buildEncounter(tier, room, t.floors[0] + rng.int(Math.max(1, t.floors[1] - t.floors[0] + 1)), stream(seed, 'robust-enc', tier, room)),
      embers: 3, orderPolicy: rng.pick(POLICIES),
    };
    rep.fights++;
    let f: Fight;
    const busy = new Map<Unit, { x: number; y: number; t: number; act: number; flagged: boolean }>();
    const overlap = new Map<string, number>();
    let idleFlaggedThisFight = false;
    try {
      f = new Fight(setup);
      while (!f.over) {
        f.step();
        if (Math.round(f.now / 0.05) % CHECK_EVERY) continue;
        const now = f.now;
        const live = f.units.filter((u) => u.alive);
        const foesUp = [live.some((u) => u.team === 1 && u.downedLeft <= 0), live.some((u) => u.team === 0 && u.downedLeft <= 0)];
        for (const u of live) {
          if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !walkableAt(f.field.nav, u.x, u.y)) {
            rep.badPos++;
            note({ kind: 'bad position', seed, tier, room, detail: `${u.id} at ${u.x.toFixed(2)},${u.y.toFixed(2)} t=${now.toFixed(1)}` });
          }
          if (u.stuckT >= 2) { const k = `${u.kind === 'hero' ? 'hero' : u.kind}:${u.plan?.intent ?? '-'}`; rep.stuckBy[k] = (rep.stuckBy[k] ?? 0) + CHECK_EVERY * 0.05; }
          const b = busy.get(u);
          const moved = !b || Math.hypot(u.x - b.x, u.y - b.y) > 0.05;
          if (!b || moved || u.windup || u.lastActTick !== b.act || !free(u) || !foesUp[u.team]) { busy.set(u, { x: u.x, y: u.y, t: now, act: u.lastActTick, flagged: false }); continue; }
          if (now - b.t >= IDLE_AFTER) {
            rep.idleSeconds += CHECK_EVERY * 0.05;
            const key = u.kind === 'hero' ? (u.defId) : `${u.defId}`;
            const bucket = u.kind === 'hero' ? rep.idleByClass : rep.idleByEnemy;
            bucket[key] = (bucket[key] ?? 0) + CHECK_EVERY * 0.05;
            if (!b.flagged && !idleFlaggedThisFight) {
              b.flagged = true; idleFlaggedThisFight = true;
              note({ kind: 'idle', seed, tier, room, detail: `${u.id} (${u.defId}) idle from t=${b.t.toFixed(1)}, plan=${u.plan ? `${u.plan.ability}→${u.plan.targetId} ${u.plan.intent}` : 'none'}, rule=${u.ruleIdx}` });
            }
          }
        }
        // overlaps: two standing units inside each other
        const up = live.filter((u) => u.downedLeft <= 0);
        for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) {
          const a = up[i], c = up[j], k = `${a.id}|${c.id}`;
          if (Math.hypot(a.x - c.x, a.y - c.y) < 0.5 * (a.base.radius + c.base.radius)) {
            const s = (overlap.get(k) ?? 0) + CHECK_EVERY * 0.05;
            overlap.set(k, s);
            if (s > OVERLAP_AFTER) {
              rep.overlapSeconds += CHECK_EVERY * 0.05;
              if (Math.abs(s - OVERLAP_AFTER - CHECK_EVERY * 0.05) < 1e-6) note({ kind: 'overlap', seed, tier, room, detail: `${a.id} and ${c.id} at t=${now.toFixed(1)}` });
            }
          } else overlap.delete(k);
        }
      }
      const r = f.outcome();
      rep.fightSeconds += r.duration;
      rep.stuckSeconds += r.stuckSeconds;
      if (r.result === 'timeout') { rep.timeouts++; note({ kind: 'timeout', seed, tier, room, detail: `${f.units.filter((u) => u.alive).map((u) => u.id).join(', ')}` }); }
    } catch (e) {
      rep.crashes++;
      note({ kind: 'crash', seed, tier, room, detail: String((e as Error).stack ?? e).split('\n').slice(0, 3).join(' | ') });
    }
  }
  return rep;
}
