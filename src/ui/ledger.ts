// The Delve Ledger: what was gained and lost, room by room, before heading back to Torchwatch.
import type { DelveOutcome } from '../game/expedition';
import { CLASSES, ITEMS } from '../sim/data';
import { clear, el } from './dom';

const OUTCOME: Record<string, [string, string]> = {
  cleared: ['Cleared', 'The tier is beaten.'],
  retreat: ['Came home', 'The Leader called it, and the party walked out.'],
  wipe: ['Wiped', 'No one came back.'],
};

export function renderLedger(root: HTMLElement, out: DelveOutcome, onBack: () => void, note?: string) {
  const r = out.result;
  let [title, line] = OUTCOME[r.outcome];
  if (r.outcome === 'retreat' && r.ledger.some((e) => e.response === 'turned back')) line = 'You called the retreat, and the party walked out.';
  const died = new Set(out.aftermath.died);
  const levelled = new Map(out.aftermath.levelled.map((l) => [l.id, l.level]));
  clear(root).append(
    el('main', { class: 'ledger' },
      el('header', {}, el('h1', { class: r.outcome }, title), el('p', {}, line), note ? el('p', { class: 'warn' }, note) : null,
        out.unlockedTier ? el('p', { class: 'gain big' }, `Tier ${out.unlockedTier} is open.`) : null),
      el('section', { class: 'panel' },
        el('h2', {}, 'The party'),
        el('ul', {}, ...Object.entries(r.heroes).map(([id, h]) => el('li', { class: died.has(id) ? 'warn' : '' },
          `${out.names[id] ?? id} (${CLASSES[out.classes[id]]?.name ?? 'hero'}): `,
          died.has(id) ? 'fell, and is gone for good.' : h.carried ? 'carried out; needs to recover.' : `${Math.round(100 * h.hp / Math.max(1, h.maxHp))}% HP.`,
          !died.has(id) && out.aftermath.xp[id] ? ` +${Math.round(out.aftermath.xp[id])} XP` : '',
          levelled.has(id) ? el('strong', { class: 'gain' }, ` Level ${levelled.get(id)}!`) : '')))),
      el('section', { class: 'panel' },
        el('h2', {}, 'Banked'),
        el('p', {}, `◆ ${r.banked} coin from ${r.pack.items} item${r.pack.items === 1 ? '' : 's'}${r.lostValue ? ` (${r.lostValue} worth left behind or lost)` : ''}.`),
        r.found.length ? el('p', { class: 'gain' }, `Gear brought home: ${r.found.map((i) => ITEMS[i]?.name ?? i).join(', ')}. It waits in the stores.`) : null,
        el('p', { class: 'muted' }, `Reached floor ${r.floorsReached} · ${r.rooms} rooms · ${r.fightsWon}/${r.fights} fights won`)),
      el('section', { class: 'panel' },
        el('h2', {}, 'Room by room'),
        el('ol', { class: 'rooms' }, ...r.ledger.filter((e) => e.room !== 'start').map((e) => el('li', {},
          el('span', { class: e.result === 'lost' ? 'warn' : '' }, `F${e.floor} ${e.room}${e.named ? ` (${e.named})` : ''}${e.event ? `, ${e.event.choice.toLowerCase()}` : ''}: ${e.result}`),
          e.gained.length ? el('span', { class: 'gain' }, ` + ${e.gained.join(', ')}`) : '',
          e.lost.length ? el('span', { class: 'warn' }, ` − ${e.lost.join(', ')}`) : '')))),
      el('button', { class: 'go', type: 'button', onclick: onBack }, 'Back to Torchwatch')),
  );
}
