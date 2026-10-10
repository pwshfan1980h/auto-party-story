// Voxel parts kit: original unit models are assembled in code from parts on a small rig.
// Pure data (no Three.js), so the sim, tests and tools can all use it.
// Coordinates are voxels: x right, y up, z forward (the face looks toward +z), feet at y = 0.

export type Color = number; // 0xRRGGBB

export type RigKind = 'biped' | 'quad' | 'flier' | 'spider' | 'blob' | 'ghost';

export interface Part {
  name: string;
  /** Rotation pivot in model voxels; animation rotates the part around it. */
  pivot: [number, number, number];
  /** Parent part (transforms are inherited), e.g. a sword's parent is the right arm. */
  parent?: string;
  voxels: Map<number, Color>;
}

export interface Model {
  id: string;
  rig: RigKind;
  parts: Part[];
  /** Uniform scale applied on top of the 1/32-tile voxel size (bosses, minions). */
  scale: number;
  /** Height in fine voxels, for placing HP pips, barks and the Scout's Lens. */
  height: number;
  /** Which hand holds the weapon and how attacks look. */
  style: 'melee' | 'ranged' | 'caster' | 'bite' | 'none';
}

/**
 * Fine voxels per design unit. Models are designed in coarse units (a unit is ~28 tall) and stored at
 * RES× resolution, so curves are smooth and the detail pass can work at full resolution.
 */
export const RES = 2;

const OFF = 256, SPAN = 512;
export const vkey = (x: number, y: number, z: number) => ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);
export const unkey = (k: number): [number, number, number] => [Math.floor(k / (SPAN * SPAN)) - OFF, (Math.floor(k / SPAN) % SPAN) - OFF, (k % SPAN) - OFF];

/** Deterministic per-voxel jitter so flat colours get a little hand-painted texture. */
function jitter(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
}

