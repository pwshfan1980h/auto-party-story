// Torchwatch (M2 placeholder layout): the roster, the hire board, the memorial and the expedition plan.
import { CLASSES, RACES, TIERS } from '../sim/data';
import { leaderProfile, type Doctrine } from '../sim/leader';
import { xpToNext, type RosterHero } from '../sim/roster';
import { hire, partySizeFor, planProblem, rest, type DelvePlan } from '../game/expedition';
import { BASE_CLASSES, build, CAMP, equip, hireCost, promote, promotions, raceMet, TIER_IDS, type GameState } from '../game/state';
import { ABILITIES, ITEMS } from '../sim/data';
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
import { standardPortrait } from './runRecap';
import { preferences,updatePreferences } from '../game/preferences';
import { balancedParty,neededRecruit,readiness,recommendedTier,recommendedWaystone } from '../game/preparation';
import { claimReward,COMPANY } from '../game/rewards';
import { commission,commissionCost,commissionLevel,protectItem,refreshCost,rerollBoard,salvage,salvageValue,serviceCost,serviceGear,servicePreview } from '../game/economy';
import { sfx } from '../audio/sfx';

const DOCTRINES: [Doctrine, string, string][] = [
  ['balanced', 'Balanced', 'Weigh each room as it comes.'],
  ['home', 'Bring them home', 'Turn back early. Lives over loot.'],
  ['pack', 'Fill the pack', 'Greedier with treasure.'],
  ['depth', 'Go for the boss', 'Push deeper, and ignore a full pack.'],
];
const TIER_NAMES: Record<string, string> = Object.fromEntries(TIER_IDS.map((t) => [t, TIERS[t].name]));

export interface TownHandlers { onDelve(plan: DelvePlan): void; onAbandon(): void; onReview?():void }

export class Town {
  private plan: DelvePlan;
  private gearOpen: string | null = null;
  private trainOpen: string | null = null;
  private recruitClass='cleric';
  private message='';

  constructor(private readonly root: HTMLElement, private state: GameState, private readonly on: TownHandlers) {
    const tier = recommendedTier(state);
    this.plan = { partyIds: [], leaderId: '', tier, doctrine: 'balanced', fromWaystone: false };
    this.autoPick();
  }

  setState(state: GameState) { this.state = state; this.plan.tier = TIER_IDS[Math.min(TIER_IDS.indexOf(this.plan.tier), state.unlocked)]; this.autoPick(); this.render(); }

