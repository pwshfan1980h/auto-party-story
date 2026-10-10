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
  const legH = 6, torsoTop = 13, hw = 4, z0 = -2, z1 = 2, headY = 14, headTop = 22, hx = 4, hz0 = -4, hz1 = 4;
  const f: Frame = { legH, torsoTop, hw, z0, z1, headY, headTop, hx, hz0, hz1, shoulderY: torsoTop, handY: 6, armX: 5 };
  const B = P.bone, S = P.boneShadow, D = P.boneDark;
  const legR = new PartBuilder('legR', [2, legH, 0]), legL = new PartBuilder('legL', [-2, legH, 0]);
  for (const [leg, s] of [[legR, 1], [legL, -1]] as const) {
    leg.box(s * 2, 1, 0, s * 2, legH - 1, 0, B).set(s * 2, 3, 1, S).box(s * 1, 0, 0, s * 3, 0, 2, B);
  }
  const torso = new PartBuilder('torso', [0, legH, 0]);
  torso.box(-2, legH, -1, 2, legH + 1, 1, S); // pelvis
  torso.box(0, legH + 2, -1, 0, torsoTop, -1, D); // spine
  for (let y = legH + 3; y <= torsoTop - 1; y += 2) {
    for (let x = -3; x <= 3; x++) torso.set(x, y, Math.abs(x) >= 3 ? 0 : 1, B);
    torso.set(-3, y, -1, S).set(3, y, -1, S);
  }
  torso.box(-hw, torsoTop, -1, hw, torsoTop, 0, B); // collarbones
  const armR = new PartBuilder('armR', [5.5, torsoTop, 0], 'torso'), armL = new PartBuilder('armL', [-5.5, torsoTop, 0], 'torso');
  for (const [arm, s] of [[armR, 1], [armL, -1]] as const) {
    arm.box(s * 5, 8, 0, s * 5, torsoTop, 0, B).set(s * 5, 10, 1, S).box(s * 5, 6, -1, s * 6, 7, 0, B);
  }
  const head = new PartBuilder('head', [0, headY, 0], 'torso');
  head.ellipsoid(0, headY + 5, 0, 4.6, 4.4, 4.6, B, 0.06);
  head.box(-3, headY, -1, 3, headY + 1, 3, B); // jaw
  for (let x = -2; x <= 2; x += 2) head.set(x, headY + 1, 4, P.ink);
  for (const s of [-2, 2]) head.ellipsoid(s, headY + 5, 4.2, 1.5, 1.6, 1.2, P.ink, 0).set(s, headY + 5, 5, shade(P.glowCyan, 0.8));
  head.box(-2.5, headY + 1.5, 4, 2.5, headY + 1.5, 4, P.boneShadow, 0);
  head.set(0, headY + 3, 5, P.ink).set(0, headY + 3, 4, P.ink);
  head.paint((_x, y, z) => z < -2 && y > headY + 6, S);
  return { frame: f, legL, legR, torso, head, armL, armR, extras: [] };
}

// ---------------- non-humanoid rigs ----------------

