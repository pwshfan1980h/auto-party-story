// Monster models: species bodies × archetype gear × rank scale. All original.
import { ARCHETYPES, ENEMIES, RANKS } from '../sim/data';
import { assemble, buildBody, clothe, equip, rollLook, type Frame, type Gear, type Outfit, type Rig } from './humanoid';
import { modelHeight, PartBuilder, shade, type Color, type Model, type Part } from './kit';
import { P } from './palette';

const ARCH_GEAR: Record<string, Gear> = {
  grunt: 'sword', brute: 'bigClub', skirmisher: 'daggers', shooter: 'bow', caster: 'staff', mender: 'staff',
  summoner: 'skullStaff', guardian: 'shield', swarm: 'none', bomber: 'bomb', wailer: 'none',
};
const ARCH_STYLE: Record<string, Model['style']> = {
  shooter: 'ranged', caster: 'caster', mender: 'caster', summoner: 'caster', wailer: 'caster', swarm: 'bite',
};
const RANK_SCALE: Record<string, number> = { minion: 0.72, normal: 1, veteran: 1.05, elite: 1.15, champion: 1.3, boss: 2.1 };

// ---------------- skeleton: bones instead of a body ----------------

function skeletonRig(): Rig {
  // human proportions: long shins, a ribcage, and a skull about a fifth of the height
  const legH = 11, torsoTop = 21, hw = 4, z0 = -2, z1 = 2, headY = 22, headTop = 28, hx = 3, hz0 = -3, hz1 = 3;
  const f: Frame = { legH, torsoTop, hw, z0, z1, headY, headTop, hx, hz0, hz1, shoulderY: torsoTop, handY: 11, armX: 5 };
  const B = P.bone, S = P.boneShadow, D = P.boneDark;
  const legR = new PartBuilder('legR', [2, legH, 0]), legL = new PartBuilder('legL', [-2, legH, 0]);
  for (const [leg, s] of [[legR, 1], [legL, -1]] as const) {
    leg.box(s * 2, 1, 0, s * 2, legH - 1, 0, B).set(s * 2, 6, 1, S).set(s * 2, 5, 0, D).box(s * 1, 0, 0, s * 3, 0, 2, B);
  }
  const torso = new PartBuilder('torso', [0, legH, 0]);
  torso.box(-2, legH, -1, 2, legH + 1, 1, S); // pelvis
  torso.box(0, legH + 2, -1, 0, torsoTop, -1, D); // spine
  for (let y = legH + 4; y <= torsoTop - 1; y += 2) {
    const w = y < legH + 6 ? 2 : 3;
    for (let x = -w; x <= w; x++) torso.set(x, y, Math.abs(x) >= w ? 0 : 1, B);
    torso.set(-w, y, -1, S).set(w, y, -1, S);
  }
  torso.box(-hw, torsoTop, -1, hw, torsoTop, 0, B); // collarbones
  const armR = new PartBuilder('armR', [5.5, torsoTop, 0], 'torso'), armL = new PartBuilder('armL', [-5.5, torsoTop, 0], 'torso');
  for (const [arm, s] of [[armR, 1], [armL, -1]] as const) {
    arm.box(s * 5, 13, 0, s * 5, torsoTop, 0, B).set(s * 5, 16, 1, S).box(s * 5, 11, -1, s * 6, 12, 0, B);
  }
  const head = new PartBuilder('head', [0, headY, 0], 'torso');
  head.box(0, headY, -1, 0, headY + 1, -1, D); // neck
  head.ellipsoid(0, headY + 4, 0, 3.3, 3.1, 3.4, B, 0.06);
  head.box(-2, headY + 1, 0, 2, headY + 1, 3, B); // jaw
  for (let x = -1; x <= 1; x++) head.set(x, headY + 1, 3, x === 0 ? P.ink : B);
  for (const s of [-1.5, 1.5]) head.ellipsoid(s, headY + 4, 3, 1, 1.1, 0.8, P.ink, 0).set(Math.round(s), headY + 4, 4, shade(P.glowCyan, 0.8));
  head.set(0, headY + 2, 3, P.ink);
  head.paint((_x, y, z) => z < -1 && y > headY + 4, S);
  return { frame: f, legL, legR, torso, head, armL, armR, extras: [] };
}

