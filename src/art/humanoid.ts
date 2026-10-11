// Humanoid units: a race body (with sex, height and weight) plus a class outfit and weapons.
// Every hero's look is rolled from their seed; the player never edits it directly.
import { stream } from '../sim/rng';
import { modelHeight, PartBuilder, RES, shade, type Color, type Model, type Part } from './kit';
import { P } from './palette';
import { HAIR_STYLES, RACE_BODIES, type HairStyle } from './races';

export type Sex = 'm' | 'f';

export interface Look {
  race: string;
  sex: Sex;
  /** Offsets within the race's ranges. */
  height: number;
  weight: number;
  skin: Color;
  hair: Color | null;
  hairStyle: HairStyle;
  beard: boolean;
  accent: Color;
  detail: 'none' | 'scarf' | 'feather' | 'scar' | 'eyepatch' | 'earring';
  /** Cap, crest or plating accent for races that have one. */
  raceAccent: Color;
}

const ACCENTS: Color[] = [P.red, P.blue, P.green, P.purple, P.orange, P.teal, P.crimson, P.yellow, P.sky];

/** Roll a recruit's look from their seed. Cosmetic only. */
export function rollLook(race: string, seed: number | string, sex?: Sex): Look {
  const spec = RACE_BODIES[race] ?? RACE_BODIES.human;
  const r = stream('look', seed, race);
  const sx: Sex = sex ?? (r.chance(0.5) ? 'f' : 'm');
  const styles = HAIR_STYLES.filter((s) => (sx === 'f' ? s !== 'mohawk' && s !== 'bald' : true));
  let hairStyle: HairStyle = spec.features.includes('curly') ? 'curly' : r.pick(styles);
  if (race === 'orc' && sx === 'm' && r.chance(0.4)) hairStyle = 'mohawk';
  if (sx === 'f' && r.chance(0.5)) hairStyle = r.pick(['long', 'ponytail', 'braids', 'bun'] as HairStyle[]);
  const beardChance = spec.beard ? spec.beard[sx] : 0;
  return {
    race, sex: sx,
    height: spec.height[0] + r.int(spec.height[1] - spec.height[0] + 1),
    weight: spec.weight[0] + r.int(spec.weight[1] - spec.weight[0] + 1),
    skin: r.pick(spec.skins),
    hair: spec.hairs ? r.pick(spec.hairs) : null,
    hairStyle,
    beard: r.chance(beardChance),
    accent: r.pick(ACCENTS),
    detail: r.pick(['none', 'none', 'scarf', 'feather', 'scar', 'eyepatch', 'earring'] as const),
    raceAccent: spec.accents ? r.pick(spec.accents) : r.pick(ACCENTS),
  };
}

/** Body landmarks the outfits and weapons attach to. */
export interface Frame {
  legH: number;
  kneeY: number;
  ankleY: number;
  /** Height of the soles off the ground (floating races). */
  lift: number;
  torsoTop: number;
  hw: number;
  z0: number;
  z1: number;
  headY: number;
  headTop: number;
  hx: number;
  hz0: number;
  hz1: number;
  shoulderY: number;
  handY: number;
  armX: number;
}

export interface Rig {
  frame: Frame;
  /** Thighs (pivot at the hip), shins (knee) and feet (ankle). */
  legL: PartBuilder;
  legR: PartBuilder;
  shinL: PartBuilder;
  shinR: PartBuilder;
  footL: PartBuilder;
  footR: PartBuilder;
  torso: PartBuilder;
  head: PartBuilder;
  armL: PartBuilder;
  armR: PartBuilder;
  extras: PartBuilder[];
}

const odd = (n: number) => (n % 2 === 0 ? n + 1 : n);

