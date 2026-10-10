// The Scout's Lens: hover a unit to read it live. Name and level, HP and energy, what it's
// doing right now (its current behaviour rule), and what's afflicting it.
import type { BattleReplay } from '../render/battleView';
import { clear, el } from './dom';

const STATUS_LABEL: Record<string, string> = {
  burn: 'Burning', poison: 'Poisoned', bleed: 'Bleeding', slow: 'Slowed', armorbreak: 'Armour broken', stun: 'Stunned', root: 'Rooted',
  sleep: 'Asleep', taunted: 'Taunted', might: 'Mighty', ward: 'Warded', haste: 'Hasted', downed: 'Downed', shaken: 'Shaken',
  fear: 'Afraid', disarmed: 'Disarmed', acid: 'Corroding',
};

export class ScoutLens {
  private x = -1;
  private y = -1;
  private readonly card: HTMLElement;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, private readonly replay: () => BattleReplay | null) {
    this.card = el('div', { class: 'lens', 'aria-live': 'off' });
    this.card.hidden = true;
    overlay.append(this.card);
    canvas.addEventListener('pointermove', (e) => { this.x = e.clientX; this.y = e.clientY; });
    canvas.addEventListener('pointerleave', () => { this.x = -1; this.card.hidden = true; });
  }

  update() {
    const r = this.replay();
    if (!r || this.x < 0) { this.card.hidden = true; return; }
    const hit = r.pick(this.x, this.y);
    const info = hit && r.inspect(hit.id);
    if (!info) { this.card.hidden = true; return; }
    const pct = (a: number, b: number) => `${Math.max(0, Math.min(100, (100 * a) / Math.max(1, b)))}%`;
    const parts = [
      el('div', { class: `lens-name ${info.team ? 'foe' : 'ally'}` }, info.name, el('small', {}, ` Lv ${info.level}`)),
      el('div', { class: 'lens-bar hp' }, el('span', { style: `width:${pct(info.hp, info.maxHp)}` }), el('em', {}, info.downed ? 'Downed' : `${info.hp} / ${info.maxHp}`)),
      el('div', { class: 'lens-bar en' }, el('span', { style: `width:${pct(info.energy, 100)}` }), el('em', {}, info.energy >= 100 ? 'Ultimate ready' : `Energy ${info.energy}`)),
      info.intent ? el('div', { class: 'lens-intent' }, info.intent) : null,
      info.statuses.length ? el('div', { class: 'lens-st' }, ...info.statuses.map((s) => el('span', {}, STATUS_LABEL[s] ?? s))) : null,
    ];
    clear(this.card).append(...parts.filter((p): p is HTMLDivElement => !!p));
    const rect = this.card.parentElement!.getBoundingClientRect();
    const w = 210;
    const left = Math.min(rect.width - w - 8, this.x - rect.left + 18), top = Math.max(8, this.y - rect.top - 20);
    this.card.style.left = `${left}px`; this.card.style.top = `${top}px`;
    this.card.hidden = false;
  }
}
