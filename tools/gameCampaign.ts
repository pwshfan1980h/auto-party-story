import { build, CAMP, equip, hireCost, newGame, promote, promotions, TIER_IDS } from '../src/game/state';
import { delve, hire, partySizeFor, planProblem, rest } from '../src/game/expedition';
import { ITEMS, TIERS } from '../src/sim/data';
import { canEquip } from '../src/sim/items';
import { saves } from '../src/game/persistence';
import {claimReward,COMPANY,isUsefulGear}from'../src/game/rewards';
import {commission,commissionCost,salvage,serviceCost,serviceGear}from'../src/game/economy';
import {balancedParty,neededRecruit,providesSustain,readiness,recommendedTier,recommendedWaystone}from'../src/game/preparation';
export {balancedParty}from'../src/game/preparation';
import {isDeepStrictEqual}from'node:util';
import type { RosterHero } from '../src/sim/roster';

export type CompanyPolicy='simple'|'prepared'|'risky';
export interface CompanyRun {run:number;tier:string;outcome:string;party:number;coin:number;earned:number;spent:number;gear:number;died:number;unlocked:number;level:number;floor:number;firstFinalClear:boolean;rooms:number;fights:number;seconds:number;usefulGear:number;volunteers:number;waystone:number;readiness:string[];reason:string;spending:Record<string,number>}