/** Build the bare body for a look (skin, face, hair, race features). */
export function buildBody(look: Look): Rig {
  const spec = RACE_BODIES[look.race] ?? RACE_BODIES.human;
  const feats = new Set(spec.features);
  const lift = feats.has('float') ? 3 : 0;
  const legH = Math.max(3, spec.leg + Math.ceil(look.height / 2)) + lift;
  const torsoH = Math.max(5, spec.torso + Math.floor(look.height / 2));
  const W = odd(Math.max(5, spec.torsoW + look.weight - (look.sex === 'f' ? 1 : 0)));
  const D = spec.torsoD + (look.weight >= 2 ? 1 : 0);
  const hw = (W - 1) / 2;
  const z0 = -Math.floor(D / 2), z1 = z0 + D - 1;
  const torsoTop = legH + torsoH - 1;
  const [hwid, hh, hd] = spec.head;
  const hx = (odd(hwid) - 1) / 2;
  const hz1 = Math.floor(hd / 2), hz0 = hz1 - hd + 1;
  const headY = torsoTop + 1;
  const headTop = headY + hh - 1;
  const armX = hw + 1;
  const shoulderY = torsoTop;
  const handY = Math.max(lift + 1, shoulderY - spec.arm + 1);
  const f: Frame = { legH, kneeY: 0, ankleY: 0, lift, torsoTop, hw, z0, z1, headY, headTop, hx, hz0, hz1, shoulderY, handY, armX };
  const skin = look.skin, skinDark = shade(skin, 0.8);

  // legs: thigh (pivot at the hip), shin (at the knee) and foot (at the ankle), shaped rather than boxed
  const legW = Math.max(1, Math.min(3, hw - 1));
  const ankleY = lift + (legH - lift > 5 ? 2 : 1);
  const kneeY = ankleY + Math.max(1, Math.round((legH - ankleY) * 0.48));
  const rx = legW / 2 + 0.15, rz = Math.max(1, (z1 - z0 - 1) / 2), cz = (z0 + z1) / 2;
  const bigFeet = feats.has('bareFeet');
  const toe = Math.max(1.5, rz + 1.2) + (bigFeet ? 1 : 0), heel = rz * 0.75;
  const legParts = ([1, -1] as const).map((side) => {
    const n = side > 0 ? 'R' : 'L', cx = side * (legW + 1) / 2;
    const thigh = new PartBuilder(`leg${n}`, [cx, legH, cz]);
    thigh.taper(cx, cz, kneeY, legH + 0.5, (t) => [rx * (0.82 + 0.18 * t), rz * (0.86 + 0.2 * t), 0], skinDark);
    thigh.ellipsoid(cx, kneeY, cz, rx * 0.84, 0.9, rz * 0.88, skinDark);
    const shin = new PartBuilder(`shin${n}`, [cx, kneeY, cz], `leg${n}`);
    // the calf swells just below the knee, then thins to the ankle
    shin.taper(cx, cz, ankleY, kneeY + 0.3, (t) => {
      const calf = Math.sin(Math.PI * Math.min(1, t * 1.25));
      return [rx * (0.62 + 0.22 * t), rz * (0.66 + 0.24 * calf), -0.3 * calf];
    }, skinDark);
    shin.ellipsoid(cx, kneeY - 0.2, cz + rz * 0.7, rx * 0.6, 0.7, 0.55, skinDark); // kneecap
    const foot = new PartBuilder(`foot${n}`, [cx, ankleY, cz], `shin${n}`);
    // a sole that runs from heel to toe, the instep sloping up into the ankle
    foot.rounded(cx, lift + 0.4, cz + (toe - heel) / 2, rx * (bigFeet ? 1.15 : 0.95), 0.95, (toe + heel) / 2, skinDark, 0.06);
    foot.ellipsoid(cx, ankleY - 0.4, cz + 0.2, rx * 0.72, Math.max(0.8, ankleY - lift - 0.2), rz * 0.8, skinDark);
    return { thigh, shin, foot };
  });
  const [{ thigh: legR, shin: shinR, foot: footR }, { thigh: legL, shin: shinL, foot: footL }] = legParts;
  f.kneeY = kneeY; f.ankleY = ankleY;

  // torso
  const torso = new PartBuilder('torso', [0, legH, 0]);
  torso.rbox(-hw, legH, z0, hw, torsoTop, z1, skin);
  // taper to the waist, so bodies read as shoulders and hips rather than a slab
  if (hw >= 3) for (let y = legH + 1; y <= legH + Math.floor(torsoH * 0.45); y++) for (let z = z0; z <= z1; z++) { torso.clear(-hw, y, z); torso.clear(hw, y, z); }

  // arms (pivot at the shoulder)
  const armR = new PartBuilder('armR', [armX + 0.5, shoulderY, 0], 'torso');
  const armL = new PartBuilder('armL', [-armX - 0.5, shoulderY, 0], 'torso');
  for (const [arm, side] of [[armR, 1], [armL, -1]] as const) {
    const xa = side * armX, xb = side * (armX + 1);
    arm.box(xa, handY, -1, xb, shoulderY, 0, skin);
    arm.box(xa, handY, -1, xb, handY + 1, 0, skin);
  }

  // head (pivot at the neck), rounded
  const head = new PartBuilder('head', [0, headY, 0], 'torso');
  head.rounded(0, (headY + headTop) / 2, (hz0 + hz1) / 2, hx + 0.5, (headTop - headY + 1) / 2, (hz1 - hz0 + 1) / 2, skin, 0.05);

  // face on the front surface
  const eyeY = headY + Math.max(2, Math.floor(hh * 0.4));
  const ex = Math.max(2, Math.round(hx * 0.45));
  const eye = spec.eyes ?? P.ink;
  if (feats.has('boneFace')) {
    head.paint(() => true, P.bone);
    head.box(-ex - 1, eyeY - 1, hz1, -ex, eyeY + 1, hz1, P.ink, 0).box(ex, eyeY - 1, hz1, ex + 1, eyeY + 1, hz1, P.ink, 0);
    head.set(-ex, eyeY, hz1, eye).set(ex, eyeY, hz1, eye);
    head.box(-2, headY + 1, hz1, 2, headY + 1, hz1, P.boneShadow, 0);
    for (let x = -2; x <= 2; x += 2) head.set(x, headY + 1, hz1, P.ink);
  } else {
    const fz = hz1 * RES + RES - 1; // the face's front fine layer
    for (const sx of [-ex, ex]) {
      const fx = sx * RES;
      const ix = fx + (sx < 0 ? 0 : -1);
      head.fineBox(ix, eyeY * RES, fz, ix + 1, eyeY * RES + 2, fz, eye);
      if (!spec.eyes) head.fineSet(sx < 0 ? ix + 1 : ix, eyeY * RES + 2, fz, P.eyeWhite);
      // brow
      const brow = look.hair ?? shade(skin, 0.6);
      head.fineBox(ix - (sx < 0 ? 1 : 0), eyeY * RES + 4, fz, ix + 1 + (sx > 0 ? 1 : 0), eyeY * RES + 4, fz, brow);
    }
    if (!feats.has('snout') && !feats.has('visor')) {
      head.set(-ex - 1, eyeY - 1, hz1, shade(skin, 0.93)).set(ex + 1, eyeY - 1, hz1, shade(skin, 0.93));
      const fz = hz1 * RES + RES - 1;
      head.fineBox(-2, headY * RES + 3, fz, 1, headY * RES + 3, fz, shade(skin, 0.62));
    }
    if (look.sex === 'f' && !spec.eyes) for (const sx of [-ex, ex]) head.fineSet(sx * RES + (sx < 0 ? -2 : 1), eyeY * RES + 3, hz1 * RES + RES - 1, P.ink);
  }
  if (feats.has('bigNose')) head.box(0, eyeY - 2, hz1 + 1, 0, eyeY - 1, hz1 + 1, shade(skin, 0.9)).set(0, eyeY - 2, hz1 + 2, shade(skin, 0.85));
  else if (!feats.has('snout') && !feats.has('boneFace') && !feats.has('visor')) head.set(0, eyeY - 1, hz1 + 1, shade(skin, 0.9));

  // race features
  if (feats.has('pointyEars')) for (const s of [-1, 1]) head.line(s * (hx + 1), eyeY - 1, 0, s * (hx + 3), eyeY + 2, -1, skin).set(s * (hx + 1), eyeY, 0, skinDark);
  if (feats.has('smallEars')) for (const s of [-1, 1]) head.box(s * (hx + 1), eyeY - 1, -1, s * (hx + 1), eyeY, 0, skin);
  if (feats.has('bigEars')) for (const s of [-1, 1]) { head.box(s * (hx + 1), eyeY - 1, -1, s * (hx + 4), eyeY + 1, 0, skin); head.box(s * (hx + 2), eyeY, 0, s * (hx + 3), eyeY, 0, shade(skin, 0.75)); }
  if (feats.has('tusks')) for (const s of [-2, 2]) head.box(s, headY + 1, hz1 + 1, s, headY + 2, hz1 + 1, P.white);
  if (feats.has('brow')) head.box(-hx + 1, eyeY + 2, hz1 + 1, hx - 1, eyeY + 2, hz1 + 1, skinDark);
  if (feats.has('snout')) {
    head.box(-2, headY + 1, hz1 + 1, 2, eyeY - 1, hz1 + 3, skin);
    head.set(-1, eyeY - 1, hz1 + 3, P.ink).set(1, eyeY - 1, hz1 + 3, P.ink);
    head.box(-2, headY + 1, hz1 + 1, 2, headY + 1, hz1 + 3, shade(skin, 0.75));
  }
  if (feats.has('crest')) for (let z = hz0 + 1; z <= hz1 - 1; z++) head.box(0, headTop + 1, z, 0, headTop + 1 + ((z + 9) % 3 === 0 ? 2 : 1), z, look.raceAccent);
  if (feats.has('catEars')) for (const s of [-1, 1]) { head.box(s * (hx - 3), headTop + 1, -1, s * (hx - 1), headTop + 1, 0, skin); head.box(s * (hx - 2), headTop + 2, -1, s * (hx - 1), headTop + 3, 0, skin); head.set(s * (hx - 2), headTop + 1, 1, P.ratPink); }
  if (feats.has('whiskers')) for (const s of [-1, 1]) head.line(s * 2, eyeY - 2, hz1 + 1, s * (hx + 2), eyeY - 1, hz1 + 1, P.white);
  if (feats.has('fur')) head.box(-1, headY + 1, hz1 + 1, 1, eyeY - 1, hz1 + 1, P.eyeWhite);
  if (feats.has('mushroomCap')) {
    head.ellipsoid(0, headTop + 2, -1, hx + 4, 3.2, hx + 3, look.raceAccent, 0.1);
    for (const [x, z] of [[-4, 1], [3, -2], [0, 3], [-2, -4], [5, 2]]) head.set(x, headTop + 4, z, P.white).set(x + 1, headTop + 4, z, P.white);
    head.box(-hx - 3, headTop, -hx - 2, hx + 3, headTop, hx + 2, shade(look.raceAccent, 0.75), 0);
    for (const k of [...head.voxels.keys()]) void k;
  }
  if (feats.has('horns')) for (const s of [-1, 1]) head.line(s * (hx - 2), headTop, 0, s * (hx + 1), headTop + 4, -2, P.boneDark).set(s * (hx + 1), headTop + 5, -3, P.bone);
  if (feats.has('visor')) { head.box(-hx, eyeY - 1, hz1 + 1, hx, eyeY + 1, hz1 + 1, P.ink, 0); head.box(-ex, eyeY, hz1 + 1, ex, eyeY, hz1 + 1, spec.eyes ?? P.flame, 0); }
  if (feats.has('plating')) {
    torso.paint((x, y) => (x + y) % 4 === 0, shade(skin, 0.82));
    torso.box(-hw + 1, torsoTop - 2, z1 + 1, hw - 1, torsoTop - 1, z1 + 1, shade(skin, 1.15));
    for (const x of [-hw + 1, hw - 1]) torso.set(x, legH + 1, z1 + 1, P.gold);
  }
  const extras: PartBuilder[] = [];
  if (feats.has('tail')) {
    const tail = new PartBuilder('tail', [0, legH + 1, z0], 'torso');
    tail.line(0, legH + 1, z0 - 1, 0, legH - 1, z0 - 5, look.race === 'demonkin' ? shade(skin, 0.8) : skin, 1).line(0, legH - 1, z0 - 5, 0, legH + 1, z0 - 8, skin, 1);
    if (look.race === 'demonkin') tail.box(-1, legH + 1, z0 - 9, 1, legH + 2, z0 - 8, P.ink);
    extras.push(tail);
  }
  if (feats.has('wings')) {
    const wings = new PartBuilder('wings', [0, torsoTop - 2, z0], 'torso');
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) wings.box(s * (1 + i), torsoTop - 3 + Math.floor(i / 2), z0 - 1, s * (1 + i), torsoTop + 1 + Math.floor(i / 1.5), z0 - 1, i % 2 ? P.glass : 0xd8f4ff, 0);
    extras.push(wings);
  }

  // hair
  if (look.hair !== null && look.hairStyle !== 'bald') hair(head, look, f);
  if (look.beard) {
    const c = look.hair ?? P.hairGrey;
    head.box(-hx + 1, headY, hz1 + 1, hx - 1, eyeY - 2, hz1 + 1, c);
    head.box(-hx + 2, headY - 2, hz1 + 1, hx - 2, headY - 1, hz1 + 1, c);
    if (look.race === 'dwarf') torso.box(-2, torsoTop - 4, z1 + 1, 2, torsoTop, z1 + 1, c).set(0, torsoTop - 5, z1 + 1, c);
    head.set(0, eyeY - 1, hz1 + 1, shade(skin, 0.9));
  }
  // personal detail
  if (look.detail === 'scar') head.line(ex + 1, eyeY + 2, hz1, ex - 1, eyeY - 1, hz1, P.blush);
  if (look.detail === 'eyepatch') { head.box(ex - 1, eyeY, hz1, ex + 1, eyeY + 1, hz1, P.ink, 0); head.line(-hx, eyeY + 2, hz1, hx, eyeY + 1, hz1, P.ink); }
  if (look.detail === 'earring') head.set(hx + 1, eyeY - 2, 0, P.gold);
  if (look.detail === 'scarf') torso.box(-hw, torsoTop, z0 - 1, hw, torsoTop, z1 + 1, look.accent).box(hw - 2, torsoTop - 3, z1 + 1, hw - 1, torsoTop - 1, z1 + 1, look.accent);
  return { frame: f, legL, legR, shinL, shinR, footL, footR, torso, head, armL, armR, extras };
}