// ---------------- non-humanoid rigs ----------------

function rat(scale: number, big = false): Model {
  // a sewer rat: long, low and hunched, with a ridge of mangy fur down the spine
  const fur = P.ratFur, dark = P.ratFurDark, bare = 0x9a7a72;
  const body = new PartBuilder('torso', [0, 4, 0]);
  body.ellipsoid(0, 4.6, -1, 3, 2.8, 8, fur, 0.18);
  body.ellipsoid(0, 6.6, -2.5, 2, 1.8, 4.8, dark, 0.2); // the hunch
  body.paint((x, y, z) => (x * 7 + y * 3 + z * 5) % 11 === 0, dark); // mange
  body.paint((_x, y) => y <= 2, shade(fur, 0.85));
  if (big) for (let z = -3; z <= 2; z += 2) body.box(-3, 4, z, -3, 6, z, P.boneShadow, 0); // ribs through the skin
  const head = new PartBuilder('head', [0, 5, 6], 'torso');
  head.ellipsoid(0, 5.2, 8, 2.1, 2, 2.8, fur, 0.14);
  head.box(-1, 4, 10, 1, 5.5, 12, fur).box(0, 4, 13, 0, 5, 13, dark); // the snout narrows to a point
  head.box(-0.5, 3, 12, 0.5, 3.6, 12.5, P.bone, 0); // incisors
  for (const s of [-1, 1]) {
    head.box(s * 1.8, 7, 6.5, s * 2.4, 8.5, 7, dark); // ragged ears
    head.set(s * 1.2, 6, 10, P.glowRed, 0);
    head.line(s * 0.5, 4.5, 12, s * 3.5, 5, 12, shade(P.bone, 0.8));
  }
  const tail = new PartBuilder('tail', [0, 4, -8], 'torso');
  tail.line(0, 4, -9, 0, 2, -14, bare).line(0, 2, -14, 1, 1, -19, bare).line(1, 1, -19, 3, 1.5, -22, shade(bare, 0.85));
  const legs: Part[] = [];
  for (const [n, x, z] of [['legFL', 2, 4], ['legFR', -2, 4], ['legBL', 2.5, -5], ['legBR', -2.5, -5]] as const) {
    const l = new PartBuilder(n, [x, 3, z]);
    l.box(x, 0, z, x, 2.5, z, dark).box(x, 0, z + 1, x, 0, z + 1, bare);
    legs.push(l.build());
  }
  const parts = [body.build(), head.build(), tail.build(), ...legs];
  return { id: 'rat', rig: 'quad', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function bat(scale: number): Model {
  // gaunt, all ears and teeth, on torn membranes stretched over long bony fingers
  const body = new PartBuilder('torso', [0, 12, 0]);
  body.ellipsoid(0, 12, 0, 1.8, 3, 1.6, P.batFur, 0.14);
  const head = new PartBuilder('head', [0, 14, 0], 'torso');
  head.ellipsoid(0, 16, 0.5, 1.8, 1.8, 2, P.batFur, 0.12);
  head.box(-0.5, 15, 2, 0.5, 15.5, 3, shade(P.batFur, 0.8)); // pushed-up snout
  for (const s of [-1, 1]) {
    head.line(s * 1, 17, 0, s * 2.5, 21.5, -0.5, P.batWingDark); // tall ears
    head.set(s * 1, 16.5, 2.3, P.glowRed, 0);
    head.box(s * 0.6, 14, 2.4, s * 0.6, 14.6, 2.4, P.bone, 0); // fangs
  }
  const wings: Part[] = [];
  for (const [n, s] of [['wingL', -1], ['wingR', 1]] as const) {
    const w = new PartBuilder(n, [s * 1.5, 13, 0], 'torso');
    const tips: [number, number][] = [[12, 17], [12, 12], [9, 8], [5, 7]];
    for (const [tx, ty] of tips) w.line(s * 2, 14, 0, s * tx, ty, 0, shade(P.boneDark, 0.8));
    // the membrane, torn in places
    for (let x = 2; x <= 11; x++) for (let y = 7; y <= 16; y++) {
      const inside = y <= 14 + (x - 2) * 0.3 && y >= 14 - (x - 2) * 0.75 + Math.max(0, x - 8) * 0.6;
      if (inside && (x * 5 + y * 3) % 13 !== 0) w.set(s * x, y, 0, (x + y) % 3 ? P.batWing : P.batWingDark, 0.06);
    }
    wings.push(w.build());
  }
  const feet = new PartBuilder('legR', [0, 9, 0]);
  feet.box(-1, 7.5, 0, -1, 9, 0, P.batWingDark).box(1, 7.5, 0, 1, 9, 0, P.batWingDark);
  const parts = [body.build(), head.build(), ...wings, feet.build()];
  return { id: 'bat', rig: 'flier', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function spider(scale: number): Model {
  // spindly: a small body slung between long, high-kneed legs
  const fur = 0x6e5a62, furDark = 0x463840;
  const body = new PartBuilder('torso', [0, 6, 0]);
  body.ellipsoid(0, 8, -4.5, 4.2, 3.4, 5, fur, 0.18);
  body.ellipsoid(0, 7, 1.5, 2.4, 2, 2.6, furDark, 0.12);
  for (const [x, z] of [[0, -2], [-1, -3], [1, -3], [0, -4], [-1, -5], [1, -5], [0, -6]]) body.set(x, 11, z, P.spiderMark, 0);
  const head = new PartBuilder('head', [0, 7, 3.5], 'torso');
  head.ellipsoid(0, 7, 4.5, 1.9, 1.6, 1.8, furDark, 0.1);
  for (const [x, y] of [[-1, 8], [1, 8], [-0.5, 8.5], [0.5, 8.5], [-1.5, 7.5], [1.5, 7.5]]) head.set(x, y, 6, P.glowRed, 0);
  for (const s of [-1, 1]) head.line(s * 0.8, 6, 6, s * 0.5, 3.5, 7.5, P.spiderMark).set(s * 0.5, 3, 7.5, P.bone, 0); // fangs
  const legs: Part[] = [];
  for (let i = 0; i < 8; i++) {
    const s2 = i < 4 ? -1 : 1, k = i % 4, z = 3 - k * 2.2;
    const kz = z + (k - 1.5) * 1.8, fz = z + (k - 1.5) * 3.2;
    const l = new PartBuilder(`leg${i}`, [s2 * 2.5, 7, Math.round(z)]);
    l.line(s2 * 2.5, 7, z, s2 * 7, 14, kz, fur, 1).line(s2 * 7, 14, kz, s2 * 13, 0, fz, furDark, 1);
    legs.push(l.build());
  }
  const parts = [body.build(), head.build(), ...legs];
  return { id: 'spider', rig: 'spider', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function slime(scale: number, tint: Color = P.slime): Model {
  // an ooze: no face, just what it hasn't finished digesting
  const deep = shade(tint, 0.55);
  const body = new PartBuilder('torso', [0, 0, 0]);
  body.ellipsoid(0, 4.5, 0, 7, 5, 6.5, shade(tint, 0.8), 0.1);
  body.ellipsoid(2, 7.5, -1, 3.5, 2.5, 3.5, shade(tint, 0.8), 0.1); // lopsided
  body.paint((x, y, z) => (x * 3 + y * 7 + z * 5) % 9 === 0, deep);
  body.paint((_x, y) => y < 1, deep);
  for (const [x, z] of [[-6, 2], [5, 4], [-3, -6], [6, -3]]) body.box(x, 0, z, x, 1, z, deep, 0); // drips
  const face = new PartBuilder('head', [0, 5, 5], 'torso');
  // a half-dissolved skull breaking the surface, and a rib poking out of the side
  face.ellipsoid(-1, 5, 6, 2, 2, 1.6, P.boneShadow, 0.05);
  face.set(-2, 5, 7.5, P.ink, 0).set(0, 5, 7.5, P.ink, 0).box(-1.5, 3.5, 7, -0.5, 3.5, 7, P.ink, 0);
  face.line(5, 6, 3, 8, 8, 2, P.boneShadow);
  const parts = [body.build(), face.build()];
  return { id: 'slime', rig: 'blob', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function ghost(scale: number, caster = true): Model {
  // a wraith: tall and tattered, a hollow hood with two cold eyes, and long clawed hands
  const G = shade(P.ghostDeep, 0.85), deep = shade(P.ghostDeep, 0.6), dark = 0x14121c;
  const body = new PartBuilder('torso', [0, 10, 0]);
  for (let y = 0; y <= 21; y++) {
    const r = y < 9 ? 0.8 + y * 0.35 : 3.6 - Math.max(0, y - 16) * 0.35;
    body.ellipsoid(Math.sin(y * 0.6) * 0.6, y, -Math.max(0, 9 - y) * 0.6, r, 0.6, r * 0.75, y < 8 ? deep : G, 0.12);
  }
  body.paint((x, y, z) => y < 7 && (x * 5 + z * 3 + y) % 4 === 0, dark); // the trailing rags
  const head = new PartBuilder('head', [0, 22, 0], 'torso');
  // a cowl drawn forward: an egg of cloth with a deep, dark hollow where a face should be
  head.ellipsoid(0, 25, -0.6, 2.8, 3.6, 3, G, 0.14);
  head.ellipsoid(0, 24.4, 1.6, 1.7, 2.4, 1.6, dark, 0);
  for (const s of [-1, 1]) head.set(s * 0.8, 24.6, 2.4, P.glowCyan, 0);
  head.line(0, 28, -1.5, 0, 29.5, -3.5, G); // the cowl's tip
  const armR = new PartBuilder('armR', [3.5, 20, 0], 'torso'), armL = new PartBuilder('armL', [-3.5, 20, 0], 'torso');
  for (const [arm, s] of [[armR, 1], [armL, -1]] as const) {
    arm.line(s * 3.5, 20, 0, s * 6.5, 12, 2, G, 1);
    for (const f of [-1, 0, 1]) arm.line(s * 6.5, 12, 2, s * (7 + f * 0.9), 7, 2.5 + f, P.ghostGlow, 1); // long fingers
  }
  const parts = [body.build(), head.build(), armR.build(), armL.build()];
  return { id: 'ghost', rig: 'ghost', parts, scale, height: modelHeight(parts), style: caster ? 'caster' : 'bite' };
}

function wolf(scale: number): Model {
  const fur = 0x8a8478, dark = 0x5a564e, pale = 0xb0aa9c;
  const body = new PartBuilder('torso', [0, 7, 0]);
  body.ellipsoid(0, 8, -1, 3, 3.2, 7.5, fur, 0.16);
  body.ellipsoid(0, 9.5, 3, 3.2, 3, 3.4, fur, 0.14); // the ruff
  body.paint((_x, y) => y <= 6, pale);
  const head = new PartBuilder('head', [0, 9, 6], 'torso');
  head.ellipsoid(0, 10, 7.5, 2.2, 2.2, 2.6, fur, 0.12);
  head.box(-1, 8.5, 9.5, 1, 9.8, 12, fur).box(0, 9.2, 12.5, 0, 9.8, 12.5, P.ink); // muzzle and nose
  for (const s2 of [-1, 1]) { head.box(s2 * 1.3, 12, 6.5, s2 * 1.8, 14, 7, dark); head.set(s2 * 1, 10.6, 9.6, P.glowCyan, 0); }
  const tail = new PartBuilder('tail', [0, 9, -8], 'torso');
  tail.line(0, 9, -8.5, 0, 7, -13, fur, 1.4).line(0, 7, -13, 0, 6, -15, pale, 1.2);
  const legs: Part[] = [];
  for (const [n, x, z] of [['legFL', 1.8, 4], ['legFR', -1.8, 4], ['legBL', 2, -5], ['legBR', -2, -5]] as const) {
    const l = new PartBuilder(n, [x, 6, z]);
    l.box(x, 0, z, x, 5.5, z, dark).box(x, 0, z + 1, x, 0, z + 1, dark);
    legs.push(l.build());
  }
  const parts = [body.build(), head.build(), tail.build(), ...legs];
  return { id: 'wolf', rig: 'quad', parts, scale, height: modelHeight(parts), style: 'bite' };
}

// ---------------- the registry ----------------

/** A model for any enemy id in data/monsters.json. Deterministic. */
export function enemyModel(enemyId: string, rankOverride?: string): Model {
  const e = ENEMIES[enemyId];
  const arche = e?.archetype ?? 'grunt';
  const rank = rankOverride ?? e?.rank ?? 'normal';
  const scale = (RANK_SCALE[rank] ?? 1) * (arche === 'brute' ? 1.15 : 1) * (arche === 'swarm' ? 0.85 : 1);
  const style = ARCH_STYLE[arche] ?? 'melee';
  const species = e?.species ?? 'skeleton';
  let m: Model;
  switch (species) {
    case 'rat': m = rat(scale * (arche === 'brute' ? 1.3 : 1), arche === 'brute'); break;
    case 'bat': m = bat(scale); break;
    case 'wolf': m = wolf(scale); break;
    case 'spider': m = spider(scale * (arche === 'guardian' ? 1.2 : 1)); break;
    case 'slime': m = slime(scale, arche === 'brute' ? 0xb0c83a : P.slime); break;
    case 'ghost': m = ghost(scale, arche !== 'swarm'); break;
    case 'skeleton': {
      const rig = skeletonRig();
      const gear = ARCH_GEAR[arche] ?? 'sword';
      if (arche === 'caster' || arche === 'summoner') {
        const h = rig.head;
        for (let x = -5; x <= 5; x++) for (let z = -5; z <= 2; z++) if (x * x + (z + 1) ** 2 <= 30) h.set(x, rig.frame.headTop + 1, z, P.blackSoft);
      }
      if (arche === 'guardian') { const h = rig.head; h.ellipsoid(0, 21, 0, 5.2, 2.6, 5.2, P.iron, 0.06); for (let x = -4; x <= 4; x++) for (let z = -5; z <= 5; z++) if (z > 2) h.clear(x, 19, z); }
      equip(rig, gear === 'sword' ? 'sword' : gear, P.boneDark);
      if (gear === 'sword') for (const p of rig.extras) if (p.name === 'weapon') p.paint((_x, y) => y > rig.frame.handY + 2, P.rust);
      m = assemble(`enemy:${enemyId}`, rig, style, scale);
      break;
    }
    default: {
      // humanoid species: zombie, cultist, robber, goblin
      const race = species === 'goblin' ? 'goblin' : species === 'myconid' ? 'myconid' : 'human';
      const look = rollLook(race, enemyId);
      if (species === 'zombie') { look.skin = P.zombie; look.hair = P.hairGrey; look.hairStyle = 'crop'; look.beard = false; look.detail = 'none'; }
      const outfit0 = species === 'cultist' || species === 'robber';
      const rig = buildBody(outfit0 ? { ...look, hairStyle: 'bald' } : look);
      const outfit: Outfit = species === 'zombie' ? 'zombie' : species === 'cultist' ? 'cultist' : species === 'robber' ? 'robber' : species === 'myconid' ? 'none' : 'rags';
      clothe(rig, outfit, look);
      equip(rig, ARCH_GEAR[arche] ?? 'sword', look.accent);
      if (species === 'zombie') {
        // dead eyes and a slack jaw
        const f = rig.frame;
        const eyeY = f.headY + 4;
        for (const sx of [-2, 2]) rig.head.box(sx - 0.5, eyeY, f.hz1 + 0.5, sx + 0.5, eyeY + 1.5, f.hz1 + 0.5, P.ink, 0).set(sx, eyeY + 0.5, f.hz1 + 0.5, P.glowGreen, 0);
        rig.head.box(-1.5, f.headY + 0.5, f.hz1 + 0.5, 1.5, f.headY + 1.5, f.hz1 + 0.5, P.ink, 0);
        rig.head.box(-1, f.headY + 1.5, f.hz1 + 0.5, 1, f.headY + 1.5, f.hz1 + 0.5, P.boneShadow, 0);
        rig.head.line(3, f.headY + 1, f.hz1 + 0.5, 4, f.headY + 3, f.hz1 + 0.5, P.zombieDark);
        // arms reach forward
        for (const arm of [rig.armL, rig.armR]) arm.paint(() => true, P.zombie);
      }
      m = assemble(`enemy:${enemyId}`, rig, style, scale);
    }
  }
  m.id = `enemy:${enemyId}`;
  void ARCHETYPES; void RANKS;
  return m;
}
