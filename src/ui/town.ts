// Torchwatch (M2 placeholder layout): the roster, the hire board, the memorial and the expedition plan.
import { CLASSES, RACES, TIERS } from '../sim/data';
import { leaderProfile, type Doctrine } from '../sim/leader';
import { xpToNext, type RosterHero } from '../sim/roster';
import { hire, partySizeFor, planProblem, rest, type DelvePlan } from '../game/expedition';
import { build, CAMP, equip, hireCost, TIER_IDS, type GameState } from '../game/state';
import { ITEMS } from '../sim/data';
import { canEquip, SLOTS } from '../sim/items';

const STAT_LABEL: Record<string, string> = { power: 'power', spell: 'spell', armor: 'armour', maxHp: 'HP', crit: 'crit', evasion: 'evasion', parry: 'parry', block: 'block', move: 'speed', healPower: 'healing', energyGain: 'energy' };
function describe(id: string): string {
  const it = ITEMS[id];
  const parts = Object.entries(it.add).map(([k, v]) => `${(v ?? 0) > 0 ? '+' : ''}${(v ?? 0) < 1 && (v ?? 0) > -1 ? `${Math.round((v ?? 0) * 100)}%` : v} ${STAT_LABEL[k] ?? k}`);
  if (it.gear && it.slot !== 'armour' && it.slot !== 'trinket') parts.unshift(it.gear);
  return parts.join(', ');
}
import { clear, el } from './dom';
import { portrait } from './portrait';

const DOCTRINES: [Doctrine, string, string][] = [
  ['balanced', 'Balanced', 'Weigh each room as it comes.'],
  ['home', 'Bring them home', 'Turn back early. Lives over loot.'],
  ['pack', 'Fill the pack', 'Greedier with treasure.'],
  ['depth', 'Go for the boss', 'Push deeper, and ignore a full pack.'],
];
const TIER_NAMES: Record<string, string> = Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].name]));

export interface TownHandlers { onDelve(plan: DelvePlan): void; onAbandon(): void }

export class Town {
  private plan: DelvePlan;
  private abandonArmed = false;
  private gearOpen: string | null = null;

  constructor(private readonly root: HTMLElement, private state: GameState, private readonly on: TownHandlers) {
    const tier = TIER_IDS[state.unlocked];
    this.plan = { partyIds: [], leaderId: '', tier, doctrine: 'balanced', fromWaystone: false };
    this.autoPick();
  }

  setState(state: GameState) { this.state = state; this.plan.tier = TIER_IDS[Math.min(TIER_IDS.indexOf(this.plan.tier), state.unlocked)]; this.autoPick(); this.render(); }

  /** Fill the party with the strongest rested heroes and hand the torch to the best Leader. */
  private autoPick() {
    const ready = this.state.roster.filter((h) => h.benched <= 0).sort((a, b) => b.hero.level - a.hero.level);
    this.plan.partyIds = this.plan.partyIds.filter((id) => ready.some((h) => h.hero.id === id));
    for (const h of ready) if (this.plan.partyIds.length < partySizeFor(this.plan.tier) && !this.plan.partyIds.includes(h.hero.id)) this.plan.partyIds.push(h.hero.id);
    this.plan.partyIds = this.plan.partyIds.slice(0, partySizeFor(this.plan.tier));
    if (!this.plan.partyIds.includes(this.plan.leaderId)) {
      const best = this.plan.partyIds.map((id) => this.hero(id)!).sort((a, b) => b.hero.leadership - a.hero.leadership)[0];
      this.plan.leaderId = best?.hero.id ?? '';
    }
  }

  private hero(id: string) { return this.state.roster.find((h) => h.hero.id === id); }

