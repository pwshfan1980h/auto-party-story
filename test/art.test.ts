import { describe, expect, it } from 'vitest';
import { heroModel, rollLook } from '../src/art/humanoid';
import { RES, unkey, voxelCount } from '../src/art/kit';
import { enemyModel } from '../src/art/monsters';
import { RACE_BODIES } from '../src/art/races';
import { CLASSES, ENEMIES } from '../src/sim/data';

describe('unit art kit', () => {
  it('builds every class for every race, deterministically', () => {
    for (const race of Object.keys(RACE_BODIES)) for (const c of Object.keys(CLASSES)) {
      const look = rollLook(race, `${race}-${c}`);
      const a = heroModel(c, look), b = heroModel(c, rollLook(race, `${race}-${c}`));
      expect(voxelCount(a)).toBe(voxelCount(b));
      expect(voxelCount(a)).toBeGreaterThan(1000);
      // units stand on the ground and are roughly 20–40 design units tall
      expect(a.height / RES).toBeGreaterThan(18);
      expect(a.height / RES).toBeLessThan(42);
      for (const p of a.parts) expect(p.voxels.size).toBeGreaterThan(0);
      const minY = Math.min(...a.parts.flatMap((p) => [...p.voxels.keys()].map((k) => unkey(k)[1])));
      expect(minY).toBeGreaterThanOrEqual(0);
    }
  });
  it('gives two heroes of the same race and class different looks', () => {
    const looks = new Set<string>();
    for (let s = 0; s < 40; s++) { const l = rollLook('human', s); looks.add(`${l.sex}${l.skin}${l.hair}${l.hairStyle}${l.accent}${l.height}${l.weight}`); }
    expect(looks.size).toBeGreaterThan(30);
  });
  it('rolls sex, height and weight within each race range', () => {
    for (const [race, spec] of Object.entries(RACE_BODIES)) for (let s = 0; s < 30; s++) {
      const l = rollLook(race, s);
      expect(['m', 'f']).toContain(l.sex);
      expect(l.height).toBeGreaterThanOrEqual(spec.height[0]);
      expect(l.height).toBeLessThanOrEqual(spec.height[1]);
      expect(l.weight).toBeGreaterThanOrEqual(spec.weight[0]);
      expect(l.weight).toBeLessThanOrEqual(spec.weight[1]);
    }
  });
  it('has a model for every enemy', () => {
    for (const id of Object.keys(ENEMIES)) {
      const m = enemyModel(id);
      expect(voxelCount(m)).toBeGreaterThan(200);
      expect(m.scale).toBeGreaterThan(0.5);
    }
  });
});

describe('unit rig', () => {
  it('keeps feet on the ground in every pose', async () => {
    const THREE = await import('three');
    const { UnitView } = await import('../src/render/unitView');
    for (const m of [heroModel('fighter', rollLook('dwarf', 1)), heroModel('mage', rollLook('elf', 2)), enemyModel('skeleton_warrior'), enemyModel('zombie')]) {
      const v = new UnitView(m);
      for (const anim of ['idle', 'walk', 'crouch', 'attack', 'cast', 'hurt'] as const) {
        v.pose(anim, 0.3, 0.5);
        v.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(v.root);
        expect(box.min.y).toBeGreaterThan(-0.15);
        expect(box.min.y).toBeLessThan(0.15);
      }
    }
  });
});