function hair(head: PartBuilder, look: Look, f: Frame) {
  const c = look.hair!;
  const { headY, headTop, hx, hz0, hz1 } = f;
  const top = headTop + 1;
  // cap of hair over the crown and back of the head
  const cap = (y0: number) => {
    for (let x = -hx; x <= hx; x++) for (let z = hz0; z <= hz1; z++) {
      const edge = Math.abs(x) === hx && (z === hz0 || z === hz1);
      if (!edge) head.set(x, top, z, c, 0.12);
    }
    head.box(-hx - 1, y0, hz0, -hx - 1, headTop, Math.floor(hz1 / 2), c).box(hx + 1, y0, hz0, hx + 1, headTop, Math.floor(hz1 / 2), c);
    head.box(-hx, y0, hz0 - 1, hx, headTop, hz0 - 1, c);
    head.box(-hx, headTop - 1, hz1 + 1, hx, headTop, hz1 + 1, c); // fringe
  };
  const eyeLine = headY + Math.floor((headTop - headY) * 0.55);
  switch (look.hairStyle) {
    case 'crop': for (let x = -hx; x <= hx; x++) for (let z = hz0; z <= hz1; z++) head.set(x, top, z, c, 0.12); break;
    case 'short': cap(eyeLine); break;
    case 'spiky': cap(eyeLine); for (let x = -hx + 1; x <= hx; x += 2) head.box(x, top + 1, -1, x, top + 1 + ((x + 9) % 3), 0, c); break;
    case 'mohawk': for (let z = hz0; z <= hz1; z++) head.box(-1, top, z, 1, top + 2, z, c); break;
    case 'curly': cap(eyeLine - 1); for (let x = -hx; x <= hx; x += 2) for (let z = hz0; z <= hz1; z += 2) head.set(x, top + 1, z, shade(c, 1.1)); break;
    case 'long': cap(headY - 3); head.box(-hx, headY - 5, hz0 - 1, hx, headTop, hz0 - 1, c); break;
    case 'ponytail': cap(eyeLine); head.box(-1, headY - 4, hz0 - 2, 1, headTop - 1, hz0 - 2, c).box(-1, headTop - 2, hz0 - 1, 1, headTop - 1, hz0 - 1, look.accent); break;
    case 'bun': cap(eyeLine); head.ellipsoid(0, top + 1, hz0 + 1, 2.4, 2.2, 2.4, c); break;
    case 'braids': cap(eyeLine); for (const s of [-1, 1]) for (let y = headY - 4; y <= eyeLine; y++) head.set(s * (hx + 1), y, 1, (y % 2 ? c : shade(c, 0.8))); break;
    default: break;
  }
}