/** Drives the shipped paid actions; unlike the abstract simulator, recruits are not free. */
export function runGameCampaign(seed:number,maxRuns=60,policy:CompanyPolicy='prepared') {
  const memory=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
  let state=newGame(seed);const rows:CompanyRun[]=[];const errors:string[]=[];let spent=0,income=40,stall=0,longestStall=0,firstFinalClear:number|undefined;
  const actions:Record<string,number>={},costs:Record<string,number>={};const recoveries:number[]=[];let recoveryStart:number|undefined;
  const itemCount=()=> (state.stash?.length??0)+state.roster.reduce((n,h)=>n+(h.hero.items?.length??0),0);
  const act=(name:string,fn:()=>string|null)=>{const before=state.coin,error=fn();if(error){errors.push(`${name}: ${error}`);return false}if(before>state.coin){spent+=before-state.coin;costs[name]=(costs[name]??0)+before-state.coin}else income+=state.coin-before;actions[name]=(actions[name]??0)+1;return true};
  saves.write(state);
  for(let i=0;i<maxRuns;i++){
    const priority=['cleric','fighter'];
    const board=[...state.hireBoard].sort((a,b)=>{
      const need=(h:RosterHero)=>priority.findIndex(c=>c===h.hero.classId && !state.roster.some(x=>x.hero.classId===c));
      return (need(a)<0?99:need(a))-(need(b)<0?99:need(b));
    });
    for(const h of board)if(state.roster.length<(policy==='prepared'?5:partySizeFor(TIER_IDS[state.unlocked])) && state.coin>=hireCost(h))act('hire',()=>hire(state,h.hero.id));
    if(policy!=='risky'){
      const missing=neededRecruit(state);
      if(missing&&state.coin>=commissionCost(state))act('commission',()=>commission(state,missing));
    }
    const reserve=policy==='prepared'?80:40;
    for(const id of ['lamplighter','infirmary','training_yard','academy'])if(!state.camp?.includes(id) && state.coin>=CAMP[id].cost+reserve)act('build',()=>build(state,id));
    for(const h of state.roster){
      const p=promotions(state,h.hero.id);if(p.options.length && !p.blocked)act('promote',()=>promote(state,h.hero.id,p.options[0]));
      for(const id of [...(state.stash??[])])if(canEquip(h.hero.classId,id)){const worn=(h.hero.items??[]).find(x=>ITEMS[x].slot===ITEMS[id].slot);if(!worn||Object.values(ITEMS[id].add).reduce((s,v)=>s+v,0)>Object.values(ITEMS[worn].add).reduce((s,v)=>s+v,0))equip(state,h.hero.id,ITEMS[id].slot,id);}
      if(policy==='prepared'&&(state.refinements?.[h.hero.id]??0)<COMPANY.economy.serviceCap&&state.coin>=serviceCost(state,h.hero.id)+reserve)act('service',()=>serviceGear(state,h.hero.id));
    }
    if(policy==='prepared')for(const id of new Set(state.stash??[]))while((state.stash??[]).filter(x=>x===id).length>1&&!state.favorites?.includes(id)){if(!act('salvage',()=>salvage(state,id)))break}
    if(state.roster.length && state.roster.every(h=>h.benched>0)){rest(state);if(state.roster.every(h=>h.benched>0))rest(state)}
    const index=policy==='risky'?state.unlocked:TIER_IDS.indexOf(recommendedTier(state));
    const tier=TIER_IDS[index],size=partySizeFor(tier);
    const party=policy!=='risky'?balancedParty(state,size):state.roster.filter(h=>h.benched===0).sort((a,b)=>b.hero.level-a.hero.level).slice(0,size);
    if(policy==='risky')party.sort((a,b)=>Number(providesSustain(a))-Number(providesSustain(b)));
    const leader=[...party].sort((a,b)=>b.hero.leadership-a.hero.leadership)[0];
    if(!leader){errors.push(`No ready hero before run ${i+1}`);break}
    const average=party.reduce((s,h)=>s+h.hero.level,0)/party.length;
    const plan={partyIds:party.map(h=>h.hero.id),leaderId:leader.hero.id,tier,doctrine:policy==='risky'||policy==='prepared' && average>=TIERS[tier].heroLevel+1?'depth' as const:'balanced' as const,fromWaystone:policy==='risky'||recommendedWaystone(state,party.map(h=>h.hero.id),tier)};
    const problem=planProblem(state,plan);if(problem){errors.push(problem);break}
    const oldUnlocked=state.unlocked,oldWay=state.waystones[tier]??TIERS[tier].floors[0],warnings=readiness(state,party.map(h=>h.hero.id),tier,plan.fromWaystone);
    const itemsBefore=itemCount(),inventoryBefore=[...(state.stash??[])];
    const out=delve(state,plan);income+=out.result.banked;
    const buried=party.filter(h=>out.aftermath.died.includes(h.hero.id)).reduce((n,h)=>n+(h.hero.items?.length??0),0);
    if(itemCount()!==itemsBefore+out.result.found.length-buried)errors.push(`Equipment accounting after run ${state.runs}`);
    if(out.result.outcome==='wipe')recoveryStart??=state.runs;else if(recoveryStart!==undefined&&out.result.fightsWon>0){recoveries.push(state.runs-recoveryStart);recoveryStart=undefined}
    for(const reward of state.rewards??[])if(!reward.claimed){const option=reward.options.find(id=>isUsefulGear(state,id))??'coin';act('claim',()=>claimReward(state,reward.id,option))}
    if(out.aftermath.levelled.length || state.unlocked>oldUnlocked || (state.waystones[tier]??0)>oldWay || firstFinalClear)stall=0;else stall++;
    longestStall=Math.max(longestStall,stall);
    if(tier==='III' && out.result.outcome==='cleared')firstFinalClear??=state.runs;
    rows.push({run:state.runs,tier,outcome:out.result.outcome,party:party.length,coin:state.coin,earned:out.result.banked,spent,gear:out.result.found.length,died:out.aftermath.died.length,unlocked:state.unlocked,level:average,floor:out.result.floorsReached,firstFinalClear:firstFinalClear===state.runs,rooms:out.result.rooms,fights:out.result.fights,seconds:out.result.fightSeconds,usefulGear:out.result.found.filter(id=>isUsefulGear({...state,stash:inventoryBefore},id)).length,volunteers:out.volunteers?.length??0,waystone:state.waystones[tier]??0,readiness:warnings,reason:out.receipt.returnReason,spending:{...costs}});
    if(state.coin!==income-spent || state.coin<0 || !Number.isFinite(state.coin) || state.pending || new Set(state.history.map(h=>h.run)).size!==state.history.length)errors.push(`Invalid company accounting after run ${state.runs}`);
    if(saves.notice.status!=='saved')errors.push(`Failed save after run ${state.runs}`);
    const loaded=saves.read();if(!loaded.state){errors.push(`Save failed after run ${state.runs}: ${loaded.kind}`);break}if(!isDeepStrictEqual(JSON.parse(JSON.stringify({...state,camp:state.camp??[],stash:state.stash??[]})),loaded.state))errors.push(`Save round-trip changed meaningful state after ${state.runs}`);state=loaded.state;
    if(errors.length)break;
  }
  const milestone=rows.find(r=>r.firstFinalClear);
  return {seed,policy,runs:rows.length,firstFinalClear,longestStall,spent,actions,costs,recoveries,unresolvedRecovery:recoveryStart===undefined?0:state.runs-recoveryStart+1,coinAtCompletion:milestone?.coin,spentAtCompletion:milestone?.spent,fightSecondsToCompletion:milestone?rows.filter(r=>r.run<=milestone.run).reduce((s,r)=>s+r.seconds,0):undefined,milestones:state.milestones,finalCoin:state.coin,unlocked:TIER_IDS[state.unlocked],wipes:rows.filter(r=>r.outcome==='wipe').length,clears:rows.filter(r=>r.outcome==='cleared').length,errors,rows};
}
