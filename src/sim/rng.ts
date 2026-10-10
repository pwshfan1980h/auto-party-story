// Seeded randomness. The sim never uses Math.random: every system draws from its own
// stream, keyed by the run seed plus context, so changing one system's draws never
// shifts another's.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Float in [a, b). */
  range(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** FNV-1a over the parts, finished with a murmur3 avalanche. */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A named, independent random stream, e.g. stream(runSeed, "combat", floor, room). */
export function stream(...parts: (string | number)[]): Rng {
  const s = hash32(...parts);
  const next = sfc32(s, hash32(s, 1), hash32(s, 2), hash32(s, 3));
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + next() * (b - a),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
