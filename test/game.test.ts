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
