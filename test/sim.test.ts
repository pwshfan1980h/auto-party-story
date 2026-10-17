import { describe, expect, it } from 'vitest';
import { validateData, TIERS } from '../src/sim/data';
import { generateFloor, reveal } from '../src/sim/delve';
import { buildEncounter } from '../src/sim/encounter';
import { flowField, generateField, lineOfSight } from '../src/sim/field';
import { runFight } from '../src/sim/fight';
import { decide, leaderProfile } from '../src/sim/leader';
import { party, PRESETS } from '../src/sim/presets';
import { hash32, stream } from '../src/sim/rng';
import { runRun } from '../src/sim/run';
import { autoAttrs, baseStats, rollDamage } from '../src/sim/stats';

describe('data', () => {
  it('has no broken references', () => expect(validateData()).toEqual([]));
});

describe('rng', () => {
  it('is deterministic per key and independent across keys', () => {
    const a = stream(1, 'combat'), b = stream(1, 'combat'), c = stream(1, 'ai');
    const xa = [a.next(), a.next()], xb = [b.next(), b.next()];
    expect(xa).toEqual(xb);
    expect(c.next()).not.toBe(xa[0]);
    expect(hash32('a', 1)).not.toBe(hash32('a', 2));
  });
});

describe('stats and damage', () => {
  it('spends every level-up point', () => {
    const a = autoAttrs('fighter', 11);
    expect(a.might + a.agility + a.arcana + a.vigor).toBe(10);
  });
  it('never deals less than 1, and armour mitigates physical damage', () => {
    const atk = { ...baseStats(), power: 20 };
    const soft = { ...baseStats(), armor: 0 }, hard = { ...baseStats(), armor: 100 };
    const r1 = rollDamage(stream(1), 'slash', 0, 1, atk, soft, 1, 1);
    const r2 = rollDamage(stream(1), 'slash', 0, 1, atk, hard, 1, 1);
    expect(r2.dmg).toBeLessThan(r1.dmg);
    expect(rollDamage(stream(2), 'slash', 0, 0, atk, hard, 1, 1).dmg).toBeGreaterThanOrEqual(1);
  });
});

describe('battlefield', () => {
  it('always generates a valid, connected field', () => {
    for (let s = 0; s < 500; s++) {
      const f = generateField({ seed: s, key: [], biome: s % 2 ? 'crypt' : 'fungal', w: 14, h: 8, cover: [3, 6], hazards: 2 });
      expect(f.fallback).toBe(false);
      const src = f.spawns[0].front[0];
      const dist = flowField(f.nav, [{ x: (src % f.w) + 0.5, y: Math.floor(src / f.w) + 0.5 }], 0);
      for (const c of f.spawns[1].front) expect(Number.isFinite(dist[Math.floor(c / f.w) * 2 * f.nav.w + (c % f.w) * 2])).toBe(true);
    }
  });
  it('blocks line of sight through cover', () => {
    const f = generateField({ seed: 3, key: [], biome: 'crypt', w: 14, h: 8, cover: [6, 6], hazards: 0 });
    const c = f.cover[0];
    expect(lineOfSight(f.nav, c.x - 1.5, c.y + 0.5, c.x + 2.5, c.y + 0.5)).toBe(false);
  });
});

describe('fights', () => {
  const setup = (seed: number, mode: 'full' | 'batch') => ({ seed, tier: 'I', roomType: 'normal' as const, heroes: party(PRESETS.starter, 'I'), monsters: buildEncounter('I', 'normal', 2, stream(seed, 'enc')), mode });
  it('is deterministic, and batch mode matches full mode', () => {
    for (let s = 0; s < 20; s++) {
      const a = runFight(setup(s, 'batch')), b = runFight(setup(s, 'full')), c = runFight(setup(s, 'batch'));
      expect(a.hash).toBe(b.hash);
      expect(a.hash).toBe(c.hash);
      expect(b.events.length).toBeGreaterThan(10);
    }
  });
  it('always ends, within the time limit', () => {
    for (let s = 0; s < 30; s++) expect(['victory', 'defeat']).toContain(runFight(setup(s, 'batch')).result);
  });
  it('handles a horde without stalling', () => {
    const r = runFight({ seed: 1, tier: 'III', roomType: 'horde', heroes: party(PRESETS.starter, 'III'), monsters: buildEncounter('III', 'horde', 9, stream(1)) });
    expect(r.peakUnits).toBeGreaterThan(60);
    expect(r.result).not.toBe('timeout');
  });
});