// ---------------- outfits and weapons ----------------

export type Outfit = 'fighter' | 'rogue' | 'cleric' | 'mage' | 'ranger' | 'bard' | 'alchemist' | 'necromancer'
  | 'rags' | 'cultist' | 'robber' | 'zombie' | 'none';

function dress(rig: Rig, shirt: Color, pants: Color, boots: Color, look?: Look) {
  const { frame: f, torso, armL, armR } = rig;
  torso.paint(() => true, shirt);
  torso.paint((_x, y) => y === f.legH, shade(pants, 0.85));
  for (const leg of [rig.legL, rig.legR, rig.shinL, rig.shinR]) leg.paint(() => true, pants);
  const bare = look && RACE_BODIES[look.race]?.features.includes('bareFeet');
  for (const [shin, foot] of [[rig.shinL, rig.footL], [rig.shinR, rig.footR]]) {
    if (bare) {
      // big bare feet, furred on top
      foot.paint(() => true, look.skin);
      foot.paint((_x, y) => y > f.lift, look.hair ?? shade(look.skin, 0.8));
      shin.paint((_x, y) => y <= f.ankleY, look.skin);
      continue;
    }
    // boots with a turned-down cuff and a dark sole
    foot.paint(() => true, boots);
    foot.finePaint((_x, y) => y === f.lift * RES, shade(boots, 0.6));
    shin.paint((_x, y) => y <= f.ankleY + 1, boots);
    shin.paint((_x, y) => y === f.ankleY + 2 && f.kneeY - f.ankleY > 3, shade(boots, 1.2));
  }
  for (const arm of [armL, armR]) arm.paint((_x, y) => y > f.handY + 1, shirt);
}

function robe(rig: Rig, body: Color, trim: Color) {
  const { frame: f, torso, armL, armR } = rig;
  torso.paint(() => true, body);
  // the robe skirt hangs from the torso down to the ankles
  torso.rbox(-f.hw, 1, f.z0, f.hw, f.legH - 1, f.z1, body);
  torso.box(-f.hw - 1, 1, f.z0, f.hw + 1, 2, f.z1 + 1, shade(body, 0.85));
  torso.paint((x, y, z) => (z === f.z1 && Math.abs(x) <= 0) || y === 1, trim);
  for (const leg of [rig.legL, rig.legR, rig.shinL, rig.shinR, rig.footL, rig.footR]) leg.paint(() => true, P.leatherDark);
  for (const arm of [armL, armR]) arm.paint((_x, y) => y > f.handY + 1, body);
}

