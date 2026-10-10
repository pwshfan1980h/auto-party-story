// Taking part in a delve: the run pauses for each fight (played live, with Player Orders),
// for the Council when the Leader's call comes with warnings, and between rooms for the
// one emergency Turn back. The fogged minimap and the Leader's calls follow along.
import { sfx } from '../audio/sfx';
import { BattleReplay, type BattleOptions } from '../render/battleView';
import type { BattleScene } from '../render/scene';
import { ORDERS, type FightResult, type OrderKind } from '../sim/fight';
import type { FloorMap, NodeType } from '../sim/delve';
import type { CouncilAnswer, DelveAnswer, DelveRequest, LedgerEntry, RunResult } from '../sim/run';
import { clear, el } from './dom';

const ROOM_NAME: Record<NodeType, string> = { start: 'Entrance', fight: 'Fight', elite: 'Elite', treasure: 'Treasure', shrine: 'Shrine', campfire: 'Campfire', event: 'Event', horde: 'Horde', stairs: 'Stairs down', boss: 'Boss' };
const GLYPH: Record<NodeType, string> = { start: 'S', fight: '⚔', elite: '☠', treasure: '◆', shrine: '+', campfire: '△', event: '?', horde: '≋', stairs: '▼', boss: '♛' };
const SVGNS = 'http://www.w3.org/2000/svg';

/** The orders the player can give, who they target, and how they read on the button. */
const ORDER_UI: { kind: OrderKind; label: string; target: 'ally' | 'foe' | 'none'; hint: string }[] = [
  { kind: 'mend', label: 'Mend', target: 'ally', hint: 'The healer tends this hero now (revives the Downed)' },
  { kind: 'focus', label: 'Focus', target: 'foe', hint: 'Everyone hits this one' },
  { kind: 'interrupt', label: 'Interrupt', target: 'foe', hint: 'Break this enemy’s big cast' },
  { kind: 'guard', label: 'Guard', target: 'ally', hint: 'The tank shields this hero' },
  { kind: 'unleash', label: 'Unleash', target: 'ally', hint: 'Fire a nearly charged ultimate now' },
  { kind: 'hold', label: 'Hold', target: 'none', hint: 'Brace together: the party wards up' },
  { kind: 'charge', label: 'Charge', target: 'none', hint: 'All in, faster and harder' },
  { kind: 'fallback', label: 'Fall back!', target: 'none', hint: 'Get out of this fight, dropping some loot' },
];

export interface DelveView { names: Record<string, string> }

export class DelvePlayer {
  replay: BattleReplay | null = null;
  private wait = 0;
  private finished = false;
  private pendingQ: DelveRequest | null = null;
  private entries: LedgerEntry[] = [];
  private maps = new Map<number, FloorMap>();
  private wantTurnBack = false;
  private turnBackUsed = false;
  private targeting: (typeof ORDER_UI)[number] | null = null;
  private councilOpen = false;
  private result: RunResult | null = null;
  private lastLeader = '';
  speed = 0.75;
  readonly opts: BattleOptions = { camera: 'subtle', clarity: false, torchFuel: 7, audio: sfx };

  constructor(
    private readonly scene: BattleScene,
    private readonly overlay: HTMLElement,
    private readonly hud: HTMLElement,
    private readonly controls: HTMLElement,
    private readonly steps: Generator<DelveRequest, RunResult, DelveAnswer>,
    private readonly view: DelveView,
    private readonly onDone: (result: RunResult) => void,
  ) {
    scene.canvas.addEventListener('click', this.onCanvasClick);
    this.advance(undefined);
  }

  /** Skip the fight on screen: it plays out at once, without further orders. */
  skipFight() { if (this.replay) { while (!this.replay.done) this.replay.update(0.25, 4); } }
  /** Ask for the one emergency Turn back: taken at the next doorway. */
  turnBack() { if (!this.turnBackUsed) { this.wantTurnBack = true; this.drawControls(); } }

  dispose() {
    this.replay?.dispose(); this.replay = null;
    this.scene.canvas.removeEventListener('click', this.onCanvasClick);
    clear(this.controls);
  }

