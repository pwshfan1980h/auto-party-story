import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goldenSnapshot } from '../tools/golden';

describe('golden seeds', () => {
  it('match the snapshot (regenerate with `npm run golden` after an intended change)', () => {
    const expected = JSON.parse(readFileSync('test/golden.json', 'utf8'));
    expect(goldenSnapshot()).toEqual(expected);
  });
});