  /** Fill the party with the strongest rested heroes and hand the torch to the best Leader. */
  private autoPick() {
    const ready = this.state.roster.filter((h) => h.benched <= 0).sort((a, b) => b.hero.level - a.hero.level);
    this.plan.partyIds = this.plan.partyIds.filter((id) => ready.some((h) => h.hero.id === id));
    for (const h of [...balancedParty(this.state,partySizeFor(this.plan.tier)),...ready]) if (this.plan.partyIds.length < partySizeFor(this.plan.tier) && !this.plan.partyIds.includes(h.hero.id)) this.plan.partyIds.push(h.hero.id);
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
    const needed=neededRecruit(s);
    this.root.append(el('div',{class:'town-page'},
      el('header', { class: 'town-head' },
        el('h1', {}, 'Torchwatch'),
        el('div', { class: 'stats' },
          el('span', {}, `◆ ${s.coin} coin`), el('span', {}, `${s.runs} delves`), el('span', {}, `Tier ${TIER_IDS[s.unlocked]} open`))),
      !preferences.guideSeen?el('section',{class:'panel first-guide','aria-label':'How to play'},el('h2',{},'The torch is yours to hand over.'),
        el('p',{},'1. Prepare a company with a frontline and healing. 2. Choose a Leader and standing orders. 3. Delve, give timely orders, and bank what you bring home.'),
        el('p',{class:'warn'},'Death is permanent. Closing a running delve lets the Leader finish it. Returning alive with loot is a success.'),
        el('button',{type:'button',onclick:()=>{updatePreferences({guideSeen:true});this.render()}},'Got it — prepare the company')):null,
      this.message?el('p',{class:'town-message',role:'status'},this.message):null,
      el('main', { class: 'town' },
        el('div', { class: 'col' },
          el('section', { class: 'panel roster', 'aria-label': 'Your heroes' },
            el('h2', {}, 'The Inn', el('small', {}, ` ${s.roster.length} heroes · pick up to ${size}`)),
            el('div', { class: 'cards' }, ...s.roster.map((h) => this.heroCard(h))),
            s.roster.length === 0 ? el('p', { class: 'muted' }, 'The Inn is empty. Hire someone from the board.') : null),
          this.campPanel(),
          this.storesPanel(),
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
            ...readiness(s,this.plan.partyIds,this.plan.tier,this.plan.fromWaystone).map(w=>el('p',{class:'readiness-note'},w)),
            needed?el('div',{class:'readiness-note'},el('p',{},`Your roster needs a ${needed==='cleric'?'sustained healer':'dedicated frontline'}. A ${CLASSES[needed].name} arrives at level ${commissionLevel(s)}.`),
              el('button',{type:'button',disabled:s.coin<commissionCost(s),onclick:()=>{const error=commission(s,needed);if(!error){this.plan.partyIds=balancedParty(s,size).map(h=>h.hero.id);this.plan.leaderId='';this.autoPick()}this.action(error,'The needed role was recruited and a balanced party suggested. Review the company before you go.')}},`Recruit ${CLASSES[needed].name} & prepare · ${commissionCost(s)} coin`)):null,
            el('button',{type:'button',onclick:()=>{this.plan.partyIds=balancedParty(s,size).map(h=>h.hero.id);this.plan.leaderId='';this.autoPick();this.message='A frontline and available healing were prioritized. Review the company before you go.';this.render()}},'Suggest a balanced party'),
            recommendedTier(s)!==this.plan.tier||this.plan.fromWaystone&&!recommendedWaystone(s,this.plan.partyIds,this.plan.tier)?el('button',{type:'button',onclick:()=>{this.plan.tier=recommendedTier(s);this.plan.fromWaystone=false;this.plan.partyIds=[];this.autoPick();this.render()}},recommendedTier(s)===this.plan.tier?'Prepare an entrance recovery route':TIER_IDS.indexOf(recommendedTier(s))<TIER_IDS.indexOf(this.plan.tier)?`Prepare a Tier ${recommendedTier(s)} recovery route`:`Prepare the recommended Tier ${recommendedTier(s)} route`):null,
          s.roster.length && s.roster.every((h) => h.benched > 0) ? el('button', { type: 'button', onclick: () => { rest(s); this.autoPick(); this.render(); } }, 'Rest a while (everyone recovers a little)') : null),
          el('section', { class: 'panel board', 'aria-label': 'Hire board' },
            el('h2', {}, 'Hire board'),
            el('div', { class: 'cards' }, ...s.hireBoard.map((h) => this.hireCard(h))),
            el('button',{type:'button',disabled:s.coin<refreshCost(s),onclick:()=>this.action(rerollBoard(s),'The hire board has new faces.')},`Refresh hire board · ${refreshCost(s)} coin`),
            el('h3',{},'Commission a needed role'),
            el('p',{class:'muted'},`Choose a class directly. Recruits arrive at level ${commissionLevel(s)}.`),
            this.select(BASE_CLASSES.map(c=>[c,CLASSES[c].name]),this.recruitClass,v=>{this.recruitClass=v;this.render()}),
            el('button',{type:'button',disabled:s.coin<commissionCost(s),onclick:()=>{const error=commission(s,this.recruitClass);this.autoPick();this.action(error,'Your commissioned recruit is at the Inn.')}},`Commission · ${commissionCost(s)} coin`),
            this.racesNote()))),
    ));
  }

  private action(error:string|null,success:string){this.message=error??success;if(!error)sfx.cue('build');this.render()}

  private storesPanel(){
    const s=this.state,unclaimed=(s.rewards??[]).filter(r=>!r.claimed);
    const panel=el('section',{class:'panel stores','aria-label':'Company stores'},el('h2',{},'The stores'));
    for(const reward of unclaimed)panel.append(el('div',{class:'unclaimed-reward'},el('h3',{},`Tier ${reward.tier} first-clear reward`),
      ...reward.options.map(id=>el('button',{type:'button',title:describe(id),onclick:()=>this.action(claimReward(s,reward.id,id),`${ITEMS[id].name} is in the stores.`)},`Claim ${ITEMS[id].name}`)),
      el('button',{type:'button',onclick:()=>this.action(claimReward(s,reward.id,'coin'),'The service fund is available.')},`Claim ${COMPANY.rewards.firstClearCoin[TIER_IDS.indexOf(reward.tier)]} coin instead`)));
    const stock=[...new Set(s.stash??[])];
    panel.append(stock.length?el('p',{class:'muted'},'Use a hero’s Gear button to equip items. Protect favorites; salvage only spare duplicates.'):el('p',{class:'muted'},'Gear found in delves waits here. First-clear rewards can also be claimed here.'));
    for(const id of stock){const count=s.stash!.filter(x=>x===id).length,protectedItem=s.favorites?.includes(id);panel.append(el('div',{class:'store-row'},el('span',{},`${ITEMS[id].name} ×${count}`),
      el('button',{type:'button','aria-pressed':String(!!protectedItem),onclick:()=>{protectItem(s,id);this.render()}},protectedItem?'Protected':'Protect'),
      el('button',{type:'button',disabled:count<2||!!protectedItem,onclick:()=>{if(confirm(`Salvage one spare ${ITEMS[id].name} for ${salvageValue(id)} coin? Another copy remains in the stores.`))this.action(salvage(s,id),'One spare item was salvaged; another copy was kept.')}},`Salvage spare · ${salvageValue(id)}`)))}
    return panel;
  }

  private campPanel() {
    const s = this.state;
    const standard=s.milestones.III!==undefined?standardPortrait():'';
    return el('section', { class: 'panel camp', 'aria-label': 'Torchwatch' },
      el('h2', {}, 'Torchwatch', el('small', {}, ` ${(s.camp ?? []).length} of ${Object.keys(CAMP).length} built`)),
      s.legacyCompletion?el('p',{class:'muted'},'This older company’s final-clear records are incomplete. Its next final victory will be remembered here as the first recorded clear.'):null,
      s.milestones.III!==undefined?el('div',{class:'town-standard'},standard?el('img',{src:standard,alt:'Your company standard',width:96,height:112}):null,el('p',{class:'gain'},'Your company conquered the depths. The standard remains.')):null,
      el('div', { class: 'builds' }, ...Object.entries(CAMP).map(([id, u]) => {
        const built = s.camp?.includes(id);
        return el('article', { class: `build${built ? ' built' : ''}` },
          el('strong', {}, u.name), el('span', { class: 'muted' }, u.about),
          built ? el('span', { class: 'gain' }, 'Built') : el('button', { type: 'button', disabled: s.coin < u.cost, onclick: () => this.action(build(s,id),`${u.name} is ready for the company.`) }, `Build · ${u.cost}`));
      })));
  }

  private memorialPanel() {
    const s = this.state;
    return el('section', { class: 'panel memorial', 'aria-label': 'Memorial' },
      el('h2', {}, 'The memorial'),
      s.memorial.length ? el('ul', {}, ...s.memorial.slice().reverse().map((m) => el('li', {}, `${m.name}, ${RACES[m.raceId]?.name ?? m.raceId} ${CLASSES[m.classId]?.name ?? m.classId}, level ${m.level}: ${m.cause ?? 'fell'} (Tier ${m.tier}, delve ${m.run}).`))) : el('p', { class: 'muted' }, 'No names yet.'),
      el('h2', {}, 'Past delves'),
      s.lastReceipt?el('button',{type:'button',onclick:()=>this.on.onReview?.()},'Review last return'):null,
      s.history.length ? el('ul', {}, ...s.history.slice(0, 10).map((r) => el('li', {}, `#${r.run} Tier ${r.tier}: ${r.outcome === 'cleared' ? 'cleared' : r.outcome === 'retreat' ? 'came home' : 'wiped'}, floor ${r.floors}, +${r.banked} coin${r.died.length ? `, lost ${r.died.join(', ')}` : ''}`))) : el('p', { class: 'muted' }, 'No delves yet.'),
      el('button', { type: 'button', class: 'quiet', onclick: () => { if(confirm('Abandon this company and begin again? A backup of this save will be kept.'))this.on.onAbandon(); } }, 'Abandon save'));
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
        el('button', { type: 'button', 'aria-pressed': String(this.gearOpen === id), onclick: () => { this.gearOpen = this.gearOpen === id ? null : id; this.render(); } }, 'Gear'),
        promotions(this.state, id).options.length ? el('button', { type: 'button', 'aria-pressed': String(this.trainOpen === id), onclick: () => { this.trainOpen = this.trainOpen === id ? null : id; this.render(); } }, 'Train') : null),
      this.gearOpen === id ? this.gearEditor(h) : null,
      this.trainOpen === id ? this.trainer(h) : null);
  }

  /** The Specialists a hero can train as: what each brings, and the choice itself. */
  private trainer(h: RosterHero) {
    const { options, blocked } = promotions(this.state, h.hero.id);
    const ab = (id: string) => ABILITIES[id]?.name ?? id;
    return el('div', { class: 'gear-edit' },
      blocked ? el('span', { class: 'warn' }, blocked) : el('span', { class: 'muted' }, 'Training is for good: choose carefully.'),
      ...options.map((c) => {
        const k = CLASSES[c];
        const roles = Object.entries(k.roles).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 2).map(([r]) => r).join(' and ');
        return el('div', { class: 'build' },
          el('strong', {}, k.name), el('span', { class: 'muted' }, `${roles}. Skills: ${k.skills.map(ab).join(', ')}. Ultimate: ${ab(k.ult)}.`),
          el('button', { type: 'button', disabled: !!blocked, onclick: () => { if (!promote(this.state, h.hero.id, c)) { this.trainOpen = null; this.render(); } } }, `Train as ${k.name}`));
      }));
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
    }), stash.length ? null : el('span', { class: 'muted' }, 'The stores are empty. Delves turn up gear.'),
    el('div',{class:'equipment-service'},el('strong',{},`Equipment service · ${this.state.refinements?.[h.hero.id]??0}/${COMPANY.economy.serviceCap}`),
      el('p',{},`Each service adds ${COMPANY.economy.serviceGearStep} gear quality in future delves, improving health, damage, spells, and armour. It stays with this hero.`),
      el('p',{class:'gain'},`Tier ${this.plan.tier}: ${servicePreview(this.state,h.hero.id,this.plan.tier)}`),
      el('button',{type:'button',disabled:(this.state.refinements?.[h.hero.id]??0)>=COMPANY.economy.serviceCap||this.state.coin<serviceCost(this.state,h.hero.id),onclick:()=>this.action(serviceGear(this.state,h.hero.id),`${h.hero.name}’s equipment was improved.`)},`Service gear · ${serviceCost(this.state,h.hero.id)} coin`)));
  }

  /** Who comes to the Inn: races met, and hints at the ones still to meet. */
  private racesNote() {
    const met = Object.keys(RACES).filter((r) => raceMet(this.state, r));
    const unmet = Object.keys(RACES).filter((r) => !raceMet(this.state, r));
    return el('details', { class: 'races' },
      el('summary', {}, `Peoples met: ${met.length} of ${Object.keys(RACES).length}`),
      el('ul', {}, ...met.map((r) => el('li', {}, el('strong', {}, RACES[r].name), ` · ${RACES[r].trait.name}: ${RACES[r].trait.about} Two or more: ${RACES[r].synergy.name}, ${RACES[r].synergy.about}`))),
      unmet.length ? el('ul', { class: 'muted' }, ...unmet.map((r) => el('li', {}, `${RACES[r].name}: ${RACES[r].unlock.hint ?? 'not yet met'}`))) : null);
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