  /** Feed an answer to the run and handle whatever it asks for next. */
  private advance(answer: DelveAnswer) {
    for (;;) {
      const step = this.steps.next(answer);
      if (step.done) { this.result = step.value; this.finish(); return; }
      const q = step.value;
      answer = undefined;
      if (q.kind === 'between') {
        // the doorway: the player's emergency Turn back, if they asked for it
        if (this.wantTurnBack && q.canTurnBack) { this.wantTurnBack = false; this.turnBackUsed = true; answer = 'turn back'; }
        else answer = 'go';
        continue;
      }
      if (q.kind === 'room' || q.kind === 'fight' || q.kind === 'council') this.setMaps(q.maps);
      if (q.kind === 'room') {
        // a fight's room was already shown when the fight began
        if (!this.entries.includes(q.entry)) this.entries.push(q.entry);
        this.drawHud(q.entry);
        if (q.entry.room !== 'start') sfx.footsteps(4);
        setTimeout(() => sfx.room(q.entry.room), 700);
        this.wait = q.entry.room === 'stairs' ? 2 : 1.6;
        this.pendingQ = q;
        return;
      }
      if (q.kind === 'fight') {
        this.entries.push(q.entry);
        this.drawHud(q.entry);
        sfx.footsteps(3);
        setTimeout(() => sfx.room(q.entry.room), 600);
        this.replay = new BattleReplay(this.scene, q.setup, this.overlay, this.opts, true);
        this.pendingQ = q;
        this.drawControls();
        return;
      }
      if (q.kind === 'council') { this.pendingQ = q; this.openCouncil(q); return; }
    }
  }

