// M1: the isometric battle viewer. Runs a seeded sim fight and replays its event log in voxels.
import { buildEncounter } from './sim/encounter';
import { TIERS } from './sim/data';
import { party, PRESETS } from './sim/presets';
import { stream } from './sim/rng';
import type { RoomType } from './sim/types';
import { BattleReplay, type BattleOptions } from './render/battleView';
import { BattleScene } from './render/scene';
import { sfx } from './audio/sfx';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scene = new BattleScene($('c'));
const overlay = $('ov');
const opts: BattleOptions = { camera: 'subtle', clarity: false, torchFuel: 7, audio: sfx };
// browsers start audio only after a gesture
document.addEventListener('pointerdown', () => sfx.unlock(), { once: false });
let speed = 0.75;
let seed = Number(new URLSearchParams(location.search).get('seed') ?? 4021);
let replay: BattleReplay | null = null;
let endedAt = -1;

function start() {
  replay?.dispose();
  const tier = ($('tier') as HTMLSelectElement).value;
  const room = ($('room') as HTMLSelectElement).value as RoomType;
  const heroes = party(PRESETS.starter, tier);
  const monsters = buildEncounter(tier, room, TIERS[tier].floors[0] + 1, stream(seed, 'viewer', tier, room));
  replay = new BattleReplay(scene, { seed, key: ['viewer', tier, room], tier, roomType: room, heroes, monsters, leader: { heroId: heroes[0].id, rank: 'seasoned', noise: 0.15, temperament: 'stubborn' } }, overlay, opts);
  endedAt = -1;
  $('status').textContent = `Seed ${seed} · ${heroes.length} heroes vs ${monsters.length} · sim says: ${replay.result.result} in ${replay.result.duration} s`;
}

const speeds: [string, number][] = [['½×', 0.5], ['¾×', 0.75], ['1×', 1], ['2×', 2], ['4×', 4]];
for (const [label, v] of speeds) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(v === speed));
  b.onclick = () => { speed = v; $('speed').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
  $('speed').append(b);
}
$('next').onclick = () => { seed = Math.floor(Math.random() * 100000); start(); };
$('tier').onchange = start;
$('room').onchange = start;
$('cam').onclick = () => { opts.camera = opts.camera === 'off' ? 'subtle' : 'off'; $('cam').setAttribute('aria-pressed', String(opts.camera !== 'off')); };
$('clarity').onclick = () => { opts.clarity = !opts.clarity; $('clarity').setAttribute('aria-pressed', String(opts.clarity)); };

start();
let last = performance.now();
scene.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (replay) {
    replay.update(dt, speed);
    if (replay.done && endedAt < 0) endedAt = now;
    if (endedAt > 0 && now - endedAt > 3500) { seed++; start(); }
  }
  scene.render(dt);
});
(window as unknown as { __viewer: unknown }).__viewer = { get replay() { return replay; }, scene };
