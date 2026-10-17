// Original synthesized cues; no external samples.
export type CueKey='home'|'tier'|'final'|'gear'|'level'|'waystone'|'memorial'|'warning'|'orderOk'|'orderNo'|'build'|'saved';
interface Note {at:number;hz:number;length:number;gain:number;wave:OscillatorType}
interface Cue {label:string;duration:number;about:string;notes:Note[];wood?:boolean}
  const note = (at:number, hz:number, length:number, gain = .12, wave:OscillatorType = 'triangle') => ({at, hz, length, gain, wave});
  export const cues: Record<CueKey,Cue> = {
    home: {label:'Homecoming', duration:1.5, about:'A warm, restrained return; survival is a success.', notes:[note(0,146.83,.65),note(.18,220,.65),note(.36,293.66,.9),note(.36,146.83,.9,.07)]},
    tier: {label:'Tier first clear', duration:2.1, about:'A low horn opening into a small major chord.', notes:[note(0,146.83,.9,.09,'sawtooth'),note(.22,220,.8),note(.44,293.66,1.2),note(.66,369.99,1.1,.09),note(.66,440,1.1,.07)]},
    final: {label:'Final first clear', duration:3.6, about:'The return motif, resolved and broadened for the final milestone.', notes:[note(0,146.83,1.3,.08,'sawtooth'),note(.3,220,1),note(.6,293.66,1.2),note(.9,369.99,1.1),note(1.25,440,1.5,.09),note(1.6,293.66,1.65,.10),note(1.6,369.99,1.65,.07),note(1.6,440,1.65,.06),note(1.6,146.83,1.65,.07)]},
    gear: {label:'Useful gear found', duration:.8, about:'A short bronze pluck; one cue for a group of finds.', notes:[note(0,293.66,.35,.10),note(.09,440,.42,.07),note(.18,587.33,.42,.04)]},
    level: {label:'Hero level gained', duration:1.1, about:'A soft three-step rise; keeps attention on the hero.', notes:[note(0,220,.35,.08),note(.14,277.18,.4,.08),note(.3,329.63,.6,.1)]},
    waystone: {label:'Waystone / new route', duration:1.5, about:'An airy, low bell that opens rather than startles.', notes:[note(0,196,1.1,.1,'sine'),note(.12,293.66,1.1,.07,'sine'),note(.24,392,1.1,.04,'sine')]},
    memorial: {label:'The fallen remembered', duration:2.7, about:'A quiet minor descent; no success chime on a wipe.', notes:[note(0,146.83,1.5,.06,'sine'),note(.35,174.61,1.3,.055,'triangle'),note(.75,130.81,1.55,.065,'sine')]},
    warning: {label:'Attention / save problem', duration:.65, about:'Two dull wooden taps; pair with persistent explanatory text.', notes:[note(0,164.81,.12,.07),note(.22,146.83,.15,.07)], wood:true},
    orderOk: {label:'Order accepted', duration:.28, about:'A tiny upward confirmation; feedback still names the effect.', notes:[note(0,220,.1,.06),note(.06,293.66,.12,.05)]},
    orderNo: {label:'Order unavailable', duration:.32, about:'A low closed tap; clear without a harsh error buzzer.', notes:[note(0,110,.17,.05)], wood:true},
    build: {label:'Town investment', duration:1.2, about:'Wood settles, then a warm chord: a visible improvement purchased.', notes:[note(0,110,.18,.08),note(.2,146.83,.7,.07),note(.2,220,.7,.06),note(.32,293.66,.6,.05)], wood:true},
    saved: {label:'Save confirmed', duration:.28, about:'An optional soft stamp; never spam this for every mutation.', notes:[note(0,174.61,.12,.04)], wood:true},
  };
  export function scheduleCue(ctx:BaseAudioContext, destination:AudioNode, key:CueKey, when = ctx.currentTime) {
    const cue = cues[key]; if (!cue) throw new Error('Unknown cue: '+key);
    const master = ctx.createGain(); master.gain.value = .68;
    const low = ctx.createBiquadFilter(); low.type='lowpass';low.frequency.value=2400;low.Q.value=.4;
    master.connect(low).connect(destination);
    for(const n of cue.notes) {
      const start=when+n.at, oscillator=ctx.createOscillator(), envelope=ctx.createGain();
      oscillator.type=n.wave;oscillator.frequency.value=n.hz;
      envelope.gain.setValueAtTime(.0001,start);
      envelope.gain.exponentialRampToValueAtTime(n.gain,start+.025);
      envelope.gain.exponentialRampToValueAtTime(.0001,start+n.length);
      oscillator.connect(envelope).connect(master);oscillator.start(start);oscillator.stop(start+n.length+.03);
    }
    if(cue.wood) {
      const length=Math.round(ctx.sampleRate*.09),buffer=ctx.createBuffer(1,length,ctx.sampleRate),samples=buffer.getChannelData(0);
      let seed=1979;for(let i=0;i<length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;samples[i]=((seed>>>0)/4294967296*2-1)*Math.exp(-i/length*8);}
      const source=ctx.createBufferSource();source.buffer=buffer;
      const filter=ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=550;filter.Q.value=.8;
      const gain=ctx.createGain();gain.gain.value=.14;source.connect(filter).connect(gain).connect(master);source.start(when);
    }
    return cue.duration;
  }
