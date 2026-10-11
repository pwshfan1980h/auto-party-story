import { describe, expect, it } from 'vitest';
import { delve, hire, planProblem } from '../src/game/expedition';
import { hireCost, newGame } from '../src/game/state';
import { runFight } from '../src/sim/fight';

describe('game loop', () => {
  it('starts with a fighter, a cleric and a ranger, and a hire board', () => {
    const s = newGame(7);
    expect(s.roster.map((h) => h.hero.classId)).toEqual(['fighter', 'cleric', 'ranger']);
    expect(s.hireBoard.length).toBe(3);
    expect(new Set(s.roster.map((h) => h.hero.name)).size).toBe(3);
  });

  it('refuses bad plans', () => {
    const s = newGame(7);
    const ids = s.roster.map((h) => h.hero.id);
    expect(planProblem(s, { partyIds: [], leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false })).toBeTruthy();
    expect(planProblem(s, { partyIds: ids, leaderId: 'nobody', tier: 'I', doctrine: 'balanced', fromWaystone: false })).toBeTruthy();
    expect(planProblem(s, { partyIds: ids, leaderId: ids[0], tier: 'II', doctrine: 'balanced', fromWaystone: false })).toMatch(/sealed/);
    expect(planProblem(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false })).toBeNull();
  });

  it('settles a delve on the save: coin, runs, history, the dead go to the memorial', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = newGame(seed);
      const ids = s.roster.map((h) => h.hero.id);
      const coin = s.coin;
      const out = delve(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false });
      expect(s.runs).toBe(1);
      expect(s.coin).toBe(coin + out.result.banked);
      expect(s.history[0].outcome).toBe(out.result.outcome);
      expect(s.memorial.map((m) => m.id).sort()).toEqual([...out.aftermath.died].sort());
      expect(s.roster.every((h) => h.alive)).toBe(true);
    }
  });

  it('every recorded fight replays to the same outcome the run used', () => {
    const s = newGame(11);
    const ids = s.roster.map((h) => h.hero.id);
    const out = delve(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'depth', fromWaystone: false });
    const fights = out.result.ledger.filter((e) => e.fight);
    expect(fights.length).toBeGreaterThan(0);
    for (const e of fights) {
      const r = runFight({ ...e.fight!, mode: 'full' });
      expect(r.duration).toBe(e.secs);
      expect(r.result === 'victory' ? 'won' : 'lost').toBe(e.result === 'won' ? 'won' : 'lost');
    }
  });

  it('hiring costs coin and moves the recruit to the roster', () => {
    const s = newGame(3);
    s.coin = 1000;
    const h = s.hireBoard[0];
    expect(hire(s, h.hero.id)).toBeNull();
    expect(s.coin).toBe(1000 - hireCost(h));
    expect(s.roster).toContain(h);
    s.coin = 0;
    expect(hire(s, s.hireBoard[0].hero.id)).toMatch(/costs/);
  });
});

describe('interactive delves', () => {
  it('driving the steps with the bots matches the headless run exactly', async () => {
    const { delveSteps, runRun } = await import('../src/sim/run');
    const { Fight } = await import('../src/sim/fight');
    const s = newGame(21);
    const setup = { seed: 77, tier: 'I', party: s.roster.map((h) => ({ ...h.hero })), leaderId: s.roster[0].hero.id };
    const steps = delveSteps(setup);
    let answer: unknown;
    let res;
    for (;;) {
      const st = steps.next(answer as never);
      if (st.done) { res = st.value; break; }
      const q = st.value;
      answer = q.kind === 'fight' ? new Fight(q.setup).run() : q.kind === 'between' ? 'go' : q.kind === 'council' ? 'trust' : undefined;
    }
    const head = runRun(setup);
    expect(res.outcome).toBe(head.outcome);
    expect(res.banked).toBe(head.banked);
    expect(res.ledger.length).toBe(head.ledger.length);
  });

  it('a delve the page closed on is played out on the next load, not undone', async () => {
    const { beginDelve, finishPending } = await import('../src/game/expedition');
    const s = newGame(5);
    const ids = s.roster.map((h) => h.hero.id);
    const steps = beginDelve(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false });
    steps.next(); // the delve is under way...
    expect(s.pending).toBeTruthy();
    const reloaded = JSON.parse(JSON.stringify(s)); // ...and the page closes
    const out = finishPending(reloaded);
    expect(out).not.toBeNull();
    expect(reloaded.runs).toBe(1);
    expect(reloaded.pending).toBeUndefined();
  });

  it('turning back at the first doorway ends the run as a retreat', async () => {
    const { delveSteps } = await import('../src/sim/run');
    const { Fight } = await import('../src/sim/fight');
    const s = newGame(9);
    const steps = delveSteps({ seed: 3, tier: 'I', party: s.roster.map((h) => ({ ...h.hero })), leaderId: s.roster[0].hero.id });
    let answer: unknown, res;
    for (;;) {
      const st = steps.next(answer as never);
      if (st.done) { res = st.value; break; }
      const q = st.value;
      answer = q.kind === 'fight' ? new Fight(q.setup).run() : q.kind === 'between' ? 'turn back' : q.kind === 'council' ? 'trust' : undefined;
    }
    expect(res.outcome === 'retreat' || res.outcome === 'wipe').toBe(true);
    expect(res.turnBackUsed).toBe(true);
  });
});

