import { BASE_CLASSES,campEffect,candidate,refreshBoard,saveGame,TIER_IDS,type GameState } from './state';
import { ITEMS,PROGRESSION,TIERS } from '../sim/data';
import { COMPANY } from './rewards';
import { autoAttrs,heroStats } from '../sim/stats';

export function commissionLevel(state:GameState){const band=TIERS[TIER_IDS[state.unlocked]].heroLevel;return Math.min(PROGRESSION.maxLevel,Math.max(band-2+campEffect(state,'recruitLevel'),1,...state.roster.map(h=>h.hero.level-2)))}
export function commissionCost(state:GameState){return COMPANY.economy.commissionBase+COMPANY.economy.commissionPerLevel*(commissionLevel(state)-1)}
export function commission(state:GameState,classId:string):string|null {
  if(state.pending)return'The company is still on an expedition.';
  if(!BASE_CLASSES.includes(classId))return'Choose a base class to recruit.';
  const cost=commissionCost(state);if(state.coin<cost)return`A commission costs ${cost} coin.`;
  state.coin-=cost;state.roster.push(candidate(state,commissionLevel(state),classId));saveGame(state);return null;
}
export function serviceCost(state:GameState,id:string){const count=state.refinements?.[id]??0;return COMPANY.economy.serviceBase+COMPANY.economy.servicePerLevel*count*(count+1)}
export function servicePreview(state:GameState,id:string,tier:string){
  const h=state.roster.find(h=>h.hero.id===id)?.hero;if(!h||!TIERS[tier])return'';
  const n=state.refinements?.[id]??0;if(n>=COMPANY.economy.serviceCap)return'Fully serviced.';
  const stats=(count:number)=>heroStats(h.classId,h.raceId,h.level,h.attrs??autoAttrs(h.classId,h.level),TIERS[tier].gearScore+count*COMPANY.economy.serviceGearStep,h.items);
  const before=stats(n),after=stats(n+1);
  return ([['maxHp','HP'],['power','power'],['spell','spell'],['armor','armour']] as const).filter(([key])=>after[key]>before[key]).map(([key,label])=>`${label} ${Math.round(before[key]*10)/10} → ${Math.round(after[key]*10)/10}`).join(' · ');
}
export function serviceGear(state:GameState,id:string):string|null {
  if(state.pending)return'The company is still on an expedition.';
  if(!state.roster.some(h=>h.hero.id===id))return'That hero is no longer at the Inn.';
  const count=state.refinements?.[id]??0,cost=serviceCost(state,id);
  if(count>=COMPANY.economy.serviceCap)return'This hero’s equipment service is complete.';
  if(state.coin<cost)return`The equipment service costs ${cost} coin.`;
  state.coin-=cost;state.refinements={...state.refinements,[id]:count+1};saveGame(state);return null;
}
export function salvageValue(id:string){return (ITEMS[id]?.tier??0)*COMPANY.economy.salvagePerTier}
export function salvage(state:GameState,id:string):string|null {
  if(state.pending)return'The company is still on an expedition.';
  if(!ITEMS[id] || (state.stash??[]).filter(x=>x===id).length<2)return'Only spare duplicates in the stores can be salvaged.';
  if(state.favorites?.includes(id))return'That item is protected.';
  const at=state.stash!.indexOf(id);state.stash!.splice(at,1);state.coin+=salvageValue(id);saveGame(state);return null;
}
export function protectItem(state:GameState,id:string){if(!ITEMS[id])return;const current=state.favorites??[];state.favorites=current.includes(id)?current.filter(x=>x!==id):[...current,id];saveGame(state)}
export function refreshCost(state:GameState){return COMPANY.economy.boardRefreshBase*(state.unlocked+1)}
export function rerollBoard(state:GameState):string|null {
  if(state.pending)return'The company is still on an expedition.';
  const cost=refreshCost(state);if(state.coin<cost)return`A fresh hire board costs ${cost} coin.`;
  state.coin-=cost;refreshBoard(state);saveGame(state);return null;
}
