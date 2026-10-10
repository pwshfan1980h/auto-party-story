// Builds a room's monsters from the tier's encounter tables (spec 11).
import { ENEMIES, TIERS, type EncounterPool } from './data';
import type { MonsterSpawn } from './fight';
import type { Rng } from './rng';
import type { RoomType } from './types';

function pick(rng: Rng, table: Record<string, number>): string {
  const entries = Object.entries(table);
  let r = rng.next() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}

function count(rng: Rng, c: EncounterPool['count']): number {
  return typeof c === 'number' ? c : c[0] + rng.int(c[1] - c[0] + 1);
}

export function buildEncounter(tierId: string, room: RoomType, level: number, rng: Rng, named?: string): MonsterSpawn[] {
  const t = TIERS[tierId];
  const out: MonsterSpawn[] = [];
  if (room === 'boss') {
    out.push({ enemyId: t.boss.boss, level });
    for (const [id, n] of Object.entries(t.boss.adds)) for (let i = 0; i < n; i++) out.push({ enemyId: id, level });
  } else if (room === 'horde') {
    const n = count(rng, t.horde.count);
    for (let i = 0; i < n; i++) out.push({ enemyId: pick(rng, t.horde.pool), level });
    const caps = Object.keys(t.horde.captains ?? {});
    for (let i = 0; i < Math.min(2, caps.length); i++) out.push({ enemyId: pick(rng, t.horde.captains!), level });
  } else {
    const pool = room === 'elite' ? t.elite : t.normal;
    const n = count(rng, pool.count);
    for (let i = 0; i < n; i++) out.push({ enemyId: pick(rng, pool.pool), level });
    if (room === 'elite' && pool.elites) out.push({ enemyId: pick(rng, pool.elites), level, rank: 'elite' });
  }
  if (named) out.push({ enemyId: named, level: level + (ENEMIES[named].levelBonus ?? 0) });
  return out;
}