function hood(rig: Rig, c: Color, deep = false) {
  const { frame: f, head } = rig;
  const { headY, headTop, hx, hz0, hz1 } = f;
  const cy = (headY + headTop) / 2 + 0.6, cz = (hz0 + hz1) / 2 - 0.4;
  head.rounded(0, cy, cz, hx + 1.2, (headTop - headY) / 2 + 1.3, (hz1 - hz0) / 2 + 1.1, c, 0.1, (x, y, z) => {
    const inside = Math.abs(x) <= hx + 0.5 && y >= headY - 0.5 && y <= headTop + 0.5 && z >= hz0 - 0.5 && z <= hz1 + 0.5;
    const face = z >= hz1 - 1.5 && Math.abs(x) <= hx - (deep ? 1.5 : 0.5) && y >= headY - 0.5 && y <= headTop - (deep ? 2.5 : 1.5);
    return !inside && !face;
  });
  // shadow under the brim, and a small peak at the back
  head.box(-hx + 1, headTop - (deep ? 2 : 1), hz1 + 1, hx - 1, headTop - (deep ? 2 : 1), hz1 + 1, shade(c, 0.72));
  head.ellipsoid(0, headTop + 1.6, hz0 - 0.6, 1, 1.2, 1.2, c, 0.1);
}
function helmet(rig: Rig, c: Color, nasal = true) {
  const { frame: f, head } = rig;
  const { headTop, hx, hz0, hz1 } = f;
  const eyeLine = f.headY + Math.floor((headTop - f.headY) * 0.6);
  head.ellipsoid(0, headTop - 1, (hz0 + hz1) / 2, hx + 0.9, 2.6, (hz1 - hz0) / 2 + 0.9, c, 0.06);
  head.box(-hx - 1, eyeLine + 1, hz0 - 1, hx + 1, eyeLine + 1, hz1 + 1, shade(c, 0.8));
  head.box(-hx - 1, f.headY + 1, hz0 - 1, -hx - 1, eyeLine, hz0 + 2, c).box(hx + 1, f.headY + 1, hz0 - 1, hx + 1, eyeLine, hz0 + 2, c);
  if (nasal) head.box(0, eyeLine - 2, hz1 + 1, 0, eyeLine + 1, hz1 + 1, shade(c, 0.9));
  head.set(0, headTop + 2, 0, shade(c, 1.15));
}

/** A hand-held item, parented to an arm and pivoting at the hand. */
function held(rig: Rig, hand: 'R' | 'L', name: string): PartBuilder {
  const f = rig.frame;
  const s = hand === 'R' ? 1 : -1;
  const p = new PartBuilder(name, [s * (f.armX + 0.5), f.handY, 0], hand === 'R' ? 'armR' : 'armL');
  rig.extras.push(p);
  return p;
}

