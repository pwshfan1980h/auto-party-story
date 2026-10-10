// Auto Party Story, M2: Torchwatch → delve → Delve Ledger → Torchwatch, saved in the browser.
import { sfx } from '../audio/sfx';
import { BattleScene } from '../render/scene';
import { DelvePlayer } from '../ui/delvePlay';
import { renderLedger } from '../ui/ledger';
import { Town } from '../ui/town';
import { delve, type DelveOutcome, type DelvePlan } from './expedition';
import { eraseGame, loadGame, newGame, saveGame, type GameState } from './state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
let state: GameState = loadGame() ?? newGame();
saveGame(state);
let scene: BattleScene | null = null;
let player: DelvePlayer | null = null;

const town = new Town(app, state, { onDelve: startDelve, onAbandon: () => { eraseGame(); state = newGame(); saveGame(state); town.setState(state); } });
town.render();

function startDelve(plan: DelvePlan) {
  sfx.unlock();
  sfx.ui('delve');
  // the run is settled and saved before it is shown: Hardcore
  const out = delve(state, plan);
  document.body.classList.add('delving');
  scene ??= new BattleScene($('c'));
  player = new DelvePlayer(scene, $('ov'), $('hud'), out, () => showLedger(out));
  window.scrollTo(0, 0);
}

function showLedger(out: DelveOutcome) {
  player?.dispose();
  player = null;
  document.body.classList.remove('delving');
  renderLedger(app, out, () => { town.setState(state); window.scrollTo(0, 0); });
  window.scrollTo(0, 0);
}

// delve controls
const speeds: [string, number][] = [['½×', 0.5], ['¾×', 0.75], ['1×', 1], ['2×', 2], ['4×', 4]];
for (const [label, v] of speeds) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(v === 0.75));
  b.onclick = () => { if (player) player.speed = v; $('speed').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
  $('speed').append(b);
}
$('skip').onclick = () => player?.skipFight();
// sound: a mute toggle and a volume slider, remembered per browser
const soundBtn = $('sound') as HTMLButtonElement, vol = $('vol') as HTMLInputElement;
const syncSound = () => { soundBtn.setAttribute('aria-pressed', String(!sfx.muted)); soundBtn.textContent = sfx.muted ? 'Sound off' : 'Sound'; vol.value = String(Math.round(sfx.volume * 100)); };
soundBtn.onclick = () => { sfx.unlock(); sfx.setVolume(sfx.volume, !sfx.muted); syncSound(); };
vol.oninput = () => { sfx.unlock(); sfx.setVolume(+vol.value / 100, false); syncSound(); };
syncSound();
// soft interface clicks in town
document.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && !document.body.classList.contains('delving')) { sfx.unlock(); sfx.ui(/^Hire/.test(b.textContent ?? '') ? 'coin' : 'click'); } });
$('ledger').onclick = () => player?.skipAll();
$('cam').onclick = () => { if (!player) return; player.opts.camera = player.opts.camera === 'off' ? 'subtle' : 'off'; $('cam').setAttribute('aria-pressed', String(player.opts.camera !== 'off')); };
$('clarity').onclick = () => { if (!player) return; player.opts.clarity = !player.opts.clarity; $('clarity').setAttribute('aria-pressed', String(player.opts.clarity)); };

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (player && scene) { player.update(dt); scene.render(dt); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __game: unknown }).__game = { get state() { return state; }, get player() { return player; }, step: (dt: number) => { player?.update(dt); scene?.render(dt); } };