  render() {
    const s = this.state;
    clear(this.root);
    const size = partySizeFor(this.plan.tier);
    const problem = planProblem(s, this.plan);
    const way = s.waystones[this.plan.tier];
    const first = TIERS[this.plan.tier].floors[0];
    this.root.append(
      el('header', { class: 'town-head' },
        el('h1', {}, 'Torchwatch'),
        el('div', { class: 'stats' },
          el('span', {}, `◆ ${s.coin} coin`), el('span', {}, `${s.runs} delves`), el('span', {}, `Tier ${TIER_IDS[s.unlocked]} open`))),
      el('main', { class: 'town' },
        el('div', { class: 'col' },
          el('section', { class: 'panel roster', 'aria-label': 'Your heroes' },
            el('h2', {}, 'The Inn', el('small', {}, ` ${s.roster.length} heroes · pick up to ${size}`)),
            el('div', { class: 'cards' }, ...s.roster.map((h) => this.heroCard(h))),
            s.roster.length === 0 ? el('p', { class: 'muted' }, 'The Inn is empty. Hire someone from the board.') : null),
          this.campPanel(),
          this.memorialPanel()),
        el('div', { class: 'col' },
          el('section', { class: 'panel plan', 'aria-label': 'Expedition' },
            el('h2', {}, 'Expedition'),
            el('label', {}, 'Where ',
              this.select(TIER_IDS.slice(0, s.unlocked + 1).map((t) => [t, `Tier ${t} · ${TIER_NAMES[t]} (${partySizeFor(t)} heroes)`]), this.plan.tier, (v) => { this.plan.tier = v; this.plan.fromWaystone = false; this.autoPick(); this.render(); })),
            el('label', {}, 'Orders to the Leader ',
              this.select(DOCTRINES.map(([d, name]) => [d, name]), this.plan.doctrine, (v) => { this.plan.doctrine = v as Doctrine; this.render(); })),
            el('p', { class: 'muted' }, DOCTRINES.find((d) => d[0] === this.plan.doctrine)![2]),
            way && way > first ? el('label', { class: 'check' },
              el('input', { type: 'checkbox', checked: this.plan.fromWaystone, onchange: (e: Event) => { this.plan.fromWaystone = (e.target as HTMLInputElement).checked; this.render(); } }),
              ` Start at the floor ${way} waystone`) : null,
            el('p', {}, 'Leader: ', el('strong', {}, this.hero(this.plan.leaderId)?.hero.name ?? 'none')),
            el('button', { class: 'go', type: 'button', disabled: !!problem, onclick: () => this.on.onDelve({ ...this.plan, partyIds: [...this.plan.partyIds] }) }, 'Delve'),
            problem ? el('p', { class: 'warn' }, problem) : null,
          s.roster.length && s.roster.every((h) => h.benched > 0) ? el('button', { type: 'button', onclick: () => { rest(s); this.autoPick(); this.render(); } }, 'Rest a while (everyone recovers a little)') : null),
          el('section', { class: 'panel board', 'aria-label': 'Hire board' },
            el('h2', {}, 'Hire board'),
            el('div', { class: 'cards' }, ...s.hireBoard.map((h) => this.hireCard(h)))))),
    );
  }

  private campPanel() {
    const s = this.state;
    return el('section', { class: 'panel camp', 'aria-label': 'Torchwatch' },
      el('h2', {}, 'Torchwatch', el('small', {}, ` ${(s.camp ?? []).length} of ${Object.keys(CAMP).length} built`)),
      el('div', { class: 'builds' }, ...Object.entries(CAMP).map(([id, u]) => {
        const built = s.camp?.includes(id);
        return el('article', { class: `build${built ? ' built' : ''}` },
          el('strong', {}, u.name), el('span', { class: 'muted' }, u.about),
          built ? el('span', { class: 'gain' }, 'Built') : el('button', { type: 'button', disabled: s.coin < u.cost, onclick: () => { build(s, id); this.render(); } }, `Build · ${u.cost}`));
      })));
  }

  private memorialPanel() {
    const s = this.state;
    return el('section', { class: 'panel memorial', 'aria-label': 'Memorial' },
      el('h2', {}, 'The memorial'),
      s.memorial.length ? el('ul', {}, ...s.memorial.slice().reverse().map((m) => el('li', {}, `${m.name}, ${RACES[m.raceId]?.name ?? m.raceId} ${CLASSES[m.classId]?.name ?? m.classId}, level ${m.level}: ${m.cause ?? 'fell'} (Tier ${m.tier}, delve ${m.run}).`))) : el('p', { class: 'muted' }, 'No names yet.'),
      el('h2', {}, 'Past delves'),
      s.history.length ? el('ul', {}, ...s.history.slice(0, 10).map((r) => el('li', {}, `#${r.run} Tier ${r.tier}: ${r.outcome === 'cleared' ? 'cleared' : r.outcome === 'retreat' ? 'came home' : 'wiped'}, floor ${r.floors}, +${r.banked} coin${r.died.length ? `, lost ${r.died.join(', ')}` : ''}`))) : el('p', { class: 'muted' }, 'No delves yet.'),
      el('button', { type: 'button', class: 'quiet', onclick: () => { if (this.abandonArmed) this.on.onAbandon(); else { this.abandonArmed = true; this.render(); } } }, this.abandonArmed ? 'Really abandon this save? Click again' : 'Abandon save'));
  }

