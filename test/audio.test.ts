import {expect,it,vi} from 'vitest';
import {Sfx} from '../src/audio/sfx';

it('starts footsteps safely when a newly unlocked audio clock is still at zero',()=>{
  const scheduled:number[]=[];
  const at=(time:number)=>{if(time<0)throw new RangeError('Audio scheduling time must be non-negative');scheduled.push(time)};
  const parameter=()=>({value:0,setValueAtTime:(_value:number,time:number)=>at(time),exponentialRampToValueAtTime:(_value:number,time:number)=>at(time)});
  const node=()=>({gain:parameter(),frequency:parameter(),detune:parameter(),Q:parameter(),pan:parameter(),playbackRate:parameter(),connect:(target:unknown)=>target,start:at,stop:at});
  const audio=new Sfx();
  Object.assign(audio,{ctx:{currentTime:0,createStereoPanner:node,createGain:node,createOscillator:node,createBufferSource:node,createBiquadFilter:node},dry:node(),wet:node(),crunch:node(),noiseBuf:{}});
  const random=vi.spyOn(Math,'random').mockReturnValue(0);
  try{
    expect(()=>audio.footsteps(3)).not.toThrow();
    expect(scheduled.length).toBeGreaterThan(0);
    expect(Math.min(...scheduled)).toBe(0);
    expect(scheduled.some(time=>time>.3)).toBe(true);
  }finally{random.mockRestore()}
});
