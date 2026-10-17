import { decodeSave, MAX_SAVE_BYTES, SAVE_KEY, saves, type SaveNotice } from '../game/persistence';
import type { GameState } from '../game/state';
import { clear, el } from './dom';
import { sfx } from '../audio/sfx';

export function downloadSave(raw: string, name = 'auto-party-story-save.json') {
  const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
  const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function mountSaveTools(getState: () => GameState | undefined) {
  const status=el('span',{'aria-live':'polite'},'Checking saved progress…');
  const notice=el('aside',{class:'save-warning',hidden:true,'aria-label':'Save status'});
  const exportButton=el('button',{type:'button',onclick:()=>downloadSave(getState()?saves.export(getState()!):saves.raw())},'Export save');
  const input=el('input',{type:'file',accept:'.json,application/json',hidden:true,'aria-label':'Choose a saved company'});
  const importButton=el('button',{type:'button',onclick:()=>input.click()},'Import save');
  const bar=el('div',{class:'save-tools'},status,el('div',{},exportButton,importButton,input));
  document.body.prepend(bar,notice);
  const display=(n: SaveNotice) => {
    const state=getState();
    status.textContent=n.status==='saved'?'✓ Progress saved':n.status==='conflict'?'Saved company changed':"Progress isn't saved";
    status.className=n.status==='saved'?'gain':'warn';
    importButton.disabled=!!state?.pending;
    const conflict=n.status==='conflict';
    document.querySelector<HTMLElement>('#app')!.inert=conflict;
    document.querySelector<HTMLElement>('#stage')!.inert=conflict;
    clear(notice);notice.hidden=n.status==='saved';
    if(!notice.hidden)notice.append(el('strong',{},n.message),el('div',{},
      conflict?el('button',{type:'button',onclick:()=>location.reload()},'Reload newer company'):
        state?el('button',{type:'button',onclick:()=>{sfx.unlock();sfx.cue(saves.write(state)?'saved':'warning')}},'Retry save'):null,
      el('button',{type:'button',onclick:()=>downloadSave(getState()?saves.export(getState()!):saves.raw())},'Download a backup')));
  };
  input.onchange=async()=>{
    const file=input.files?.[0];input.value='';if(!file)return;
    if(file.size>MAX_SAVE_BYTES){alert('This save is larger than the supported 2 MiB. Your company was not changed.');return;}
    let raw: string;try{raw=await file.text()}catch{alert('The file could not be read. Your company was not changed.');return;}
    if(getState()?.pending){alert('Finish this expedition before importing a company.');return;}
    const loaded=decodeSave(raw);
    if(!loaded.state){alert(loaded.message??'This save is not supported. Your company was not changed.');return;}
    if(!confirm(`Replace this company with the imported save (${loaded.state.runs} delves, ${loaded.state.coin} coin)? A backup of your current save will be kept.`))return;
    const replaced=saves.replace(raw);if(replaced.state)location.reload();else alert(replaced.message??'The save could not be imported.');
  };
  window.addEventListener('aps-save',e=>display((e as CustomEvent<SaveNotice>).detail));
  window.addEventListener('storage',e=>{
    if((e.key===SAVE_KEY || e.key===null) && getState() && !saves.isCurrent(getState()!))display({status:'conflict',message:'Another tab changed this company. Export this session before reloading; older tabs cannot overwrite newer progress.'});
  });
  return {display};
}

export function renderSaveRecovery(root: HTMLElement, message: string) {
  const backup=saves.backup();
  clear(root).append(el('main',{class:'panel recovery'},el('h1',{},'Your company needs a little care.'),el('p',{},message),
    el('p',{},'The original save has not been overwritten. Export it before replacing it. You can also import a valid save using the controls above.'),
    el('button',{type:'button',onclick:()=>downloadSave(saves.raw(),'auto-party-story-original.json')},'Download original save'),
    backup.state?el('button',{type:'button',onclick:()=>{if(confirm('Restore the last valid backup? The original will be kept separately.')){const result=saves.replace(saves.export(backup.state!));if(result.state)location.reload();else alert(result.message??'The backup could not be restored.')}}},'Restore last valid backup'):null,
    el('button',{type:'button',onclick:()=>{if(confirm('Start a new company? The original save will be backed up before it is removed.') && saves.clear())location.reload()}},'Start a new company')));
}
