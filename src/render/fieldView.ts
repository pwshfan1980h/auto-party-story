// The battlefield as voxels: flagstone floor with cliff edges, authored cover pieces, hazards and dressing.
import * as THREE from 'three';
import { PartBuilder, shade, unkey, type Color } from '../art/kit';
import { grade, P } from '../art/palette';
import { NAV, type Field } from '../sim/field';
import { HAZARDS } from '../sim/data';
import { stream } from '../sim/rng';
import { meshVoxels } from './voxmesh';
import { unitMaterial, VOXEL } from './unitView';

const T = 32; // design units per tile (the kit's design scale)
/** Each biome's stone: flagstones in the crypt, damp green-brown rock and moss in the caverns. */
const BIOME_LOOK: Record<string, { stone: number; alt: number; altChance: number; mortar: number; cliff: number; cliffDark: number; specks?: number[] }> = {
  crypt: { stone: 0x5e5a6e, alt: 0x4e4a5c, altChance: 0.08, mortar: 0x2a2632, cliff: 0x3a2e34, cliffDark: 0x30262c },
  fungal: { stone: 0x4c5446, alt: 0x3e5a36, altChance: 0.22, mortar: 0x1c221c, cliff: 0x2a3026, cliffDark: 0x222820, specks: [0x7ae8ff, 0xb08aff, 0x9ef07a] },
};
/** Floor stone under each kind of ground hazard. */
const HAZARD_FLOOR: Record<string, number> = { spore_vent: 0x4a5a3a, spikes: 0x5a4848, fire: 0x4a2418, acid: 0x3e5a24, miasma_pit: 0x3a4430 };

/** World position of tile coordinates: the field is centred on the origin. */
export function tileToWorld(f: Field, x: number, y: number): [number, number] {
  return [x - f.w / 2, y - f.h / 2];
}

function mesh(p: PartBuilder, at: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(meshVoxels(p.voxels), unitMaterial);
  m.scale.setScalar(VOXEL);
  m.position.set(at[0], at[1], at[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Flagstone floor: 2×2 stones per tile, mortar lines, cracks, and dark cliffs where the room falls away. */
function floor(f: Field, seed: number): THREE.Mesh {
  const look = BIOME_LOOK[f.biome ?? 'crypt'] ?? BIOME_LOOK.crypt;
  const rng = stream(seed, 'floor-look');
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < f.w && y < f.h && f.tiles[y * f.w + x] !== 0;
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const lin = (c0: number, s: number) => { const c = grade(c0); return [Math.pow(((c >> 16) & 255) / 255, 2.2) * s, Math.pow(((c >> 8) & 255) / 255, 2.2) * s, Math.pow((c & 255) / 255, 2.2) * s]; };
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], color: number, s: number) => {
    const rgb = lin(color, s);
    for (const v of [a, b, c, a, c, d]) { pos.push(...v); nor.push(...n); col.push(...rgb); }
  };
  const top = 3, mortar = 1;
  for (let ty = 0; ty < f.h; ty++) for (let tx = 0; tx < f.w; tx++) {
    if (!solid(tx, ty)) continue;
    const hazard = f.hazards.find((h) => h.cells.includes(ty * f.w + tx) && HAZARDS.ground[h.kind]?.tile !== false);
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      // one stone: a raised slab with a 1-voxel mortar gap around it
      const tint = 0.82 + rng.next() * 0.3;
      const base = hazard ? (HAZARD_FLOOR[hazard.kind] ?? 0x5a4848) : rng.chance(look.altChance) ? look.alt : look.stone;
      const c = shade(base, tint);
      const x0 = tx * T + sx * 16 + 1, z0 = ty * T + sy * 16 + 1, x1 = x0 + 14, z1 = z0 + 14;
      const y = rng.chance(0.15) ? top - 1 : top;
      quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], c, 1);
      quad([x0, y, z1], [x0, mortar, z1], [x1, mortar, z1], [x1, y, z1], [0, 0, 1], c, 0.82);
      quad([x1, y, z0], [x1, y, z1], [x1, mortar, z1], [x1, mortar, z0], [1, 0, 0], c, 0.9);
      quad([x0, mortar, z0], [x0, y, z0], [x1, y, z0], [x1, mortar, z0], [0, 0, -1], c, 0.7);
      quad([x0, mortar, z0], [x0, mortar, z1], [x0, y, z1], [x0, y, z0], [-1, 0, 0], c, 0.78);
    }
    // mortar bed under the stones
    const mx0 = tx * T, mz0 = ty * T, mx1 = mx0 + T, mz1 = mz0 + T;
    quad([mx0, mortar, mz0], [mx0, mortar, mz1], [mx1, mortar, mz1], [mx1, mortar, mz0], [0, 1, 0], look.mortar, 1);
    // cliff faces where the room falls away
    const drop = -18;
    if (!solid(tx, ty + 1)) quad([mx0, mortar, mz1], [mx0, drop, mz1], [mx1, drop, mz1], [mx1, mortar, mz1], [0, 0, 1], look.cliff, 0.8);
    if (!solid(tx + 1, ty)) quad([mx1, mortar, mz0], [mx1, mortar, mz1], [mx1, drop, mz1], [mx1, drop, mz0], [1, 0, 0], look.cliff, 0.9);
    if (!solid(tx, ty - 1)) quad([mx0, drop, mz0], [mx0, mortar, mz0], [mx1, mortar, mz0], [mx1, drop, mz0], [0, 0, -1], look.cliffDark, 0.7);
    if (!solid(tx - 1, ty)) quad([mx0, drop, mz0], [mx0, drop, mz1], [mx0, mortar, mz1], [mx0, mortar, mz0], [-1, 0, 0], look.cliffDark, 0.78);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, unitMaterial);
  m.scale.setScalar(1 / T);
  m.position.set(-f.w / 2, -top / T, -f.h / 2);
  m.receiveShadow = true;
  return m;
}