export function sword(rig: Rig, blade: Color = P.steelLight, len = 10) {
  const f = rig.frame, x = f.armX + 1, y = f.handY, z = 1;
  const p = held(rig, 'R', 'weapon');
  p.box(x, y - 1, z, x, y + 1, z, P.leatherDark).box(x - 2, y + 2, z, x + 2, y + 2, z, P.gold);
  p.box(x, y + 3, z, x, y + 3 + len, z + 1, blade, 0.04).box(x, y + 3, z, x, y + 3 + len, z, shade(blade, 0.85));
  p.set(x, y + 4 + len, z, blade);
  return p;
}
function dagger(rig: Rig, hand: 'R' | 'L') {
  const f = rig.frame, s = hand === 'R' ? 1 : -1, x = s * (f.armX + 1), y = f.handY;
  const p = held(rig, hand, hand === 'R' ? 'weapon' : 'offhand');
  p.box(x, y - 1, 1, x, y, 1, P.leatherDark).box(x - 1, y + 1, 1, x + 1, y + 1, 1, P.iron).box(x, y + 2, 1, x, y + 5, 1, P.steelLight);
}
function roundShield(rig: Rig, rim: Color, face: Color, sigil: Color) {
  const f = rig.frame, x = -(f.armX + 2), y = f.handY + 3;
  const p = held(rig, 'L', 'offhand');
  for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
    const d = a * a + b * b;
    if (d > 18) continue;
    p.set(x, y + a, b + 1, d > 12 ? rim : face, 0.08).set(x - 1, y + a, b + 1, shade(face, 0.8));
  }
  p.box(x + 1, y - 1, 0, x + 1, y + 1, 2, sigil).set(x + 1, y, -1, sigil).set(x + 1, y, 3, sigil).set(x + 2, y, 1, P.steelLight);
}
function staff(rig: Rig, orb: Color, wood: Color = P.wood, top: 'orb' | 'skull' = 'orb') {
  const f = rig.frame, x = f.armX + 1, y = f.handY;
  const p = held(rig, 'R', 'weapon');
  p.box(x, Math.max(0, y - 5), 1, x, y + 14, 1, wood, 0.12);
  if (top === 'orb') { p.box(x - 1, y + 15, 0, x + 1, y + 15, 2, P.goldDark); p.ellipsoid(x, y + 17, 1, 1.6, 1.6, 1.6, orb, 0.05); }
  else { p.ellipsoid(x, y + 17, 1, 1.8, 1.8, 1.8, P.bone, 0.05); p.set(x - 1, y + 17, 3, P.glowGreen).set(x + 1, y + 17, 3, P.glowGreen); }
}
function mace(rig: Rig) {
  const f = rig.frame, x = f.armX + 1, y = f.handY;
  const p = held(rig, 'R', 'weapon');
  p.box(x, y - 1, 1, x, y + 6, 1, P.wood).box(x - 1, y + 7, 0, x + 1, y + 9, 2, P.steel).set(x, y + 10, 1, P.steelLight);
  for (const [a, b] of [[-2, 1], [2, 1], [0, -1], [0, 3]]) p.set(x + a, y + 8, b, P.steelDark);
}
function bow(rig: Rig) {
  // keep the lower limb off the ground on short races
  const f = rig.frame, x = -(f.armX + 1), y = Math.max(f.handY + 1, 6);
  const p = held(rig, 'L', 'offhand');
  for (let i = -6; i <= 6; i++) p.set(x, y + i, 2 + Math.round(2.4 - (i * i) / 15), P.wood);
  for (let i = -6; i <= 6; i++) p.set(x, y + i, 0, P.whiteShadow);
  p.box(x, y - 1, 1, x, y + 1, 2, P.leatherDark);
}
function quiver(rig: Rig) {
  const f = rig.frame;
  const t = rig.torso;
  t.box(2, f.legH + 1, f.z0 - 2, 3, f.torsoTop + 1, f.z0 - 1, P.leather);
  for (let x = 2; x <= 3; x++) t.set(x, f.torsoTop + 2, f.z0 - 2, P.white).set(x, f.torsoTop + 3, f.z0 - 2, P.red);
}
function cape(rig: Rig, c: Color, long = true) {
  const f = rig.frame;
  const p = new PartBuilder('cape', [0, f.torsoTop, f.z0 - 1], 'torso');
  p.box(-f.hw, long ? 2 : f.legH, f.z0 - 1, f.hw, f.torsoTop, f.z0 - 1, c, 0.1);
  p.box(-f.hw + 1, long ? 1 : f.legH - 1, f.z0 - 1, f.hw - 1, long ? 1 : f.legH - 1, f.z0 - 1, shade(c, 0.8));
  rig.extras.push(p);
}
function lute(rig: Rig) {
  const f = rig.frame;
  const p = new PartBuilder('lute', [0, f.legH + 2, f.z1 + 1], 'torso');
  p.ellipsoid(-1, f.legH + 2, f.z1 + 1, 3, 2.6, 1.2, P.woodDark, 0.06).set(-1, f.legH + 2, f.z1 + 2, P.ink);
  p.line(1, f.legH + 3, f.z1 + 2, 5, f.legH + 8, f.z1 + 2, P.wood);
  p.box(5, f.legH + 8, f.z1 + 2, 6, f.legH + 9, f.z1 + 2, P.woodDark);
  rig.extras.push(p);
}
function flask(rig: Rig, liquid: Color) {
  const f = rig.frame, x = f.armX + 1, y = f.handY;
  const p = held(rig, 'R', 'weapon');
  p.ellipsoid(x, y + 2, 1, 1.6, 1.6, 1.6, liquid, 0.05).box(x, y + 4, 1, x, y + 5, 1, P.glass).set(x, y + 6, 1, P.brown);
}
function club(rig: Rig, scale = 1) {
  const f = rig.frame, x = f.armX + 1, y = f.handY;
  const p = held(rig, 'R', 'weapon');
  p.box(x, y - 1, 1, x, y + 5 * scale, 1, P.wood).ellipsoid(x, y + 7 * scale, 1, 1.6 * scale, 2.4 * scale, 1.6 * scale, P.woodDark, 0.12);
}
function bomb(rig: Rig) {
  const f = rig.frame, x = f.armX + 1, y = f.handY;
  const p = held(rig, 'R', 'weapon');
  p.ellipsoid(x, y + 2, 1, 2, 2, 2, P.black, 0.08).set(x, y + 4, 1, P.brown).set(x, y + 5, 1, P.flame);
}

export type Gear = 'sword' | 'swordShield' | 'daggers' | 'bow' | 'staff' | 'skullStaff' | 'mace' | 'lute' | 'flask' | 'club' | 'bigClub' | 'bomb' | 'shield' | 'none';

export function equip(rig: Rig, gear: Gear, accent: Color) {
  switch (gear) {
    case 'sword': sword(rig); break;
    case 'swordShield': sword(rig); roundShield(rig, P.steelDark, P.wood, accent); break;
    case 'shield': sword(rig, P.rust, 7); roundShield(rig, P.iron, P.woodDark, P.boneDark); break;
    case 'daggers': dagger(rig, 'R'); dagger(rig, 'L'); break;
    case 'bow': bow(rig); quiver(rig); break;
    case 'staff': staff(rig, P.glowCyan); break;
    case 'skullStaff': staff(rig, P.glowGreen, P.woodDark, 'skull'); break;
    case 'mace': mace(rig); break;
    case 'lute': lute(rig); dagger(rig, 'R'); break;
    case 'flask': flask(rig, P.glowGreen); break;
    case 'club': club(rig); break;
    case 'bigClub': club(rig, 1.4); break;
    case 'bomb': bomb(rig); break;
    default: break;
  }
}

