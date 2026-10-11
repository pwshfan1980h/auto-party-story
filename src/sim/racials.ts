// Race traits and party synergies (DESIGN §2). The numbers live in data/races.json; this is
// where they're looked up. Fights and runs ask "does this unit have trait X" and "is synergy Y on".
import { RACES } from './data';

/** A race's trait parameter, if the race has that trait. */
export function trait(raceId: string | undefined, id: string): Record<string, number> | null {
  const t = raceId ? RACES[raceId]?.trait : undefined;
  return t && t.id === id ? (t as unknown as Record<string, number>) : null;
}

/** Synergies switched on by a party: any race fielded twice or more. Returns synergy id → params and count. */
export function synergies(raceIds: string[]): Map<string, { params: Record<string, number>; count: number }> {
  const counts = new Map<string, number>();
  for (const r of raceIds) counts.set(r, (counts.get(r) ?? 0) + 1);
  const on = new Map<string, { params: Record<string, number>; count: number }>();
  for (const [r, n] of counts) if (n >= 2 && RACES[r]) on.set(RACES[r].synergy.id, { params: RACES[r].synergy as unknown as Record<string, number>, count: n });
  return on;
}