/** Authored cover pieces, in the kit's design units (a tile is 32 wide). */
function cover(type: string, rng: ReturnType<typeof stream>): PartBuilder {
  const p = new PartBuilder(type, [0, 0, 0]);
  const stone = 0x76707e, dark = 0x4a4656;
  switch (type) {
    case 'pillar': {
      const h = 40 + rng.int(14);
      p.rbox(-10, 0, -10, 9, 3, 9, dark);
      p.rbox(-8, 4, -8, 7, h, 7, stone, 0.12);
      for (let y = 10; y < h; y += 11) p.box(-8.5, y, -8.5, 7.5, y, 7.5, dark, 0.05);
      p.rbox(-10, h + 1, -10, 9, h + 4, 9, shade(stone, 1.08));
      break;
    }
    case 'broken_pillar': {
      p.rbox(-10, 0, -10, 9, 3, 9, dark);
      p.rbox(-8, 4, -8, 7, 14, 7, stone, 0.12);
      for (let i = 0; i < 26; i++) { const x = rng.int(16) - 8, z = rng.int(16) - 8; p.box(x, 15, z, x, 15 + rng.int(6), z, stone, 0.12); }
      for (let i = 0; i < 6; i++) { const x = rng.int(30) - 15, z = rng.int(30) - 15; p.box(x, 0, z, x + 2, 2, z + 2, stone); }
      break;
    }
    case 'coffin': {
      p.rbox(-6, 0, -12, 5, 7, 11, P.woodDark, 0.1);
      p.rbox(-7, 8, -13, 6, 9, 12, P.wood, 0.1);
      p.box(-1, 10, -6, 0, 10, 4, P.gold).box(-3, 10, -2, 2, 10, -1, P.gold);
      break;
    }
    case 'mushroom_stalk': {
      p.ellipsoid(0, 10, 0, 3, 11, 3, 0xd8ccb4, 0.08);
      p.ellipsoid(0, 22, 0, 11, 5, 11, 0x8a4ab0, 0.1);
      for (const [x, z] of [[-5, 2], [4, -3], [1, 6], [-2, -6]]) p.box(x, 26, z, x + 1, 26, z + 1, P.glowCyan);
      break;
    }
    case 'crystal_cluster': {
      for (let i = 0; i < 5; i++) { const x = rng.int(12) - 6, z = rng.int(12) - 6, h = 10 + rng.int(14); p.line(x, 0, z, x + (rng.next() - 0.5) * 6, h, z + (rng.next() - 0.5) * 6, i % 2 ? 0x7ad0ff : 0xb08aff, 2.5); }
      break;
    }
    default: {
      p.ellipsoid(0, 6, 0, 11, 8, 10, 0x6a6474, 0.14);
      p.ellipsoid(4, 12, -2, 6, 5, 6, 0x5e5868, 0.14);
    }
  }
  return p;
}