export function clothe(rig: Rig, outfit: Outfit, look: Look) {
  const f = rig.frame;
  const a = look.accent;
  switch (outfit) {
    case 'fighter': {
      dress(rig, P.steel, P.brown, P.leatherDark, look);
      rig.torso.paint((x, y) => (x + y) % 2 === 0, P.steelDark, 0.04);
      rig.torso.box(-2, f.legH, f.z1 + 1, 2, f.torsoTop - 1, f.z1 + 1, a).box(-1, f.legH + 2, f.z1 + 1, 1, f.legH + 3, f.z1 + 1, shade(a, 1.25));
      rig.torso.box(-f.hw, f.legH + 1, f.z0, f.hw, f.legH + 1, f.z1 + 1, P.leather).set(0, f.legH + 1, f.z1 + 1, P.gold);
      for (const [arm, s] of [[rig.armR, 1], [rig.armL, -1]] as const) arm.box(s * f.armX - (s < 0 ? 1 : 0), f.shoulderY - 1, -2, s * f.armX + (s > 0 ? 1 : 0), f.shoulderY + 1, 1, P.steelLight);
      helmet(rig, P.steel);
      break;
    }
    case 'rogue':
      dress(rig, P.blackSoft, P.black, P.leatherDark, look);
      rig.torso.box(-f.hw, f.legH + 1, f.z0, f.hw, f.legH + 1, f.z1 + 1, P.leather).line(-f.hw, f.legH + 2, f.z1 + 1, f.hw, f.torsoTop - 1, f.z1 + 1, P.leatherDark);
      hood(rig, P.forest, true);
      rig.head.box(-f.hx + 1, f.headY, f.hz1 + 1, f.hx - 1, f.headY + 2, f.hz1 + 1, a === P.red ? P.crimson : P.blackSoft);
      cape(rig, P.forest, false);
      break;
    case 'cleric':
      robe(rig, P.white, P.gold);
      rig.torso.box(-1, f.torsoTop - 4, f.z1 + 1, 1, f.torsoTop - 4, f.z1 + 1, P.gold).box(0, f.torsoTop - 6, f.z1 + 1, 0, f.torsoTop - 2, f.z1 + 1, P.gold);
      rig.torso.box(-f.hw, f.legH + 1, f.z0, f.hw, f.legH + 1, f.z1 + 1, a);
      hood(rig, P.whiteShadow);
      rig.head.box(-f.hx - 1, f.headTop - 1, f.hz1 + 1, f.hx + 1, f.headTop - 1, f.hz1 + 1, P.gold);
      break;
    case 'mage': {
      robe(rig, P.purple, P.gold);
      rig.torso.box(-f.hw, f.legH + 1, f.z0, f.hw, f.legH + 1, f.z1 + 1, a);
      const h = rig.head, top = f.headTop - 1;
      h.ellipsoid(0, top, 0, f.hx + 4, 0.6, f.hx + 4, P.purpleDark, 0.05);
      for (let i = 0; i < 9; i++) {
        const r = Math.max(0.6, (f.hx + 1) * (1 - i / 9));
        h.ellipsoid(-Math.floor(i * i / 30), top + 1 + i, -Math.floor(i * i / 20), r, 0.6, r, P.purple, 0.08);
      }
      h.box(-f.hx - 1, top + 1, -f.hx - 1, f.hx + 1, top + 1, f.hx + 1, a);
      for (let x = -f.hx - 1; x <= f.hx + 1; x++) for (let z = -f.hx - 1; z <= f.hx + 1; z++) if (x * x + z * z > (f.hx + 1.3) ** 2) h.clear(x, top + 1, z);
      break;
    }
    case 'ranger':
      dress(rig, P.green, P.brown, P.leatherDark, look);
      rig.torso.box(-f.hw, f.legH + 1, f.z0, f.hw, f.legH + 1, f.z1 + 1, P.leather).set(0, f.legH + 1, f.z1 + 1, P.bronze);
      rig.torso.line(-f.hw, f.torsoTop, f.z1 + 1, f.hw, f.legH + 2, f.z1 + 1, P.leatherDark);
      hood(rig, P.forest);
      cape(rig, P.greenDark, true);
      break;
    case 'bard':
      dress(rig, P.white, P.blueDark, P.leather, look);
      rig.torso.box(-f.hw, f.legH, f.z1 + 1, -1, f.torsoTop, f.z1 + 1, a).box(1, f.legH, f.z1 + 1, f.hw, f.torsoTop, f.z1 + 1, a);
      rig.head.ellipsoid(0, f.headTop + 1, -1, f.hx + 1.5, 1.2, f.hx + 0.5, a, 0.06);
      rig.head.line(2, f.headTop + 1, -3, 5, f.headTop + 6, -6, P.white).set(5, f.headTop + 7, -6, P.red);
      break;
    case 'alchemist':
      dress(rig, P.tan, P.brown, P.leatherDark, look);
      rig.torso.box(-f.hw + 1, f.legH - 2, f.z1 + 1, f.hw - 1, f.torsoTop - 2, f.z1 + 1, P.leather).box(-f.hw, f.torsoTop - 2, f.z1 + 1, f.hw, f.torsoTop - 2, f.z1 + 1, P.leatherDark);
      for (const s of [-1, 1]) rig.head.box(s * 3 - 1, f.headTop - 1, f.hz1 + 1, s * 3 + 1, f.headTop, f.hz1 + 1, P.bronze).set(s * 3, f.headTop - 1, f.hz1 + 2, P.glass);
      rig.head.box(-f.hx - 1, f.headTop - 1, f.hz0, f.hx + 1, f.headTop - 1, f.hz1, P.leatherDark);
      for (const x of [-f.hw, f.hw]) rig.torso.box(x, f.legH, f.z1 - 1, x, f.legH + 2, f.z1, P.leather);
      break;
    case 'necromancer':
      robe(rig, P.black, P.violet);
      hood(rig, P.blackSoft, true);
      rig.torso.box(-1, f.torsoTop - 3, f.z1 + 1, 1, f.torsoTop - 1, f.z1 + 1, P.bone).set(0, f.torsoTop - 2, f.z1 + 2, P.ink);
      cape(rig, P.purpleDark, true);
      break;
    case 'cultist':
      robe(rig, P.crimson, P.black);
      hood(rig, P.redDark, true);
      rig.torso.box(-1, f.torsoTop - 4, f.z1 + 1, 1, f.torsoTop - 2, f.z1 + 1, P.gold);
      break;
    case 'robber':
      dress(rig, P.brown, P.brownDark, P.leatherDark, look);
      hood(rig, P.leather);
      rig.head.box(-f.hx, f.headY, f.hz1 + 1, f.hx, f.headY + 2, f.hz1 + 1, P.redDark);
      rig.torso.box(f.hw - 1, f.legH - 1, f.z0 - 2, f.hw, f.torsoTop - 1, f.z0 - 1, P.tan);
      break;
    case 'rags':
      dress(rig, P.rot, P.brownDark, P.brownDark, look);
      rig.torso.paint((x, y) => (x * 3 + y) % 5 === 0, shade(P.rot, 0.7));
      for (let x = -f.hw; x <= f.hw; x += 2) rig.torso.set(x, f.legH - 1, f.z1, P.rot);
      break;
    case 'zombie':
      dress(rig, P.rot, P.brownDark, P.brownDark, look);
      rig.torso.paint((x, y) => (x * 7 + y * 3) % 6 === 0, look.skin);
      break;
    default:
      dress(rig, P.tan, P.brown, P.leatherDark, look);
  }
}

