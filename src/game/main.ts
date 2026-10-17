// Auto Party Story, M2: Torchwatch → delve → Delve Ledger → Torchwatch, saved in the browser.
import { sfx } from '../audio/sfx';
import '../ui/release.css';
import { rollLook } from '../art/humanoid';
import { BattleScene } from '../render/scene';
import { TIERS } from '../sim/data';
import { DelvePlayer } from '../ui/delvePlay';
import { renderRunRecap } from '../ui/runRecap';
import { ScoutLens } from '../ui/lens';
import { Town } from '../ui/town';
import { mountSaveTools, renderSaveRecovery } from '../ui/saveTools';
import { saves } from './persistence';
import { mountSettings } from '../ui/settings';
import { preferences,updatePreferences } from './preferences';
import { COMPANY } from './rewards';
import { el } from '../ui/dom';
import { beginDelve, finishPending, settleDelve, type DelveOutcome, type DelvePlan } from './expedition';
import { eraseGame, newGame, saveGame, type GameState } from './state';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
let state: GameState;
let scene: BattleScene | null = null;
let player: DelvePlayer | null = null;
let closingPlayer:DelvePlayer|null=null;
const lens = new ScoutLens($('c'), $('ov'), () => player?.replay ?? null);

let town: Town;
const saveTools=mountSaveTools(()=>state);
mountSettings();
const loaded=saves.read();
if(loaded.kind==='damaged' || loaded.kind==='future') {
  renderSaveRecovery(app,loaded.message!);
  saveTools.display({status:'unsaved',message:loaded.message!});
} else {
  state=loaded.state??newGame();
  const finishedWithoutYou=finishPending(state);
  if(!loaded.state || loaded.kind==='migrated')saveGame(state);
  town=new Town(app,state,{onDelve:startDelve,onReview:()=>{if(state.lastReceipt)renderRunRecap(app,state,state.lastReceipt,()=>town.setState(state))},onAbandon:()=>{if(!eraseGame())return;state=newGame();saveGame(state);town.setState(state)}});
  town.render();
  if(finishedWithoutYou)renderRunRecap(app,state,finishedWithoutYou.receipt,()=>town.setState(state),{away:true});
  saveTools.display(loaded.kind==='valid' && !finishedWithoutYou?{status:'saved',message:'Progress saved'}:saves.notice);
}

function startDelve(plan: DelvePlan) {
  // A renderer failure must leave town and the saved expedition untouched.
  try { scene??=new BattleScene($('c')); }
  catch { alert('The battle renderer could not start. Check that WebGL/hardware acceleration is available, then try again. Your expedition has not begun.');return; }
  sfx.unlock();
  sfx.ui('delve');
  sfx.ambience(TIERS[plan.tier].biome);
  // the save remembers the delve is under way before the first step: Hardcore
  const steps = beginDelve(state, plan);
  const runId=state.pending!.id;
  const names = Object.fromEntries(state.roster.map((h) => [h.hero.id, h.hero.name]));
  const voices = Object.fromEntries(state.roster.map((h) => [h.hero.id, { race: h.hero.raceId, sex: rollLook(h.hero.raceId, h.hero.id).sex }]));
  document.body.classList.add('delving');
  player = new DelvePlayer(scene, $('ov'), $('hud'), $('orders'), steps, { names, voices }, (result) => showLedger(settleDelve(state, plan, result, runId)));
  syncPreferences();
  player.start();
  window.scrollTo(0, 0);
}

function showLedger(out: DelveOutcome) {
  sfx.ambience(null);
  const oldPlayer=player;closingPlayer=oldPlayer;player=null;
  let shown=false;
  const show=()=>{if(shown)return;shown=true;oldPlayer?.dispose();closingPlayer=null;document.body.classList.remove('delving');renderRunRecap(app,state,out.receipt,()=>town.setState(state),{fresh:true});window.scrollTo(0,0)};
  const delay=preferences.reducedMotion?0:out.receipt.firstFinalClear?COMPANY.presentation.finalHoldMs:out.result.outcome==='cleared'?COMPANY.presentation.clearHoldMs:0;
  if(delay){$('orders').replaceChildren(el('button',{type:'button',class:'go',onclick:show},'Show results'));setTimeout(show,delay)}else show();
}

// delve controls
const speeds: [string, number][] = [['½×', 0.5], ['¾×', 0.75], ['1×', 1], ['2×', 2], ['4×', 4]];
for (const [label, v] of speeds) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(v === preferences.speed));
  b.onclick = () => updatePreferences({speed:v});
  $('speed').append(b);
}
$('skip').onclick = () => player?.skipFight();
// sound: a mute toggle and a volume slider, remembered per browser
const soundBtn = $('sound') as HTMLButtonElement, vol = $('vol') as HTMLInputElement;
const syncSound = () => { soundBtn.setAttribute('aria-pressed', String(!sfx.muted)); soundBtn.textContent = sfx.muted ? 'Sound off' : 'Sound'; vol.value = String(Math.round(sfx.volume * 100)); };
soundBtn.onclick = () => { sfx.unlock(); sfx.setVolume(sfx.volume, !sfx.muted); syncSound(); };
vol.oninput = () => { sfx.unlock(); sfx.setVolume(+vol.value / 100, false); syncSound(); };
syncSound();
window.addEventListener('aps-audio',syncSound);
// soft interface clicks in town
document.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && !document.body.classList.contains('delving')) { sfx.unlock(); sfx.ui(/^Hire/.test(b.textContent ?? '') ? 'coin' : 'click'); } });

$('cam').onclick=()=>updatePreferences({camera:!preferences.camera});
$('clarity').onclick=()=>updatePreferences({clarity:!preferences.clarity});
function syncPreferences(){
  const camera=preferences.camera&&!preferences.reducedMotion;
  if(player){player.speed=preferences.speed;player.opts.camera=camera?'subtle':'off';player.opts.clarity=preferences.clarity}
  if(scene)scene.allowShake=preferences.shake&&!preferences.reducedMotion;
  document.body.classList.toggle('reduced-motion',preferences.reducedMotion);
  $('speed').querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(speeds[i][1]===preferences.speed)));
  $('cam').setAttribute('aria-pressed',String(camera));($('cam') as HTMLButtonElement).disabled=preferences.reducedMotion;
  $('clarity').setAttribute('aria-pressed',String(preferences.clarity));
}
window.addEventListener('aps-preferences',syncPreferences);syncPreferences();

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (scene && document.body.classList.contains('delving')) { if(player)player.update(dt);else closingPlayer?.presentEnding(dt);lens.update();scene.render(dt); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __game: unknown }).__game = { get state() { return state; }, get player() { return player; }, step: (dt: number) => { player?.update(dt); scene?.render(dt); } };