  private select(options: [string, string][], value: string, onChange: (v: string) => void) {
    return el('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
  }

  private heroCard(h: RosterHero) {
    const id = h.hero.id;
    const inParty = this.plan.partyIds.includes(id);
    const resting = h.benched > 0;
    const rank = leaderProfile({ id, name: h.hero.name, raceId: h.hero.raceId, leadership: h.hero.leadership }).rank.id;
    const full = this.plan.partyIds.length >= partySizeFor(this.plan.tier);
    const toggle = () => {
      if (inParty) this.plan.partyIds = this.plan.partyIds.filter((x) => x !== id);
      else if (!full) this.plan.partyIds.push(id);
      if (!this.plan.partyIds.includes(this.plan.leaderId)) this.plan.leaderId = this.plan.partyIds[0] ?? '';
      this.render();
    };
    return el('article', { class: `card hero${inParty ? ' picked' : ''}${resting ? ' resting' : ''}` },
      this.portraitImg(h),
      el('div', { class: 'who' },
        el('strong', {}, h.hero.name),
        el('span', {}, `${RACES[h.hero.raceId]?.name ?? h.hero.raceId} ${CLASSES[h.hero.classId]?.name ?? h.hero.classId}`),
        el('span', {}, `Level ${h.hero.level}`, el('meter', { min: 0, max: xpToNext(h.hero.level), value: Math.floor(h.xp), title: `${Math.floor(h.xp)} / ${xpToNext(h.hero.level)} XP` })),
        el('span', { class: 'muted' }, `Leadership ${h.hero.leadership} (${rank})${h.runsLed ? ` · led ${h.runsLed}` : ''}`),
        resting ? el('span', { class: 'warn' }, `Recovering: ${h.benched} delve${h.benched > 1 ? 's' : ''}`) : null,
        (h.hero.items ?? []).length ? el('span', { class: 'gear-line' }, (h.hero.items ?? []).map((i) => ITEMS[i]?.name ?? i).join(' · ')) : null),
      el('div', { class: 'acts' },
        el('button', { type: 'button', 'aria-pressed': String(inParty), disabled: resting || (!inParty && full), onclick: toggle }, inParty ? 'Going' : 'Take'),
        el('button', { type: 'button', 'aria-pressed': String(this.plan.leaderId === id), disabled: !inParty, title: 'Carries the torch and makes the calls', onclick: () => { this.plan.leaderId = id; this.render(); } }, 'Lead'),
        el('button', { type: 'button', 'aria-pressed': String(this.gearOpen === id), onclick: () => { this.gearOpen = this.gearOpen === id ? null : id; this.render(); } }, 'Gear')),
      this.gearOpen === id ? this.gearEditor(h) : null);
  }

  /** One select per slot: what's worn, or anything in the stores this hero can use. */
  private gearEditor(h: RosterHero) {
    const stash = this.state.stash ?? [];
    const slots = SLOTS.filter((sl) => sl !== 'shield' || CLASSES[h.hero.classId]?.gear?.shield);
    return el('div', { class: 'gear-edit' }, ...slots.map((slot) => {
      const worn = (h.hero.items ?? []).find((i) => ITEMS[i]?.slot === slot);
      const options = [...new Set(stash.filter((i) => ITEMS[i]?.slot === slot && canEquip(h.hero.classId, i)))];
      return el('label', {}, `${slot[0].toUpperCase()}${slot.slice(1)} `,
        el('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; equip(this.state, h.hero.id, slot, v || null); this.render(); } },
          el('option', { value: '' }, worn ? '(take off)' : '(none)'),
          worn ? el('option', { value: worn, selected: true, disabled: true }, ITEMS[worn].name) : null,
          ...options.map((i) => el('option', { value: i }, `${ITEMS[i].name} (${describe(i)})`))));
    }), stash.length ? null : el('span', { class: 'muted' }, 'The stores are empty. Delves turn up gear.'));
  }

  private hireCard(h: RosterHero) {
    const cost = hireCost(h);
    return el('article', { class: 'card hero' },
      this.portraitImg(h),
      el('div', { class: 'who' },
        el('strong', {}, h.hero.name),
        el('span', {}, `${RACES[h.hero.raceId]?.name ?? h.hero.raceId} ${CLASSES[h.hero.classId]?.name ?? h.hero.classId}`),
        el('span', {}, `Level ${h.hero.level} · Leadership ${h.hero.leadership}`)),
      el('div', { class: 'acts' },
        el('button', { type: 'button', disabled: this.state.coin < cost, onclick: () => { const err = hire(this.state, h.hero.id); if (!err) { this.autoPick(); } this.render(); } }, `Hire · ${cost}`)));
  }

  private portraitImg(h: RosterHero) {
    const src = portrait(h.hero);
    return src ? el('img', { class: 'portrait', src, alt: '', width: 96, height: 112 }) : el('div', { class: 'portrait' });
  }
}