export function assemble(id: string, rig: Rig, style: Model['style'], scale = 1): Model {
  const parts: Part[] = [rig.legL, rig.legR, rig.shinL, rig.shinR, rig.footL, rig.footR, rig.torso, rig.head, rig.armL, rig.armR, ...rig.extras].map((p) => p.build());
  return { id, rig: 'biped', parts, scale, height: modelHeight(parts), style };
}

/** Classes → outfit and gear. */
/** Specialists (T2) read at a glance: the base outfit plus a mark of rank in the class's colour. */
export type Mark = { kind: 'mantle' | 'pauldrons'; color: Color };
export const CLASS_LOOK: Record<string, { outfit: Outfit; gear: Gear; style: Model['style']; mark?: Mark }> = {
  fighter: { outfit: 'fighter', gear: 'swordShield', style: 'melee' },
  rogue: { outfit: 'rogue', gear: 'daggers', style: 'melee' },
  cleric: { outfit: 'cleric', gear: 'mace', style: 'caster' },
  mage: { outfit: 'mage', gear: 'staff', style: 'caster' },
  ranger: { outfit: 'ranger', gear: 'bow', style: 'ranged' },
  bard: { outfit: 'bard', gear: 'lute', style: 'caster' },
  alchemist: { outfit: 'alchemist', gear: 'flask', style: 'ranged' },
  necromancer: { outfit: 'necromancer', gear: 'skullStaff', style: 'caster' },
  knight: { outfit: 'fighter', gear: 'swordShield', style: 'melee', mark: { kind: 'pauldrons', color: P.steelLight } },
  berserker: { outfit: 'fighter', gear: 'bigClub', style: 'melee', mark: { kind: 'mantle', color: 0x6a4a30 } },
  sniper: { outfit: 'ranger', gear: 'bow', style: 'ranged', mark: { kind: 'mantle', color: P.greenDark } },
  assassin: { outfit: 'rogue', gear: 'daggers', style: 'melee', mark: { kind: 'mantle', color: P.black } },
  trickster: { outfit: 'rogue', gear: 'daggers', style: 'melee', mark: { kind: 'mantle', color: P.purple } },
  beastmaster: { outfit: 'ranger', gear: 'bow', style: 'ranged', mark: { kind: 'mantle', color: 0x8a8478 } },
  priest: { outfit: 'cleric', gear: 'mace', style: 'caster', mark: { kind: 'mantle', color: P.gold } },
  inquisitor: { outfit: 'cleric', gear: 'mace', style: 'melee', mark: { kind: 'pauldrons', color: P.redDark } },
  elementalist: { outfit: 'mage', gear: 'staff', style: 'caster', mark: { kind: 'mantle', color: P.blue } },
  chronomancer: { outfit: 'mage', gear: 'staff', style: 'caster', mark: { kind: 'pauldrons', color: P.bronze } },
  skald: { outfit: 'bard', gear: 'bigClub', style: 'melee', mark: { kind: 'pauldrons', color: P.iron } },
  minstrel: { outfit: 'bard', gear: 'lute', style: 'caster', mark: { kind: 'mantle', color: P.teal } },
  grenadier: { outfit: 'alchemist', gear: 'flask', style: 'ranged', mark: { kind: 'pauldrons', color: P.leatherDark } },
  apothecary: { outfit: 'alchemist', gear: 'flask', style: 'ranged', mark: { kind: 'mantle', color: P.green } },
  lich: { outfit: 'necromancer', gear: 'skullStaff', style: 'caster', mark: { kind: 'mantle', color: 0x2a1a3a } },
  bonecaller: { outfit: 'necromancer', gear: 'skullStaff', style: 'caster', mark: { kind: 'pauldrons', color: P.bone } },
};

/** A Specialist's mark: a cape down the back, or shoulder plates. */
function mark(rig: Rig, m: Mark) {
  const { frame: f, torso } = rig;
  if (m.kind === 'mantle') {
    torso.box(-f.hw, Math.max(1, f.legH - 3), f.z0 - 1, f.hw, f.torsoTop, f.z0 - 1, m.color, 0.1);
    torso.box(-f.hw - 1, f.torsoTop - 1, f.z0 - 1, f.hw + 1, f.torsoTop, f.z1, shade(m.color, 1.1));
  } else {
    for (const sx of [-1, 1]) torso.rounded(sx * (f.hw + 0.5), f.torsoTop - 0.5, (f.z0 + f.z1) / 2, 2, 1.6, (f.z1 - f.z0) / 2 + 1, m.color, 0.08);
  }
}

/** A hero model: race body + class outfit, varied by the hero's look. */
const COVERED: ReadonlySet<Outfit> = new Set(['fighter', 'rogue', 'cleric', 'ranger', 'necromancer', 'cultist', 'robber']);

export function heroModel(classId: string, look: Look, id = `hero:${classId}:${look.race}`): Model {
  const cl = CLASS_LOOK[classId] ?? CLASS_LOOK.fighter;
  const rig = buildBody(COVERED.has(cl.outfit) ? { ...look, hairStyle: 'bald' } : look);
  clothe(rig, cl.outfit, look);
  equip(rig, cl.gear, look.accent);
  if (cl.mark) mark(rig, cl.mark);
  if (look.detail === 'feather' && cl.outfit !== 'bard') rig.head.line(rig.frame.hx, rig.frame.headTop, -1, rig.frame.hx + 2, rig.frame.headTop + 4, -3, look.accent);
  return assemble(id, rig, cl.style);
}