function spikes(): PartBuilder {
  const p = new PartBuilder('spikes', [0, 0, 0]);
  for (let x = -12; x <= 12; x += 6) for (let z = -12; z <= 12; z += 6) p.line(x, 0, z, x, 6, z, P.steelDark, 1).box(x, 6, z, x, 7, z, P.steelLight);
  return p;
}

function boneScatter(rng: ReturnType<typeof stream>): PartBuilder {
  const p = new PartBuilder('bones', [0, 0, 0]);
  for (let i = 0; i < 4; i++) { const a = rng.next() * 6.28, x = rng.int(12) - 6, z = rng.int(12) - 6; p.line(x, 0, z, x + Math.cos(a) * 8, 0, z + Math.sin(a) * 8, P.bone, 1); }
  p.ellipsoid(4, 2, -3, 3, 2.6, 3, P.bone, 0.05);
  p.box(3, 2, 0, 3, 2.5, 0, P.ink).box(5, 2, 0, 5, 2.5, 0, P.ink);
  return p;
}

export function brazier(): PartBuilder {
  const p = new PartBuilder('brazier', [0, 0, 0]);
  p.box(-2, 0, -2, 1, 16, 1, P.iron, 0.08);
  p.ellipsoid(0, 18, 0, 8, 3, 8, 0x4a3a30, 0.1);
  p.ellipsoid(0, 20, 0, 6, 1.5, 6, 0x2a1a14, 0);
  return p;
}

export interface FieldView { group: THREE.Group; fires: THREE.Vector3[] }

export function buildField(f: Field, seed: number): FieldView {
  const group = new THREE.Group();
  group.add(floor(f, seed));
  const rng = stream(seed, 'field-dressing');
  for (const c of f.cover) {
    const [x, z] = tileToWorld(f, c.x + 0.5, c.y + 0.5);
    const m = mesh(cover(c.type, rng), [x, 0, z]);
    m.rotation.y = rng.int(4) * Math.PI / 2;
    group.add(m);
  }
  for (const h of f.hazards) if (h.kind === 'spikes') for (const cell of h.cells) {
    const [x, z] = tileToWorld(f, (cell % f.w) + 0.5, Math.floor(cell / f.w) + 0.5);
    group.add(mesh(spikes(), [x, 0, z]));
  }
  // bones scattered in the middle band
  for (let i = 0; i < 6; i++) {
    const tx = 3 + rng.int(Math.max(1, f.w - 6)), ty = rng.int(f.h);
    if (f.tiles[ty * f.w + tx] !== 1) continue;
    const [x, z] = tileToWorld(f, tx + rng.next(), ty + rng.next());
    group.add(mesh(boneScatter(rng), [x, 0, z]));
  }
  const look = BIOME_LOOK[f.biome ?? 'crypt'];
  if (look?.specks) {
    // glowing fungus: unlit specks that read in the dark, and a dim light from the first crystal clusters
    const specks = new THREE.Group();
    const mats = look.specks.map((c) => new THREE.MeshBasicMaterial({ color: c }));
    const geo = new THREE.BoxGeometry(0.035, 0.02, 0.035);
    for (let i = 0; i < 26; i++) {
      const tx = rng.int(f.w), ty = rng.int(f.h);
      if (f.tiles[ty * f.w + tx] !== 1) continue;
      const [x, z] = tileToWorld(f, tx + rng.next(), ty + rng.next());
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Mesh(geo, mats[(i + k) % mats.length]);
        m.position.set(x + (rng.next() - 0.5) * 0.18, 0.01, z + (rng.next() - 0.5) * 0.18);
        specks.add(m);
      }
    }
    group.add(specks);
    let lights = 0;
    for (const c of f.cover) if (c.type === 'crystal_cluster' && lights < 2) {
      const [x, z] = tileToWorld(f, c.x + 0.5, c.y + 0.5);
      const l = new THREE.PointLight(lights ? 0xb08aff : 0x7ae8ff, 0.9, 3.5, 1.6);
      l.position.set(x, 0.7, z);
      group.add(l);
      lights++;
    }
  }
  void NAV; void unkey;
  return { group, fires: [] };
}

export const COLOR_GLOW: Color = 0xffa23a;