  update(dt: number) {
    if (this.finished || this.councilOpen) return;
    if (this.replay) {
      this.replay.update(dt, this.speed);
      this.drawEmbers();
      if (this.replay.done && this.replay.result) {
        const r: FightResult = this.replay.result;
        const old = this.replay;
        this.replay = null;
        this.targeting = null;
        setTimeout(() => old.dispose(), 1300 / Math.max(0.5, this.speed));
        this.pendingQ = null;
        this.drawControls();
        // the room report (gains, losses) follows from the run
        this.advance(r);
      }
      return;
    }
    if (this.pendingQ?.kind === 'room') {
      this.wait -= dt * Math.max(1, this.speed);
      if (this.wait <= 0) { this.pendingQ = null; this.advance(undefined); }
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    clear(this.controls);
    this.onDone(this.result!);
  }

  // ---------- Player Orders ----------

  private onCanvasClick = (e: MouseEvent) => {
    if (!this.targeting || !this.replay) return;
    const want = this.targeting.target === 'ally' ? 0 : 1;
    const hit = this.replay.pick(e.clientX, e.clientY, want);
    if (!hit) return;
    this.give(this.targeting, hit.id);
  };

  private give(o: (typeof ORDER_UI)[number], target?: string) {
    if (!this.replay) return;
    const res = this.replay.order(o.kind, target);
    this.targeting = null;
    this.flash(res === 'ok' ? `${o.label}!` : res);
    if (res === 'ok') sfx.ui('click');
    this.drawControls();
  }

  private flash(text: string) {
    const n = el('div', { class: 'order-flash' }, text);
    this.controls.append(n);
    setTimeout(() => n.remove(), 1400);
  }

  private drawEmbers() {
    const pips = this.controls.querySelector('.embers');
    if (!pips || !this.replay) return;
    const n = this.replay.embers;
    if (pips.getAttribute('data-n') === String(n)) return;
    pips.setAttribute('data-n', String(n));
    clear(pips).append(...Array.from({ length: 3 }, (_, i) => el('span', { class: i < n ? 'pip lit' : 'pip' })));
  }

  private drawControls() {
    clear(this.controls);
    const row: (Node | null)[] = [];
    if (this.replay) {
      row.push(el('span', { class: 'embers', title: 'Embers: what Player Orders cost. One returns after each won fight.' }));
      for (const o of ORDER_UI) {
        const cost = ORDERS[o.kind].cost;
        row.push(el('button', {
          type: 'button', class: 'order', title: `${o.hint} (${cost} ember${cost > 1 ? 's' : ''})`,
          'aria-pressed': String(this.targeting?.kind === o.kind),
          onclick: () => { if (o.target === 'none') this.give(o); else { this.targeting = this.targeting?.kind === o.kind ? null : o; this.drawControls(); } },
        }, `${o.label} ${'◆'.repeat(cost)}`));
      }
      if (this.targeting) row.push(el('span', { class: 'hint' }, `Click ${this.targeting.target === 'ally' ? 'a hero' : 'an enemy'}`));
    }
    row.push(el('button', { type: 'button', class: 'turnback', disabled: this.turnBackUsed, 'aria-pressed': String(this.wantTurnBack), title: 'Once per delve: the party turns for home at the next doorway', onclick: () => this.turnBack() },
      this.turnBackUsed ? 'Turned back' : this.wantTurnBack ? 'Turning back…' : 'Turn back'));
    this.controls.append(...row.filter((x): x is Node => !!x));
    this.drawEmbers();
  }

  // ---------- the Council ----------

  private openCouncil(q: Extract<DelveRequest, { kind: 'council' }>) {
    this.councilOpen = true;
    sfx.ui('click');
    const map = this.maps.get(q.floor);
    const leader = this.view.names[q.call.leader] ?? 'The Leader';
    const target = map?.nodes[q.target];
    const answer = (a: CouncilAnswer) => {
      this.councilOpen = false;
      if (a === 'turn back') this.turnBackUsed = true;
      panel.remove();
      this.pendingQ = null;
      this.drawControls();
      this.advance(a);
    };
    const panel = el('div', { class: 'council-panel', role: 'dialog', 'aria-label': 'The Council' },
      el('h2', {}, 'The Council'),
      el('p', { class: 'council' }, `${leader}: “${q.call.reason}”`),
      target ? el('p', {}, `Heading for: ${target.known ? ROOM_NAME[target.type] : 'an unknown room'}`) : null,
      el('ul', { class: 'warn' }, ...q.warnings.map((w) => el('li', {}, w.detail))),
      el('div', { class: 'acts' },
        el('button', { type: 'button', class: 'go', onclick: () => answer('trust') }, 'Trust the Leader'),
        ...q.safer.slice(0, 2).map((id) => el('button', {
          type: 'button', disabled: !q.thisWayOpen || q.embers < 2,
          title: 'Point the way to a room without warnings (2 embers, once per floor)',
          onclick: () => answer({ thisWay: id }),
        }, `This way: ${map?.nodes[id] ? ROOM_NAME[map.nodes[id].type] : 'the other door'} ◆◆`)),
        el('button', { type: 'button', disabled: !q.turnBackOpen || this.turnBackUsed, onclick: () => answer('turn back') }, 'Turn back')));
    this.hud.append(panel);
  }

  // ---------- the map and the room ----------

  private drawHud(e: LedgerEntry) {
    const call = e.call;
    const leaderName = call ? this.view.names[call.leader] ?? 'The Leader' : '';
    const known = this.mapFor(e);
    queueMicrotask(() => { if (call) this.lastLeader = call.leader; });
    clear(this.hud).append(
      el('div', { class: 'hud-map' },
        el('div', { class: 'hud-title' }, `Floor ${e.floor} · room ${this.entries.length}`),
        known ? this.minimap(known, e) : null),
      el('div', { class: 'hud-room' },
        el('strong', {}, `${ROOM_NAME[e.room]}${e.named ? ` · ${e.named}` : ''}`),
        call && this.lastLeader && call.leader !== this.lastLeader ? el('p', { class: 'warn' }, `${leaderName} takes up the torch.`) : null,
        call ? el('p', { class: 'council' }, `${leaderName}: “${call.reason}”`) : null,
        e.response === 'turned back' ? el('p', { class: 'warn' }, 'You called it: the party turns for home.') : null,
        !e.fight && e.gained.length ? el('p', { class: 'gain' }, `Found ${e.gained.join(', ')}`) : null,
        !e.fight && e.lost.length ? el('p', { class: 'warn' }, e.lost.join(', ')) : null),
    );
  }

  /** The run's maps aren't out until it ends; draw what the party has walked so far. */
  private mapFor(e: LedgerEntry): FloorMap | undefined {
    return this.maps.get(e.floor) ?? (this.result ? this.result.maps.find((m) => m.floor === e.floor) : undefined);
  }

  setMaps(maps: FloorMap[]) { for (const m of maps) this.maps.set(m.floor, m); }

  private minimap(map: FloorMap, here: LedgerEntry): SVGSVGElement {
    const visited = new Set(this.entries.filter((x) => x.floor === map.floor).map((x) => x.node));
    const seen = new Set(visited);
    for (const id of visited) for (const n of map.nodes[id]?.next ?? []) seen.add(n);
    const W = 26, H = 22;
    const pos = (id: number) => { const n = map.nodes[id]; return [12 + n.layer * W, 12 + n.lane * H]; };
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${24 + (map.layers - 1) * W} ${24 + 2 * H}`);
    svg.setAttribute('class', 'minimap');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Floor ${map.floor} map`);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text) n.textContent = text;
      svg.append(n);
    };
    for (const n of map.nodes) if (seen.has(n.id)) for (const c of n.next) if (seen.has(c)) {
      const [x1, y1] = pos(n.id), [x2, y2] = pos(c);
      add('line', { x1, y1, x2, y2, class: visited.has(n.id) && visited.has(c) ? 'path walked' : 'path' });
    }
    for (const n of map.nodes) {
      if (!seen.has(n.id)) continue;
      const [x, y] = pos(n.id);
      add('circle', { cx: x, cy: y, r: 8, class: n.id === here.node ? 'node here' : visited.has(n.id) ? 'node done' : 'node' });
      add('text', { x, y: y + 3.5, class: 'glyph' }, visited.has(n.id) || n.known ? GLYPH[n.type] : '?');
    }
    return svg;
  }
}
