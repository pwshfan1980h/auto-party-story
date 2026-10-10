// Watching a delve: room by room, with the fogged minimap, the Leader's calls and every fight replayed.
import type { DelveOutcome } from '../game/expedition';
import { BattleReplay, type BattleOptions } from '../render/battleView';
import type { BattleScene } from '../render/scene';
import type { FloorMap, NodeType } from '../sim/delve';
import type { LedgerEntry } from '../sim/run';
import { clear, el } from './dom';
import { sfx } from '../audio/sfx';

const ROOM_NAME: Record<NodeType, string> = { start: 'Entrance', fight: 'Fight', elite: 'Elite', treasure: 'Treasure', shrine: 'Shrine', campfire: 'Campfire', event: 'Event', horde: 'Horde', stairs: 'Stairs down', boss: 'Boss' };
const GLYPH: Record<NodeType, string> = { start: 'S', fight: '⚔', elite: '☠', treasure: '◆', shrine: '+', campfire: '△', event: '?', horde: '≋', stairs: '▼', boss: '♛' };
const SVGNS = 'http://www.w3.org/2000/svg';

export class DelvePlayer {
  private idx = -1;
  private replay: BattleReplay | null = null;
  private wait = 0;
  private finished = false;
  speed = 0.75;
  readonly opts: BattleOptions = { camera: 'subtle', clarity: false, torchFuel: 7, audio: sfx };

  constructor(private readonly scene: BattleScene, private readonly overlay: HTMLElement, private readonly hud: HTMLElement, private readonly out: DelveOutcome, private readonly onDone: () => void) {
    this.next();
  }

  private get entries(): LedgerEntry[] { return this.out.result.ledger; }

  /** Skip the fight on screen (the outcome is already settled). */
  skipFight() { if (this.replay) { this.replay.dispose(); this.replay = null; this.wait = 0.2; } }
  skipAll() { this.replay?.dispose(); this.replay = null; this.finish(); }

  private finish() { if (!this.finished) { this.finished = true; this.onDone(); } }

  private next() {
    this.idx++;
    if (this.idx >= this.entries.length) { this.finish(); return; }
    const e = this.entries[this.idx];
    this.drawHud(e);
    // the walk there, then what the room holds
    if (e.room !== 'start') sfx.footsteps(e.fight ? 4 : 5);
    setTimeout(() => sfx.room(e.room), e.room === 'start' ? 0 : 900);
    if (e.fight) {
      this.replay = new BattleReplay(this.scene, e.fight, this.overlay, this.opts);
      this.wait = 0;
    } else {
      this.wait = e.room === 'start' ? 0.8 : e.room === 'stairs' ? 2.2 : 2;
    }
  }

  update(dt: number) {
    if (this.finished) return;
    if (this.replay) {
      this.replay.update(dt, this.speed);
      if (this.replay.done) { this.wait = 1.4; this.replayDone(); }
      return;
    }
    this.wait -= dt * Math.max(1, this.speed);
    if (this.wait <= 0) this.next();
  }

  private replayDone() {
    // linger on the aftermath, then clear it away
    const r = this.replay!;
    this.replay = null;
    setTimeout(() => r.dispose(), 1200 / Math.max(0.5, this.speed));
  }

  dispose() { this.replay?.dispose(); this.replay = null; }

  private drawHud(e: LedgerEntry) {
    const map = this.out.result.maps.find((m) => m.floor === e.floor);
    const call = e.call;
    const leaderName = call ? this.out.names[call.leader] ?? 'The Leader' : '';
    clear(this.hud).append(
      el('div', { class: 'hud-map' },
        el('div', { class: 'hud-title' }, `Floor ${e.floor} · room ${this.idx + 1} of ${this.entries.length}`),
        map ? this.minimap(map, e) : null),
      el('div', { class: 'hud-room' },
        el('strong', {}, `${ROOM_NAME[e.room]}${e.named ? ` · ${e.named}` : ''}`),
        call ? el('p', { class: 'council' }, `${leaderName}: “${call.reason}”`) : null,
        e.warnings?.length ? el('p', { class: 'warn' }, ...e.warnings.map((w) => `⚠ ${w.detail} `)) : null,
        !e.fight && e.gained.length ? el('p', { class: 'gain' }, `Found ${e.gained.join(', ')}`) : null,
        !e.fight && e.lost.length ? el('p', { class: 'warn' }, e.lost.join(', ')) : null),
    );
  }

  /** The floor's map with fog: rooms visited so far, and what the party can see from them. */
  private minimap(map: FloorMap, here: LedgerEntry): SVGSVGElement {
    const visited = new Set(this.entries.slice(0, this.idx + 1).filter((x) => x.floor === map.floor).map((x) => x.node));
    const seen = new Set(visited);
    for (const id of visited) for (const n of map.nodes[id].next) seen.add(n);
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
      const cls = n.id === here.node ? 'node here' : visited.has(n.id) ? 'node done' : 'node';
      add('circle', { cx: x, cy: y, r: 8, class: cls });
      add('text', { x, y: y + 3.5, class: 'glyph' }, visited.has(n.id) || n.known ? GLYPH[n.type] : '?');
    }
    return svg;
  }
}
