import { preferences,updatePreferences,type Preferences } from '../game/preferences';
import { sfx } from '../audio/sfx';
import { el } from './dom';
export function mountSettings(){
  const checks=new Map<keyof Preferences,HTMLInputElement>();
  const options:[keyof Preferences,string][]=[['camera','Battle camera'],['clarity','Clarity: show damage numbers'],['reducedMotion','Reduce motion'],['shake','Screen shake']];
  const controls=options.map(([key,label])=>{const input=el('input',{type:'checkbox',checked:!!preferences[key],onchange:()=>updatePreferences({[key]:input.checked})});checks.set(key,input);return el('label',{},input,' '+label)});
  const speed=el('select',{'aria-label':'Default battle speed',onchange:()=>updatePreferences({speed:+speed.value})},...[.5,.75,1,2,4].map(v=>el('option',{value:v,selected:preferences.speed===v},`${v}×`)));
  const sound=el('input',{type:'checkbox',checked:!sfx.muted,onchange:()=>{sfx.unlock();sfx.setVolume(sfx.volume,!sound.checked)}});
  const volume=el('input',{type:'range',min:0,max:100,value:Math.round(sfx.volume*100),'aria-label':'Sound volume',oninput:()=>{sfx.unlock();sfx.setVolume(+volume.value/100,sfx.muted)}});
  const panel=el('details',{class:'global-settings'},el('summary',{},'Settings & help'),el('div',{class:'settings-grid'},...controls,el('label',{},'Battle speed ',speed),
    el('label',{},sound,' Sound enabled'),el('label',{},'Volume ',volume),
    el('button',{type:'button',onclick:()=>{sfx.unlock();sfx.cue('home')}},'Preview return sound'),el('button',{type:'button',onclick:()=>sfx.stopCue()},'Stop preview')),
    el('p',{},'Hire and prepare a company, choose a Leader, then Delve. The Leader makes route decisions; spend embers on timely orders. Surviving with loot is a successful return.'),
    el('p',{},'The fallen stay fallen. Closing a running delve lets the Leader finish it on your next visit. Export your save to move progress to another browser or hostname.'));
  document.body.append(panel);
  window.addEventListener('aps-preferences',()=>{for(const [key,input]of checks)input.checked=!!preferences[key];speed.value=String(preferences.speed)});
  window.addEventListener('aps-audio',()=>{sound.checked=!sfx.muted;volume.value=String(Math.round(sfx.volume*100))});
}