describe('the Delve', () => {
  it('generates connected floors with fog that lifts with vision', () => {
    for (let s = 0; s < 200; s++) {
      const m = generateFloor(s, 'I', 1, false);
      const reach = new Set([0]);
      for (const n of m.nodes) if (reach.has(n.id)) n.next.forEach((x) => reach.add(x));
      expect(reach.size).toBe(m.nodes.length);
      expect(m.nodes.some((n) => n.type === 'campfire')).toBe(true);
    }
    const m = generateFloor(1, 'I', 1, false);
    reveal(m, 0, 1, false);
    expect(m.nodes.filter((n) => n.seen).length).toBeLessThan(m.nodes.length);
  });
  it('Leaders read the party with rank-dependent error', () => {
    const map = generateFloor(5, 'I', 1, false);
    const truth = { hp: 0.5, fallen: 0, torch: 8, pack: 0.5, packValue: 0.5, luck: 0, tier: 1, floor: 1, roomsHome: 2 };
    const err = (leadership: number) => {
      const L = leaderProfile({ id: 'x', name: 'X', raceId: 'human', leadership });
      let e = 0;
      for (let s = 0; s < 200; s++) e += Math.abs(decide(L, truth, map, 0, stream(s)).read.hp - truth.hp);
      return e / 200;
    };
    expect(err(10)).toBeLessThan(err(2) / 3);
  });
  it('reads a long expedition’s actual fuel instead of clipping it to ten',()=>{
    const L=leaderProfile({id:'x',name:'X',raceId:'human',leadership:10});
    const d=decide(L,{hp:1,fallen:0,torch:36,pack:0,packValue:0,luck:0,tier:1,floor:1,roomsHome:8},generateFloor(5,'I',1,false),0,stream(7));
    expect(d.read.torch).toBeGreaterThan(30);expect(d.check).not.toBe(2);
  });
  it('runs are deterministic and Hardcore deaths are permanent', () => {
    const p = party(PRESETS.starter, 'II');
    const a = runRun({ seed: 9, tier: 'II', party: p, leaderId: p[0].id });
    const b = runRun({ seed: 9, tier: 'II', party: p, leaderId: p[0].id });
    expect(JSON.stringify(a.ledger)).toBe(JSON.stringify(b.ledger));
    if (a.outcome === 'wipe') expect(a.died.length).toBe(p.length);
    expect(TIERS.II.floorsPerRun).toBeGreaterThan(0);
  });
});

describe('waystones', () => {
  it('a run started at a waystone never visits the floors above it', () => {
    const p = party(PRESETS.starter, 'II');
    const start = TIERS.II.floors[1] - 1;
    for (let seed = 0; seed < 5; seed++) {
      const r = runRun({ seed, tier: 'II', party: p, leaderId: p[0].id, startFloor: start });
      expect(r.ledger.every((e) => e.floor >= start)).toBe(true);
      expect(r.floorsReached).toBeGreaterThanOrEqual(start);
    }
  });
  it('a waystone outside the tier is clamped to it', () => {
    const p = party(PRESETS.starter, 'I');
    const r = runRun({ seed: 1, tier: 'I', party: p, leaderId: p[0].id, startFloor: 99 });
    expect(r.ledger.every((e) => e.floor === TIERS.I.floors[1])).toBe(true);
  });
});

describe('race traits and synergies', () => {
  it('synergies need two of a race', async () => {
    const { synergies } = await import('../src/sim/racials');
    expect([...synergies(['dwarf', 'human', 'elf']).keys()]).toEqual([]);
    expect([...synergies(['dwarf', 'dwarf', 'elf']).keys()]).toEqual(['shieldwall']);
    expect(synergies(['goblin', 'goblin', 'goblin']).get('mob')?.count).toBe(3);
  });

  it('a lucky halfling survives one killing blow per delve, and a revenant rises once', () => {
    let lucky = 0, risen = 0;
    for (let s = 0; s < 60 && (!lucky || !risen); s++) {
      const heroes = party(PRESETS.starter, 'II').map((h, i) => ({ ...h, raceId: i % 2 ? 'halfling' : 'revenant' }));
      const r = runFight({ seed: s, tier: 'II', roomType: 'boss', heroes, monsters: buildEncounter('II', 'boss', 5, stream(s, 'trait')), mode: 'full' });
      for (const e of r.events) { if (e.type === 'trait' && e.trait === 'lucky') lucky++; if (e.type === 'trait' && e.trait === 'unliving') risen++; }
      // each hero spends its trait at most once
      const per = new Map<string, number>();
      for (const e of r.events) if (e.type === 'trait' && (e.trait === 'lucky' || e.trait === 'unliving')) per.set(e.unit as string, (per.get(e.unit as string) ?? 0) + 1);
      for (const n of per.values()) expect(n).toBe(1);
    }
    expect(lucky).toBeGreaterThan(0);
    expect(risen).toBeGreaterThan(0);
  });
});

describe('robust auto-battling', () => {
  it('random parties from every class and race never crash, time out, idle or stack', async () => {
    const { robustSweep } = await import('../tools/robust');
    const r = robustSweep(3, ['I', 'II', 'III']);
    expect(r.crashes).toBe(0);
    expect(r.timeouts).toBe(0);
    expect(r.badPos).toBe(0);
    expect(r.idleSeconds).toBeLessThan(1);
    expect(r.overlapSeconds).toBeLessThan(1);
  });

  it('long fights go into overtime and still end', () => {
    let long = 0;
    for (let s = 0; s < 40 && long < 2; s++) {
      const r = runFight({ seed: s, tier: 'III', roomType: 'boss', heroes: party(PRESETS.starter, 'III'), monsters: buildEncounter('III', 'boss', 9, stream(s, 'ot')), mode: 'full' });
      if (r.duration <= 90) continue;
      long++;
      expect(r.events.some((e) => e.type === 'overtime')).toBe(true);
      expect(r.result).not.toBe('timeout');
    }
    expect(long).toBeGreaterThan(0);
  });
});
