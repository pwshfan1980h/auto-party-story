import config from '../../data/company.json';
import { ITEMS } from '../sim/data';
import { canEquip } from '../sim/items';
import { stream } from '../sim/rng';
import type { GameState } from './state';
import { saveGame } from './state';
import type { RunResult } from '../sim/run';

export const COMPANY=config;
export function isUsefulGear(state:GameState,id:string):boolean {
  const it=ITEMS[id];if(!it)return false;
  const demand=state.roster.filter(h=>{
    if(!canEquip(h.hero.classId,id))return false;
    const worn=(h.hero.items??[]).find(i=>ITEMS[i].slot===it.slot);
    if(!worn)return true;
    if(worn===id)return false;
    return Object.entries(it.add).some(([key,v])=>(v??0)>((ITEMS[worn].add as Record<string,number>)[key]??0));
  }).length;
  return demand>(state.stash??[]).filter(x=>x===id).length;
}
export function rewardOptions(state:GameState,tier:string,run:number):string[] {
  const n=['I','II','III'].indexOf(tier)+1;
  const pool=Object.keys(ITEMS).filter(id=>ITEMS[id].tier===n && state.roster.some(h=>canEquip(h.hero.classId,id)));
  const universal=Object.keys(ITEMS).filter(id=>ITEMS[id].tier===n && ITEMS[id].slot==='trinket');
  const rng=stream(state.seed,'clear-reward',tier,run);
  const shuffled=[...(pool.length?pool:universal)].map(id=>({id,roll:rng.next(),useful:isUsefulGear(state,id)})).sort((a,b)=>+b.useful-+a.useful || a.roll-b.roll);
  return shuffled.slice(0,COMPANY.rewards.choices).map(x=>x.id);
}
export function awardClear(state:GameState,result:RunResult,runId:string): {firstClear:boolean;firstFinalClear:boolean;legacyFinal?:boolean;rewardId?:string} {
  if(result.outcome!=='cleared')return{firstClear:false,firstFinalClear:false};
  const tier=result.tier,firstClear=state.milestones[tier]===undefined;
  if(firstClear){
    state.milestones[tier]=state.runs+1;
    const options=rewardOptions(state,tier,state.runs);
    state.rewards??=[];state.rewards.push({id:runId,run:state.runs+1,tier,options});state.bossDryStreak[tier]=0;
    const legacyFinal=tier==='III'&&state.legacyCompletion; if(tier==='III')delete state.legacyCompletion;
    return{firstClear:true,firstFinalClear:tier==='III',...(legacyFinal?{legacyFinal:true}:{}),rewardId:runId};
  }
  const useful=result.found.some(id=>isUsefulGear(state,id));
  state.bossDryStreak[tier]=useful?0:(state.bossDryStreak[tier]??0)+1;
  if(state.bossDryStreak[tier]>=COMPANY.rewards.dryClearLimit){
    const id=rewardOptions(state,tier,state.runs).find(id=>isUsefulGear(state,id));
    const boss=result.ledger.slice().reverse().find(e=>e.room==='boss');
    if(id){result.found.push(id);boss?.gained.push(`boss cache: ${ITEMS[id].name}`)}
    else {const coin=COMPANY.rewards.firstClearCoin[['I','II','III'].indexOf(tier)];result.banked+=coin;boss?.gained.push(`boss service fund: ${coin} coin (available equipment already covered)`)}
    state.bossDryStreak[tier]=0;
  }
  return{firstClear:false,firstFinalClear:false};
}
export function claimReward(state:GameState,rewardId:string,itemId:string):string|null {
  const reward=state.rewards?.find(r=>r.id===rewardId);
  if(!reward || reward.claimed)return'That reward has already been claimed or is unavailable.';
  if(itemId==='coin')state.coin+=COMPANY.rewards.firstClearCoin[['I','II','III'].indexOf(reward.tier)];
  else if(reward.options.includes(itemId))state.stash=[...(state.stash??[]),itemId];
  else return'That is not one of the reward choices.';
  reward.claimed=itemId;saveGame(state);return null;
}