export function shade(c: Color, f: number): Color {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Builds one part. Every method takes **design** coordinates (fractions allowed); voxels are stored at RES×.
 * `fine*` methods address individual fine voxels for the detail pass.
 */
export class PartBuilder {
  readonly voxels = new Map<number, Color>();
  constructor(readonly name: string, readonly pivot: [number, number, number], readonly parent?: string) {}

  /** Fine voxel indices covered by design voxel x. */
  private span(x: number): [number, number] { const a = Math.round(x * RES); return [a, a + RES - 1]; }
  /** Design-space position of a fine voxel's centre (design voxel x spans [x, x+1)). */
  private d(f: number) { return (f + 0.5) / RES - 0.5; }

  fineSet(fx: number, fy: number, fz: number, c: Color, texture = 0) {
    const col = texture ? shade(c, 1 - texture / 2 + jitter(Math.floor(fx / RES), Math.floor(fy / RES), Math.floor(fz / RES)) * texture) : c;
    this.voxels.set(vkey(Math.round(fx), Math.round(fy), Math.round(fz)), col);
    return this;
  }
  fineClear(fx: number, fy: number, fz: number) { this.voxels.delete(vkey(fx, fy, fz)); return this; }
  fineHas(fx: number, fy: number, fz: number) { return this.voxels.has(vkey(fx, fy, fz)); }
  /** Fine box, inclusive, in fine coordinates. */
  fineBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, texture = 0) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.fineSet(x, y, z, c, texture);
    return this;
  }

  set(x: number, y: number, z: number, c: Color, texture = 0) {
    const [x0, x1] = this.span(x), [y0, y1] = this.span(y), [z0, z1] = this.span(z);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let e = z0; e <= z1; e++) this.fineSet(a, b, e, c, texture);
    return this;
  }
  clear(x: number, y: number, z: number) {
    const [x0, x1] = this.span(x), [y0, y1] = this.span(y), [z0, z1] = this.span(z);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let e = z0; e <= z1; e++) this.voxels.delete(vkey(a, b, e));
    return this;
  }
  has(x: number, y: number, z: number) { const [a] = this.span(x), [b] = this.span(y), [e] = this.span(z); return this.voxels.has(vkey(a, b, e)); }

  /** Inclusive box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, texture = 0.08) {
    const [ax] = this.span(Math.min(x0, x1)), [, bx] = this.span(Math.max(x0, x1));
    const [ay] = this.span(Math.min(y0, y1)), [, by] = this.span(Math.max(y0, y1));
    const [az] = this.span(Math.min(z0, z1)), [, bz] = this.span(Math.max(z0, z1));
    return this.fineBox(ax, ay, az, bx, by, bz, c, texture);
  }
  /** Box with its vertical edges trimmed, so blocks read as rounded. */
  rbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, texture = 0.08) {
    this.box(x0, y0, z0, x1, y1, z1, c, texture);
    const [ax] = this.span(x0), [, bx] = this.span(x1), [az] = this.span(z0), [, bz] = this.span(z1), [ay] = this.span(y0), [, by] = this.span(y1);
    for (let y = ay; y <= by; y++) for (const [x, z] of [[ax, az], [ax, bz], [bx, az], [bx, bz]]) this.fineClear(x, y, z);
    return this;
  }
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: Color, texture = 0.08) {
    const [ax] = this.span(Math.floor(cx - rx)), [, bx] = this.span(Math.ceil(cx + rx));
    const [ay] = this.span(Math.floor(cy - ry)), [, by] = this.span(Math.ceil(cy + ry));
    const [az] = this.span(Math.floor(cz - rz)), [, bz] = this.span(Math.ceil(cz + rz));
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) {
      const dd = ((this.d(x) - cx) / rx) ** 2 + ((this.d(y) - cy) / ry) ** 2 + ((this.d(z) - cz) / rz) ** 2;
      if (dd <= 1) this.fineSet(x, y, z, c, texture);
    }
    return this;
  }
  /** Rounded box (superellipse, exponent 4) that fills to its corners but softens them. */
  rounded(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: Color, texture = 0.08, test?: (x: number, y: number, z: number) => boolean) {
    const [ax] = this.span(Math.floor(cx - rx)), [, bx] = this.span(Math.ceil(cx + rx));
    const [ay] = this.span(Math.floor(cy - ry)), [, by] = this.span(Math.ceil(cy + ry));
    const [az] = this.span(Math.floor(cz - rz)), [, bz] = this.span(Math.ceil(cz + rz));
    for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) {
      const dx = this.d(x), dy = this.d(y), dz = this.d(z);
      if (Math.abs((dx - cx) / rx) ** 4 + Math.abs((dy - cy) / ry) ** 4 + Math.abs((dz - cz) / rz) ** 4 > 1) continue;
      if (test && !test(dx, dy, dz)) continue;
      this.fineSet(x, y, z, c, texture);
    }
    return this;
  }
  /** Line from point to point, `thick` design units wide. */
  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, thick = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1) * RES * 2;
    const w = Math.max(1, Math.round(thick * RES));
    for (let i = 0; i <= n; i++) {
      const fx = Math.round((x0 + ((x1 - x0) * i) / n) * RES), fy = Math.round((y0 + ((y1 - y0) * i) / n) * RES), fz = Math.round((z0 + ((z1 - z0) * i) / n) * RES);
      for (let a = 0; a < w; a++) for (let b = 0; b < w; b++) for (let e = 0; e < w; e++) this.fineSet(fx + a, fy + b, fz + e, c);
    }
    return this;
  }
  /** Repaint existing voxels that match a test (given design coordinates). */
  paint(test: (x: number, y: number, z: number) => boolean, c: Color, texture = 0.06) {
    for (const k of [...this.voxels.keys()]) {
      const [fx, fy, fz] = unkey(k);
      if (test(Math.floor(fx / RES), Math.floor(fy / RES), Math.floor(fz / RES))) this.fineSet(fx, fy, fz, c, texture);
    }
    return this;
  }
  /** Fine-resolution repaint: the test gets fine coordinates. */
  finePaint(test: (fx: number, fy: number, fz: number) => boolean, c: Color) {
    for (const k of [...this.voxels.keys()]) { const [fx, fy, fz] = unkey(k); if (test(fx, fy, fz)) this.voxels.set(k, c); }
    return this;
  }
  /** Bounds in fine voxels, or undefined if empty. */
  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const k of this.voxels.keys()) { const p = unkey(k); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); } }
    return this.voxels.size ? { min, max } : undefined;
  }
  build(): Part { return { name: this.name, pivot: [this.pivot[0] * RES, this.pivot[1] * RES, this.pivot[2] * RES], parent: this.parent, voxels: this.voxels }; }
}

/** Height in fine voxels. */
export function modelHeight(parts: Part[]): number {
  let top = 0;
  for (const p of parts) for (const k of p.voxels.keys()) top = Math.max(top, unkey(k)[1] + 1);
  return top;
}

export function voxelCount(m: Model): number {
  return m.parts.reduce((s, p) => s + p.voxels.size, 0);
}

/** Every voxel with its part, in model space (used for death bursts). */
export function allVoxels(m: Model): { x: number; y: number; z: number; c: Color }[] {
  const out: { x: number; y: number; z: number; c: Color }[] = [];
  for (const p of m.parts) for (const [k, c] of p.voxels) { const [x, y, z] = unkey(k); out.push({ x, y, z, c }); }
  return out;
}