describe('Torchwatch upgrades', () => {
  it('building costs coin once, and the effects reach the delve', async () => {
    const { build, campEffect } = await import('../src/game/state');
    const s = newGame(13);
    s.coin = 1000;
    expect(build(s, 'lamplighter')).toBeNull();
    expect(build(s, 'lamplighter')).toMatch(/already/);
    expect(s.coin).toBe(1000 - 120);
    expect(campEffect(s, 'torch')).toBe(3);
    expect(build(s, 'training_yard')).toBeNull();
    expect(s.hireBoard.every((h) => h.hero.level >= 2)).toBe(true);
    expect(build(s, 'infirmary')).toBeNull();
    expect(campEffect(s, 'recovery')).toBe(-1);
  });

  it('the fallen are remembered with how they fell', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = newGame(seed);
      const ids = s.roster.map((h) => h.hero.id);
      delve(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'depth', fromWaystone: false });
      if (s.memorial.length) { expect(s.memorial[0].cause).toMatch(/floor|dark/); return; }
    }
  });
});

describe('items', () => {
  it('equipping moves gear between the stores and a hero, within the rules', async () => {
    const { equip } = await import('../src/game/state');
    const s = newGame(31);
    const fighter = s.roster.find((h) => h.hero.classId === 'fighter')!;
    const ranger = s.roster.find((h) => h.hero.classId === 'ranger')!;
    s.stash = ['swordbreaker', 'tower_shield', 'yew_bow', 'lucky_tooth'];
    expect(equip(s, fighter.hero.id, 'weapon', 'swordbreaker')).toBeNull();
    expect(equip(s, fighter.hero.id, 'shield', 'tower_shield')).toBeNull();
    expect(equip(s, ranger.hero.id, 'weapon', 'yew_bow')).toBeNull();
    expect(equip(s, ranger.hero.id, 'shield', 'lucky_tooth')).toMatch(/can/);
    expect(s.stash).toEqual(['lucky_tooth']);
    expect(equip(s, fighter.hero.id, 'weapon', null)).toBeNull();
    expect(s.stash).toContain('swordbreaker');
  });

  it('gear changes what a hero can do', async () => {
    const { heroStats, autoAttrs } = await import('../src/sim/stats');
    const attrs = autoAttrs('fighter', 3);
    const plain = heroStats('fighter', 'human', 3, attrs, 10);
    const geared = heroStats('fighter', 'human', 3, attrs, 10, ['swordbreaker', 'tower_shield', 'chain_shirt']);
    expect(geared.disarm).toBeGreaterThan(plain.disarm);
    expect(geared.block).toBeGreaterThan(plain.block);
    expect(geared.armor).toBeGreaterThan(plain.armor);
  });

  it('delves turn up gear, and the stores keep it unless the party wipes', () => {
    let foundAny = false;
    for (let seed = 1; seed < 30 && !foundAny; seed++) {
      const s = newGame(seed);
      const ids = s.roster.map((h) => h.hero.id);
      const out = delve(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'depth', fromWaystone: false });
      if (out.result.outcome === 'wipe') expect(out.result.found).toEqual([]);
      if (out.result.found.length) { foundAny = true; expect(s.stash).toEqual(out.result.found); }
    }
    expect(foundAny).toBe(true);
  });
});

describe('launch assistance', () => {
  it('a broke company with too few heroes gets volunteers, and a fully recovering one can rest', async () => {
    const { assist, rest, planProblem } = await import('../src/game/expedition');
    const s = newGame(41);
    s.roster = [s.roster[0]];
    s.coin = 0;
    const names = assist(s);
    expect(names.length).toBe(2);
    expect(s.roster.length).toBe(3);
    for (const h of s.roster) h.benched = 1;
    const ids = s.roster.map((h) => h.hero.id);
    expect(planProblem(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false })).toMatch(/recovering/);
    rest(s);
    expect(planProblem(s, { partyIds: ids, leaderId: ids[0], tier: 'I', doctrine: 'balanced', fromWaystone: false })).toBeNull();
  });

  it('a company that can afford to hire is left to hire', async () => {
    const { assist } = await import('../src/game/expedition');
    const s = newGame(42);
    s.roster = [];
    s.coin = 1000;
    expect(assist(s)).toEqual([]);
  });
});

describe('races arrive over time', () => {
  it('starts with four peoples, and others come with milestones', async () => {
    const { metRaces } = await import('../src/game/state');
    const s = newGame(51);
    expect(metRaces(s).sort()).toEqual(['dwarf', 'elf', 'halfling', 'human']);
    expect(s.hireBoard.every((h) => ['dwarf', 'elf', 'halfling', 'human'].includes(h.hero.raceId))).toBe(true);
    s.runs = 3; expect(metRaces(s)).toContain('orc');
    s.unlocked = 1; expect(metRaces(s)).toContain('goblin');
    s.unlocked = 2; expect(metRaces(s)).toContain('myconid');
    expect(metRaces(s)).not.toContain('construct');
  });
});

describe('promotion', () => {
  it('a level-10 hero trains as a Specialist once the Academy stands', async () => {
    const { build, promote, promotions } = await import('../src/game/state');
    const s = newGame(61);
    const f = s.roster.find((h) => h.hero.classId === 'fighter')!;
    expect(promotions(s, f.hero.id).options.sort()).toEqual(['berserker', 'knight']);
    expect(promote(s, f.hero.id, 'knight')).toMatch(/level/);
    f.hero = { ...f.hero, level: 10 };
    expect(promote(s, f.hero.id, 'knight')).toMatch(/Academy/);
    s.coin = 1000; build(s, 'academy');
    expect(promote(s, f.hero.id, 'mage')).toMatch(/can't/);
    expect(promote(s, f.hero.id, 'knight')).toBeNull();
    expect(f.hero.classId).toBe('knight');
    expect(promotions(s, f.hero.id).options).toEqual([]);
  });
});
