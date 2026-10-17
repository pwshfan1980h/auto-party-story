// Generated sound (DESIGN §5a): crunchy, low and never shrill. Everything is synthesised with WebAudio,
// so there are no sample files. A master low-pass keeps highs soft, and a short dungeon reverb glues it.
import voicesJson from '../../data/voices.json';
import { scheduleCue, type CueKey } from './cues';

export type Voice = 'phys' | 'fire' | 'frost' | 'shadow' | 'holy' | 'storm' | 'poison';
export type Mood = 'shout' | 'pain' | 'cheer' | 'murmur';
interface VoiceDef { pitch: number; rate: number; grit: number; formant: number }
const VOICES = voicesJson as unknown as { races: Record<string, Record<'m' | 'f', VoiceDef>>; moods: Record<Mood, { pitch: number; rate: number; loud: number; fall: number }> };
/** Vowel formants (F1, F2), kept low: no squeaky highs. */
const VOWELS: [number, number][] = [[730, 1090], [530, 1840], [400, 2000], [570, 840], [440, 1020], [660, 1700]];
const CONSONANTS = [2200, 3000, 1600, 900, 0, 0];
const strHash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const VOL_KEY = 'aps-volume';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private noiseBuf!: AudioBuffer;
  private crunch!: WaveShaperNode;
  private last = new Map<string, number>();
  volume = 0.7;
  muted = false;
  private cueBus: GainNode | null = null;
  private cueTimer: ReturnType<typeof setTimeout> | undefined;
  private battleTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    try {
      const v = localStorage.getItem(VOL_KEY);
      if (v !== null) { const [vol, m] = v.split(':'); this.volume = Math.max(0, Math.min(1, +vol || 0)); this.muted = m === '1'; }
    } catch { /* storage blocked: defaults */ }
  }

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    try {this.unlockContext()}catch{this.ctx=null}
  }
  private unlockContext() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume().catch(()=>{}); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass'; soft.frequency.value = 4200; soft.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(soft).connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // a short stone-room reverb from generated noise
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.4), ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.32;
    this.wet.connect(verb).connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // the crunch: soft-clipping distortion for impacts
    this.crunch = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * 3.2) * 0.9; }
    this.crunch.curve = curve;
    this.crunch.connect(this.dry);
    this.applyVolume();
  }

  setVolume(v: number, muted = this.muted) {
    this.volume = Number.isFinite(v)?Math.max(0,Math.min(1,v)):0; this.muted = muted;
    this.applyVolume();
    if(muted)this.stopCue();
    try { localStorage.setItem(VOL_KEY, `${this.volume}:${muted ? 1 : 0}`); } catch { /* not saved */ }
    if(typeof window!=='undefined')window.dispatchEvent(new Event('aps-audio'));
  }

  private applyVolume() { if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.9, this.ctx.currentTime, 0.02); }

  stopCue() {
    if(this.cueTimer)clearTimeout(this.cueTimer);
    this.cueTimer=undefined;
    if(this.cueBus){this.cueBus.gain.value=0;this.cueBus.disconnect();this.cueBus=null;}
    if(this.ctx){this.dry.gain.setTargetAtTime(1,this.now,.04);this.wet.gain.setTargetAtTime(.32,this.now,.04)}
  }

  cue(kind:CueKey) {
    if(!this.ctx || this.muted)return;
    this.stopCue();
    const bus=this.ctx.createGain();bus.gain.value=1;bus.connect(this.master);this.cueBus=bus;
    this.dry.gain.setTargetAtTime(.25,this.now,.025);
    this.wet.gain.setTargetAtTime(.08,this.now,.025);
    const duration=scheduleCue(this.ctx,bus,kind,this.now+.015);
    this.cueTimer=setTimeout(()=>{if(this.cueBus===bus)this.stopCue()},(duration+.1)*1000);
  }

  stopBattleTimers() {
    for (const timer of this.battleTimers) clearTimeout(timer);
    this.battleTimers.clear();
  }

  private get now() { return this.ctx!.currentTime; }

  /** Rate-limit a sound so a horde doesn't stack fifty copies in one frame. */
  private gate(key: string, gap: number) {
    if (!this.ctx || this.muted) return false;
    const t = this.now, prev = this.last.get(key) ?? -1;
    if (t - prev < gap) return false;
    this.last.set(key, t);
    return true;
  }

  // ---------- building blocks ----------

  private out(pan: number, wet = 0.2, crunch = false): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Number.isFinite(pan)?Math.max(-0.85, Math.min(0.85, pan)):0;
    p.connect(crunch ? this.crunch : this.dry);
    if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; p.connect(s).connect(this.wet); }
    return p;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noise(dest: AudioNode, t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1 = f0, q = 0.8, attack = 0.004) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain(); this.env(g, t, peak, attack, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + attack + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, dur: number, peak: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.005, detune = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
    const g = ctx.createGain(); this.env(g, t, peak, attack, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // ---------- battle ----------

  /** A weapon or spell landing. Crits hit harder and lower. */
  impact(voice: Voice, pan: number, crit = false, big = false) {
    if (!this.gate(`hit${voice}`, 0.045)) return;
    const t = this.now, k = crit ? 1.5 : 1;
    const o = this.out(pan, 0.12, true);
    // the body of every hit: a low thump that drops in pitch
    this.tone(o, t, 0.12 * k, 0.5 * k, 'sine', 140 * (big ? 0.7 : 1), 48);
    switch (voice) {
      case 'phys': this.noise(o, t, 0.09 * k, 0.55 * k, 'bandpass', 900, 300, 1.2); if (crit) this.noise(o, t + 0.01, 0.16, 0.4, 'lowpass', 1400, 200); break;
      case 'fire': this.noise(o, t, 0.28 * k, 0.45, 'lowpass', 1800, 220, 0.7, 0.01); break;
      case 'frost': this.noise(o, t, 0.14, 0.4, 'bandpass', 1500, 700, 3); this.tone(o, t, 0.25, 0.12, 'triangle', 330, 290); break;
      case 'shadow': this.noise(o, t, 0.3, 0.35, 'lowpass', 600, 120, 1, 0.02); this.tone(o, t, 0.35, 0.18, 'sawtooth', 70, 55, 0.02, 12); break;
      case 'holy': this.tone(o, t, 0.4, 0.16, 'triangle', 262, 262, 0.01); this.tone(o, t, 0.4, 0.1, 'triangle', 392, 392, 0.01); this.noise(o, t, 0.1, 0.25, 'bandpass', 1200, 900, 1); break;
      case 'storm': for (let i = 0; i < 4; i++) this.noise(o, t + i * 0.035, 0.03, 0.35, 'bandpass', 2400, 1600, 2, 0.001); break;
      case 'poison': this.noise(o, t, 0.22, 0.35, 'bandpass', 500, 260, 4, 0.01); break;
    }
  }

  /** A blow stopped on a shield: a deep wooden thunk with a dull metal edge. Unmistakably not a hit. */
  block(pan: number) {
    if (!this.gate('block', 0.05)) return;
    const t = this.now, o = this.out(pan, 0.25, true);
    this.tone(o, t, 0.18, 0.7, 'sine', 95, 70, 0.002);
    this.noise(o, t, 0.12, 0.5, 'lowpass', 900, 250, 1, 0.002);
    this.tone(o, t, 0.35, 0.12, 'square', 165, 160, 0.002, -6);
    this.tone(o, t, 0.35, 0.1, 'square', 196, 190, 0.002, 7);
  }

  /** Steel meeting steel and sliding off: a short, low ring and a scrape. */
  parry(pan: number) {
    if (!this.gate('parry', 0.05)) return;
    const t = this.now, o = this.out(pan, 0.4);
    this.tone(o, t, 0.5, 0.14, 'triangle', 392, 386, 0.002);
    this.tone(o, t, 0.45, 0.1, 'triangle', 466, 458, 0.002);
    this.noise(o, t + 0.01, 0.18, 0.25, 'bandpass', 2400, 1400, 4, 0.004);
  }

  /** The air moving: a sword swing, a dash, a missed blow. */
  whoosh(pan: number, heavy = false) {
    if (!this.gate('whoosh', 0.06)) return;
    const t = this.now;
    this.noise(this.out(pan, 0.05), t, heavy ? 0.28 : 0.18, heavy ? 0.3 : 0.2, 'bandpass', heavy ? 500 : 700, heavy ? 1300 : 1600, 1.6, 0.06);
  }

  /** A bowstring or a thrown missile leaving. */
  launch(voice: Voice, pan: number) {
    if (!this.gate(`launch${voice}`, 0.05)) return;
    const t = this.now, o = this.out(pan, 0.1);
    if (voice === 'phys') { this.tone(o, t, 0.12, 0.25, 'triangle', 190, 150); this.noise(o, t, 0.12, 0.12, 'bandpass', 1400, 2200, 2, 0.01); }
    else this.cast(voice, pan, 0.6);
  }

  /** Magic gathering: each element has its own colour, all of it low. */
  cast(voice: Voice, pan: number, size = 1) {
    if (!this.gate(`cast${voice}`, 0.08)) return;
    const t = this.now, o = this.out(pan, 0.35);
    const d = 0.35 * size;
    switch (voice) {
      case 'fire': this.noise(o, t, d, 0.3 * size, 'lowpass', 300, 1600, 1, d * 0.6); break;
      case 'frost': this.noise(o, t, d, 0.2, 'bandpass', 1800, 2600, 6, d * 0.5); this.tone(o, t, d, 0.08, 'triangle', 294, 330, d * 0.5); break;
      case 'shadow': this.tone(o, t, d * 1.4, 0.2, 'sawtooth', 55, 82, d * 0.6, -15); this.tone(o, t, d * 1.4, 0.16, 'sawtooth', 55, 82, d * 0.6, 15); break;
      case 'holy': for (const f of [196, 247, 294]) this.tone(o, t, d * 1.6, 0.08, 'sine', f, f, d * 0.7); break;
      case 'storm': this.noise(o, t, d, 0.22, 'bandpass', 800, 2400, 3, d * 0.5); break;
      case 'poison': this.noise(o, t, d, 0.2, 'bandpass', 300, 700, 5, d * 0.5); break;
      default: this.noise(o, t, d, 0.15, 'bandpass', 400, 900, 2, d * 0.5);
    }
  }

  /** An area spell going off, a bomb, an ultimate landing: felt as much as heard. */
  explosion(pan: number, size = 1, voice: Voice = 'fire') {
    if (!this.gate('boom', 0.12)) return;
    const t = this.now, o = this.out(pan, 0.45, true);
    this.tone(o, t, 0.7 * size, 0.9, 'sine', 90, 28, 0.004);
    this.noise(o, t, 0.9 * size, 0.8, 'lowpass', 2400, 90, 0.7, 0.005);
    this.noise(o, t + 0.03, 0.45 * size, 0.35, 'bandpass', 700, 200, 1, 0.01);
    if (voice === 'storm') for (let i = 0; i < 6; i++) this.noise(o, t + 0.05 + i * 0.05, 0.03, 0.3, 'bandpass', 2600, 1500, 2, 0.001);
    if (voice === 'frost') this.noise(o, t + 0.04, 0.5, 0.25, 'bandpass', 2200, 1200, 5);
    if (voice === 'shadow') this.tone(o, t, 1.1, 0.25, 'sawtooth', 50, 32, 0.01, 20);
  }

  /** Healing: a warm, low chord swelling in. */
  heal(pan: number, revive = false) {
    if (!this.gate('heal', 0.15)) return;
    const t = this.now, o = this.out(pan, 0.5);
    const notes = revive ? [147, 196, 247, 294] : [196, 247];
    notes.forEach((f, i) => this.tone(o, t + i * 0.05, revive ? 1.1 : 0.6, 0.09, 'triangle', f, f, 0.08));
  }

  downed(pan: number) {
    if (!this.gate('downed', 0.1)) return;
    const t = this.now, o = this.out(pan, 0.25, true);
    this.tone(o, t, 0.3, 0.7, 'sine', 110, 40);
    this.noise(o, t, 0.25, 0.45, 'lowpass', 900, 120, 0.8);
    this.noise(o, t + 0.06, 0.4, 0.15, 'bandpass', 350, 220, 3, 0.05); // a groan of breath
  }

  /** A body falling apart: bone clatter for the dead that walk, a heavy crumble for the rest. */
  death(pan: number, bones = false) {
    if (!this.gate('death', 0.08)) return;
    const t = this.now, o = this.out(pan, 0.3, true);
    if (bones) for (let i = 0; i < 9; i++) { const dt = i * 0.035 + Math.random() * 0.03; this.tone(o, t + dt, 0.05, 0.2, 'square', 300 + Math.random() * 300, 200, 0.001); this.noise(o, t + dt, 0.04, 0.2, 'bandpass', 1800, 1200, 4, 0.001); }
    else { this.tone(o, t, 0.4, 0.6, 'sine', 95, 35); this.noise(o, t, 0.6, 0.5, 'lowpass', 1200, 80, 0.7); }
  }

  /** The ultimate: a rising swell, then the hit. */
  ult(pan: number, voice: Voice) {
    if (!this.gate('ult', 0.5)) return;
    const t = this.now, o = this.out(pan, 0.5);
    this.tone(o, t, 0.5, 0.25, 'sawtooth', 55, 110, 0.4, -8);
    this.tone(o, t, 0.5, 0.2, 'sawtooth', 55, 110, 0.4, 8);
    this.noise(o, t, 0.5, 0.2, 'bandpass', 300, 1500, 2, 0.4);
    const timer=setTimeout(()=>{this.battleTimers.delete(timer);this.explosion(pan,1.1,voice)},380);
    this.battleTimers.add(timer);
  }

  /** A warning: something big is about to land here. */
  rumble(pan: number) {
    if (!this.gate('rumble', 0.4)) return;
    this.noise(this.out(pan, 0.4), this.now, 0.8, 0.25, 'lowpass', 160, 90, 1, 0.3);
  }

  clang(pan: number) {
    if (!this.gate('clang', 0.1)) return;
    const t = this.now, o = this.out(pan, 0.35, true);
    this.tone(o, t, 0.3, 0.3, 'square', 220, 200, 0.002);
    this.tone(o, t, 0.3, 0.2, 'square', 233, 210, 0.002);
    this.noise(o, t, 0.06, 0.4, 'bandpass', 1600, 900, 2);
  }

  summon(pan: number) {
    if (!this.gate('summon', 0.3)) return;
    const t = this.now, o = this.out(pan, 0.5);
    this.tone(o, t, 0.9, 0.2, 'sawtooth', 41, 62, 0.5, -10);
    this.noise(o, t, 0.8, 0.2, 'lowpass', 200, 700, 1, 0.5);
  }

  /** The fight is over: a low horn for a win, a falling drone for a loss. */
  ending(won: boolean) {
    if (!this.gate('end', 1)) return;
    const t = this.now, o = this.out(0, 0.6);
    if (won) [98, 147, 196].forEach((f, i) => this.tone(o, t + i * 0.12, 1.4, 0.12, 'sawtooth', f, f, 0.15, i * 4));
    else { this.tone(o, t, 2.2, 0.2, 'sawtooth', 82, 41, 0.3, -10); this.tone(o, t, 2.2, 0.15, 'sawtooth', 82, 41, 0.3, 10); }
  }

  /** A burning tile: a few dry pops over a low roar. */
  crackle() {
    if (!this.gate('crackle', 0.8)) return;
    const t = this.now, o = this.out((Math.random() - 0.5) * 0.8, 0.3);
    for (let i = 0; i < 6; i++) this.noise(o, t + Math.random() * 0.6, 0.025, 0.1, 'bandpass', 1400 + Math.random() * 700, 900, 2, 0.001);
    this.noise(o, t, 0.9, 0.06, 'lowpass', 300, 200, 0.7, 0.2);
  }

  /** Acid eating into armour and skin: a wet hiss. */
  sizzle(pan: number) {
    if (!this.gate('sizzle', 0.3)) return;
    this.noise(this.out(pan, 0.15), this.now, 0.45, 0.16, 'bandpass', 2200, 1400, 3, 0.01);
  }

  /**
   * Gibberish speech: a buzz at the speaker's pitch shaped through vowel formants, syllable by
   * syllable, with breathy consonants. The same words from the same speaker always sound the same.
   */
  voice(race: string, sex: 'm' | 'f', text: string, mood: Mood, pan = 0) {
    if (!this.gate(`voice${race}${sex}`, 0.35)) return;
    const v = VOICES.races[race]?.[sex] ?? VOICES.races.human.m, md = VOICES.moods[mood];
    const ctx = this.ctx!, o = this.out(pan, 0.25, v.grit > 0.3);
    let h = strHash(`${race}${sex}${text}`);
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h / 4294967296; };
    const syllables = Math.max(2, Math.min(7, Math.round(text.length / 4)));
    const dur = 1 / (v.rate * md.rate);
    let t = this.now + 0.02;
    for (let i = 0; i < syllables; i++) {
      const k = i / Math.max(1, syllables - 1);
      // intonation: the line rises or falls across its length, with a little wobble per syllable
      const p0 = v.pitch * md.pitch * (1 + (md.fall - 1) * k) * (0.94 + rnd() * 0.12);
      const [f1, f2] = VOWELS[Math.floor(rnd() * VOWELS.length)];
      const cons = CONSONANTS[Math.floor(rnd() * CONSONANTS.length)];
      if (cons) this.noise(o, t, 0.035, 0.12 * md.loud, 'bandpass', cons * Math.min(1, v.formant), cons * 0.8, 3, 0.004);
      const src = ctx.createOscillator();
      src.type = 'sawtooth';
      src.frequency.setValueAtTime(p0, t + 0.03);
      src.frequency.linearRampToValueAtTime(p0 * (mood === 'pain' ? 0.8 : 0.97), t + 0.03 + dur);
      const g = ctx.createGain();
      this.env(g, t + 0.03, 0.22 * md.loud, 0.02, dur * 0.85);
      for (const [f, q, amp] of [[f1, 6, 1], [f2, 8, 0.6]] as const) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(2200, f * v.formant); bp.Q.value = q;
        const a = ctx.createGain(); a.gain.value = amp;
        src.connect(bp).connect(a).connect(g);
      }
      if (v.grit > 0.05) this.noise(g, t + 0.03, dur * 0.8, v.grit * 0.25, 'bandpass', f1 * v.formant, f1 * v.formant, 2, 0.01);
      g.connect(o);
      src.start(t + 0.03); src.stop(t + 0.05 + dur);
      t += dur * (0.9 + rnd() * 0.25);
    }
  }

  // ---------- ambience ----------

  private amb: { stop: () => void } | null = null;

  /**
   * A biome's bed of sound under the whole delve: the crypt is cold air and slow drips, the
   * caverns a wet hum with bubbling. Quiet, low, and never quite repeating. null stops it.
   */
  ambience(biome: string | null) {
    this.amb?.stop();
    this.amb = null;
    if (!biome || !this.ctx) return;
    const ctx = this.ctx, t0 = this.now;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.exponentialRampToValueAtTime(0.5, t0 + 3);
    bus.connect(this.master);
    // the air itself: looping noise through a slowly breathing low-pass
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = biome === 'fungal' ? 260 : 380; lp.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const depth = ctx.createGain(); depth.gain.value = biome === 'fungal' ? 90 : 160;
    lfo.connect(depth).connect(lp.frequency);
    const air = ctx.createGain(); air.gain.value = biome === 'fungal' ? 0.05 : 0.07;
    src.connect(lp).connect(air).connect(bus);
    // a low drone under it
    const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = biome === 'fungal' ? 49 : 41;
    const dg = ctx.createGain(); dg.gain.value = 0.035;
    drone.connect(dg).connect(bus);
    src.start(t0); lfo.start(t0); drone.start(t0);
    // now and then: a drip in the crypt, a bubble in the caverns
    const timer = setInterval(() => {
      if (this.muted || Math.random() < 0.4) return;
      const t = this.now, o = this.out((Math.random() - 0.5) * 1.4, 0.6);
      if (biome === 'fungal') this.tone(o, t, 0.12, 0.05, 'sine', 180 + Math.random() * 120, 320, 0.01);
      else { this.tone(o, t, 0.08, 0.06, 'sine', 420 + Math.random() * 160, 260, 0.002); }
    }, 1400);
    this.amb = {
      stop: () => {
        clearInterval(timer);
        const t = this.now;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setTargetAtTime(0.0001, t, 0.6);
        setTimeout(() => { src.stop(); lfo.stop(); drone.stop(); bus.disconnect(); }, 2500);
      },
    };
  }

  // ---------- the delve ----------

  /** The party walking between rooms: boots on stone, softly panned. */
  footsteps(count = 6, gap = 0.32) {
    if (!this.gate('steps', 0.2)) return;
    const t0 = this.now;
    for (let i = 0; i < count; i++) {
      const t = t0 + Math.max(0, i * gap + (Math.random() - 0.5) * 0.04);
      const o = this.out(i % 2 ? 0.15 : -0.15, 0.3);
      this.tone(o, t, 0.06, 0.25, 'sine', 120, 60, 0.002);
      this.noise(o, t, 0.07, 0.22, 'bandpass', 700, 300, 1.5, 0.002);
    }
  }

  /** The cue for what a room holds. */
  room(type: string) {
    if (!this.ctx || this.muted) return;
    const t = this.now, o = this.out(0, 0.5);
    switch (type) {
      case 'treasure': for (let i = 0; i < 5; i++) { const dt = i * 0.07 + Math.random() * 0.03; this.tone(o, t + dt, 0.18, 0.08, 'triangle', 523 + Math.random() * 120, 500, 0.002); } break;
      case 'campfire': for (let i = 0; i < 12; i++) this.noise(o, t + Math.random() * 1.2, 0.03, 0.12, 'bandpass', 1500 + Math.random() * 800, 900, 2, 0.001); this.noise(o, t, 1.4, 0.12, 'lowpass', 400, 300, 0.7, 0.3); break;
      case 'shrine': [147, 220, 294].forEach((f) => this.tone(o, t, 1.6, 0.07, 'sine', f, f, 0.4)); break;
      case 'stairs': this.footsteps(4, 0.42); this.noise(o, t + 1.2, 1.2, 0.15, 'lowpass', 300, 120, 0.7, 0.4); break;
      case 'boss': this.tone(o, t, 2.4, 0.22, 'sawtooth', 49, 46, 0.6, -6); this.tone(o, t, 2.4, 0.18, 'sawtooth', 73.5, 69, 0.6, 6); this.tone(o, t, 0.4, 0.6, 'sine', 70, 35, 0.004); break;
      case 'elite': case 'horde': for (let i = 0; i < 3; i++) { this.tone(o, t + i * 0.28, 0.25, 0.5, 'sine', 90, 45, 0.004); this.noise(o, t + i * 0.28, 0.1, 0.25, 'lowpass', 700, 200); } break;
      case 'fight': this.tone(o, t, 0.3, 0.45, 'sine', 85, 42, 0.004); this.noise(o, t, 0.12, 0.2, 'lowpass', 600, 200); break;
      case 'event': this.noise(o, t, 1.2, 0.12, 'bandpass', 400, 900, 6, 0.5); break;
      default: break;
    }
  }

  /** Small interface sounds: soft wooden clicks, a coin for spending. */
  ui(kind: 'click' | 'coin' | 'delve') {
    if (!this.gate(`ui${kind}`, 0.05)) return;
    const t = this.now, o = this.out(0, kind === 'delve' ? 0.5 : 0.05);
    if (kind === 'click') { this.tone(o, t, 0.05, 0.12, 'triangle', 260, 180, 0.001); }
    else if (kind === 'coin') { this.tone(o, t, 0.2, 0.08, 'triangle', 494, 494, 0.002); this.tone(o, t + 0.07, 0.25, 0.07, 'triangle', 587, 587, 0.002); }
    else { this.noise(o, t, 0.9, 0.3, 'lowpass', 300, 1400, 0.8, 0.4); this.tone(o, t, 1.2, 0.2, 'sine', 65, 49, 0.2); }
  }
}

export const sfx = new Sfx();