function rat(scale: number, big = false): Model {
  const fur = P.ratFur, dark = P.ratFurDark, pink = P.ratPink;
  const body = new PartBuilder('torso', [0, 4, 0]);
  body.ellipsoid(0, 5, -1, 4.2, 3.6, 7, fur, 0.14);
  body.paint((_x, y) => y <= 3, shade(fur, 1.15));
  const head = new PartBuilder('head', [0, 6, 5], 'torso');
  head.ellipsoid(0, 6, 7, 3, 2.8, 3.4, fur, 0.12).box(-1, 5, 10, 1, 6, 11, fur).set(0, 6, 12, pink);
  for (const s of [-1, 1]) {
    head.box(s * 2, 9, 5, s * 3, 11, 6, dark).set(s * 2, 10, 6, pink);
    head.set(s * 2, 7, 9, P.glowRed);
    head.line(s * 1, 5, 11, s * 4, 6, 11, P.white);
  }
  if (big) head.box(-1, 4, 10, 1, 4, 11, P.white);
  const tail = new PartBuilder('tail', [0, 4, -7], 'torso');
  tail.line(0, 4, -8, 0, 2, -13, pink).line(0, 2, -13, 2, 3, -17, pink);
  const legs: Part[] = [];
  for (const [n, x, z] of [['legFL', 2, 3], ['legFR', -2, 3], ['legBL', 3, -4], ['legBR', -3, -4]] as const) {
    const l = new PartBuilder(n, [x, 3, z]);
    l.box(x, 0, z, x, 2, z + 1, dark).box(x, 0, z + 2, x, 0, z + 2, pink);
    legs.push(l.build());
  }
  const parts = [body.build(), head.build(), tail.build(), ...legs];
  return { id: 'rat', rig: 'quad', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function bat(scale: number): Model {
  const body = new PartBuilder('torso', [0, 12, 0]);
  body.ellipsoid(0, 12, 0, 2.6, 3, 2.4, P.batFur, 0.1);
  const head = new PartBuilder('head', [0, 14, 0], 'torso');
  head.ellipsoid(0, 16, 0.5, 2.6, 2.3, 2.4, P.batFur, 0.1);
  for (const s of [-1, 1]) head.box(s * 2, 18, 0, s * 2, 20, 0, P.batWingDark).set(s * 1, 16, 3, P.glowRed);
  head.set(-1, 14, 3, P.white).set(1, 14, 3, P.white);
  const wings: Part[] = [];
  for (const [n, s] of [['wingL', -1], ['wingR', 1]] as const) {
    const w = new PartBuilder(n, [s * 2, 13, 0], 'torso');
    for (let i = 1; i <= 9; i++) {
      const h = 6 - Math.abs(i - 4);
      w.box(s * (2 + i), 13 - Math.max(0, h - 2), 0, s * (2 + i), 13 + Math.min(3, h), 0, i % 3 === 0 ? P.batWingDark : P.batWing, 0.08);
    }
    w.line(s * 3, 16, 0, s * 11, 14, 0, P.batFur);
    wings.push(w.build());
  }
  const feet = new PartBuilder('legR', [0, 9, 0]);
  feet.box(-1, 8, 0, -1, 9, 0, P.batWingDark).box(1, 8, 0, 1, 9, 0, P.batWingDark);
  const parts = [body.build(), head.build(), ...wings, feet.build()];
  return { id: 'bat', rig: 'flier', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function spider(scale: number): Model {
  const body = new PartBuilder('torso', [0, 5, 0]);
  const fur = 0x5a4652, furDark = 0x3a2c36;
  body.ellipsoid(0, 7, -4, 5.4, 4.4, 5.8, fur, 0.16);
  body.ellipsoid(0, 6, 2.2, 3.2, 2.8, 3, furDark, 0.1);
  // an hourglass marking on the back
  for (const [x, z] of [[0, -2], [-1, -3], [1, -3], [0, -4], [-1, -5], [1, -5], [0, -6]]) body.set(x, 11, z, P.spiderMark, 0);
  const head = new PartBuilder('head', [0, 6, 4], 'torso');
  head.ellipsoid(0, 6, 5, 2.6, 2.2, 2.2, furDark, 0.1);
  for (const [x, y] of [[-1, 7], [1, 7], [-2, 6], [2, 6]]) head.set(x, y, 7, P.glowRed, 0);
  head.box(-1.5, 3, 6.5, -1, 4.5, 8, P.boneShadow).box(1, 3, 6.5, 1.5, 4.5, 8, P.boneShadow);
  const legs: Part[] = [];
  for (let i = 0; i < 8; i++) {
    const s2 = i < 4 ? -1 : 1, k = i % 4, z = 3 - k * 2.4;
    const kz = z + (k - 1.5) * 1.4, fz = z + (k - 1.5) * 2.4;
    const l = new PartBuilder(`leg${i}`, [s2 * 3, 6, Math.round(z)]);
    l.line(s2 * 3, 6, z, s2 * 7.5, 10, kz, fur, 1).line(s2 * 7.5, 10, kz, s2 * 10.5, 0, fz, furDark, 1);
    l.set(s2 * 7.5, 10, kz, P.spiderMark, 0);
    legs.push(l.build());
  }
  const parts = [body.build(), head.build(), ...legs];
  return { id: 'spider', rig: 'spider', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function slime(scale: number, tint: Color = P.slime): Model {
  const body = new PartBuilder('torso', [0, 0, 0]);
  body.ellipsoid(0, 5, 0, 7, 6, 6.5, tint, 0.08);
  for (const k of [...body.voxels.keys()]) void k;
  body.paint((_x, y) => y < 1, shade(tint, 0.7));
  body.ellipsoid(1, 4, -1, 2.5, 2, 2.5, shade(tint, 0.55), 0);
  body.paint((x, y, z) => y > 9 && x < 0 && z > 0, shade(tint, 1.3));
  const face = new PartBuilder('head', [0, 6, 6], 'torso');
  for (const s of [-2, 2]) face.box(s, 6, 7, s, 8, 7, P.ink, 0).set(s, 8, 7, P.eyeWhite);
  face.box(-1, 4, 7, 1, 4, 7, shade(tint, 0.45), 0);
  const parts = [body.build(), face.build()];
  return { id: 'slime', rig: 'blob', parts, scale, height: modelHeight(parts), style: 'bite' };
}

function ghost(scale: number, caster = true): Model {
  const G = P.ghost, deep = P.ghostDeep;
  const body = new PartBuilder('torso', [0, 8, 0]);
  for (let y = 3; y <= 15; y++) {
    const r = y < 8 ? 1.2 + (y - 3) * 0.75 : 5;
    body.ellipsoid(Math.sin(y * 0.7) * 0.8, y, -Math.max(0, 8 - y) * 0.5, r, 0.6, r * 0.9, y < 7 ? deep : G, 0.08);
  }
  const head = new PartBuilder('head', [0, 16, 0], 'torso');
  head.ellipsoid(0, 19, 0, 5, 4.6, 4.4, G, 0.06);
  for (const s of [-2, 2]) head.box(s - (s < 0 ? 1 : 0), 18, 4, s + (s > 0 ? 1 : 0), 20, 4, P.ink, 0);
  head.ellipsoid(0, 16.5, 4, 1.2, 1.4, 0.6, P.ink, 0);
  const armR = new PartBuilder('armR', [5, 14, 0], 'torso'), armL = new PartBuilder('armL', [-5, 14, 0], 'torso');
  armR.line(5, 14, 0, 8, 10, 2, G, 1).set(8, 9, 2, P.ghostGlow);
  armL.line(-5, 14, 0, -8, 10, 2, G, 1).set(-8, 9, 2, P.ghostGlow);
  const parts = [body.build(), head.build(), armR.build(), armL.build()];
  return { id: 'ghost', rig: 'ghost', parts, scale, height: modelHeight(parts), style: caster ? 'caster' : 'bite' };
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
      const race = species === 'goblin' ? 'goblin' : 'human';
      const look = rollLook(race, enemyId);
      if (species === 'zombie') { look.skin = P.zombie; look.hair = P.hairGrey; look.hairStyle = 'crop'; look.beard = false; look.detail = 'none'; }
      const outfit0 = species === 'cultist' || species === 'robber';
      const rig = buildBody(outfit0 ? { ...look, hairStyle: 'bald' } : look);
      const outfit: Outfit = species === 'zombie' ? 'zombie' : species === 'cultist' ? 'cultist' : species === 'robber' ? 'robber' : 'rags';
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
