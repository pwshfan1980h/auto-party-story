import { describe,expect,it } from 'vitest';
import { candidate,newGame } from '../src/game/state';
import { awardClear,claimReward,COMPANY,isUsefulGear,rewardOptions } from '../src/game/rewards';
import { commission,commissionCost,commissionLevel,protectItem,refreshCost,rerollBoard,salvage,serviceCost,serviceGear } from '../src/game/economy';
import { balancedParty,readiness,recommendedTier,recommendedWaystone } from '../src/game/preparation';
import { decodeSave } from '../src/game/persistence';
import { runRun,type RunResult } from '../src/sim/run';
import { ITEMS } from '../src/sim/data';
import { autoAttrs,heroStats } from '../src/sim/stats';
import { canEquip } from '../src/sim/items';
import { assist } from '../src/game/expedition';
import { orderGate } from '../tools/order-diagnostics';

function clearResult():RunResult {
  const s=newGame(1),party=s.roster.map(h=>({...h.hero,level:30,leadership:1,raceId:'orc'}));
  const result=runRun({seed:2,tier:'I',party,leaderId:party[0].id,doctrine:'depth',torch:99,startFloor:3});
  expect(result.outcome).toBe('cleared');return result;
}
describe('clear rewards',()=>{
  it('creates one deterministic appropriate-tier first-clear entitlement',()=>{
    const s=newGame(7),result=clearResult(),grant=awardClear(s,result,'7:0');s.runs++;
    expect(grant.firstClear).toBe(true);expect(s.milestones.I).toBe(1);expect(s.rewards).toHaveLength(1);
    const options=s.rewards![0].options;expect(options.length).toBeGreaterThan(0);
    expect(options.every(id=>ITEMS[id].tier===1&&s.roster.some(h=>canEquip(h.hero.classId,id)))).toBe(true);
    expect(options).toEqual(rewardOptions(newGame(7),'I',0));
    awardClear(s,clearResult(),'7:1');expect(s.rewards).toHaveLength(1);
  });
  it('survives save reload and cannot be claimed twice or as an unoffered item',()=>{
    const s=newGame(4);awardClear(s,clearResult(),'4:0');s.runs++;
    const loaded=decodeSave(JSON.stringify(s)).state!,reward=loaded.rewards![0],id=reward.options[0];
    expect(claimReward(loaded,reward.id,'invalid')).toBeTruthy();expect(loaded.stash??[]).toEqual([]);
    expect(claimReward(loaded,reward.id,id)).toBeNull();expect(loaded.stash).toEqual([id]);
    const again=decodeSave(JSON.stringify(loaded)).state!;
    expect(claimReward(again,reward.id,id)).toBeTruthy();expect(again.stash).toEqual([id]);
  });
  it('offers a useful service fund instead of forcing an unwanted duplicate',()=>{
    const s=newGame(3);awardClear(s,clearResult(),'3:0');s.runs++;const before=s.coin;
    expect(claimReward(s,'3:0','coin')).toBeNull();expect(s.coin).toBe(before+COMPANY.rewards.firstClearCoin[0]);
    expect(claimReward(s,'3:0','coin')).toBeTruthy();
  });
  it('ends repeat-clear equipment dry streaks at the configured limit, with no wipe grants',()=>{
    const s=newGame(5);s.milestones.I=0;
    for(let i=0;i<COMPANY.rewards.dryClearLimit;i++){
      const result=clearResult();result.found=[];awardClear(s,result,`5:${i}`);s.runs++;
      expect(result.found.length).toBe(i===COMPANY.rewards.dryClearLimit-1?1:0);
    }
    const wipe=clearResult();wipe.outcome='wipe';wipe.found=[];awardClear(s,wipe,'5:99');expect(wipe.found).toEqual([]);expect(s.rewards??[]).toEqual([]);
  });
  it('recognizes covered duplicates and pays a service fund when every eligible slot is covered',()=>{
    const s=newGame(5);s.milestones.I=0;
    s.stash=Object.keys(ITEMS).filter(id=>ITEMS[id].tier===1).flatMap(id=>Array(s.roster.length).fill(id));
    expect(rewardOptions(s,'I',1).some(id=>isUsefulGear(s,id))).toBe(false);
    const result=clearResult(),before=result.banked;result.found=[];
    s.bossDryStreak.I=COMPANY.rewards.dryClearLimit-1;awardClear(s,result,'5:1');
    expect(result.found).toEqual([]);expect(result.banked).toBe(before+COMPANY.rewards.firstClearCoin[0]);
  });
  it('keeps the useful-reward guarantee across thousands of repeat clears and saturated stores',()=>{
    const fixture=clearResult();
    for(let seed=500;seed<550;seed++){
      const s=newGame(seed);s.milestones.I=0;let dry=0;
      for(let run=0;run<60;run++){
        const result=structuredClone(fixture);result.found=[];const eligible=Object.keys(ITEMS).some(id=>ITEMS[id].tier===1&&isUsefulGear(s,id)),banked=result.banked;
        awardClear(s,result,`${seed}:${run}`);
        const useful=result.found.some(id=>isUsefulGear(s,id));dry=useful||result.banked>banked?0:dry+1;
        if(eligible)expect(dry).toBeLessThan(COMPANY.rewards.dryClearLimit);
        s.stash=[...(s.stash??[]),...result.found];s.runs++;
      }
    }
  });
});

describe('paid economy',()=>{
  it('commissions the requested role at the displayed price and level',()=>{
    const s=newGame(9);s.coin=1000;s.roster[0].hero.level=12;const cost=commissionCost(s),level=commissionLevel(s);
    expect(commission(s,'cleric')).toBeNull();expect(s.coin).toBe(1000-cost);expect(s.roster.at(-1)?.hero.classId).toBe('cleric');expect(s.roster.at(-1)?.hero.level).toBe(level);
    s.coin=0;const count=s.hired;expect(commission(s,'fighter')).toBeTruthy();expect(s.hired).toBe(count);
  });
  it('charges increasing capped equipment services that improve actual combat stats',()=>{
    const s=newGame(2);s.coin=10000;const h=s.roster[0],prices:number[]=[];
    for(let i=0;i<COMPANY.economy.serviceCap;i++){prices.push(serviceCost(s,h.hero.id));expect(serviceGear(s,h.hero.id)).toBeNull()}
    const cash=s.coin;expect(serviceGear(s,h.hero.id)).toBeTruthy();expect(s.coin).toBe(cash);
    expect(prices.every((p,i)=>i===0||p>prices[i-1])).toBe(true);
    const attrs=autoAttrs(h.hero.classId,h.hero.level),base=heroStats(h.hero.classId,h.hero.raceId,h.hero.level,attrs,10),serviced=heroStats(h.hero.classId,h.hero.raceId,h.hero.level,attrs,10+s.refinements![h.hero.id]*COMPANY.economy.serviceGearStep);
    expect(serviced.maxHp).toBeGreaterThan(base.maxHp);expect(serviced.power).toBeGreaterThan(base.power);
    expect(decodeSave(JSON.stringify(s)).state?.refinements).toEqual(s.refinements);
  });
  it('keeps the final spare and protects favorites from salvage',()=>{
    const s=newGame(8);s.stash=['rusty_sword','rusty_sword'];protectItem(s,'rusty_sword');expect(salvage(s,'rusty_sword')).toMatch(/protected/);
    protectItem(s,'rusty_sword');expect(salvage(s,'rusty_sword')).toBeNull();expect(s.stash).toEqual(['rusty_sword']);expect(salvage(s,'rusty_sword')).toBeTruthy();
  });
  it('charges board refresh and does not reroll when unaffordable',()=>{
    const s=newGame(6);s.coin=100;const old=s.hireBoard.map(h=>h.hero.id),cost=refreshCost(s);
    expect(rerollBoard(s)).toBeNull();expect(s.coin).toBe(100-cost);expect(s.hireBoard.map(h=>h.hero.id)).not.toEqual(old);
    s.coin=0;const count=s.hired;expect(rerollBoard(s)).toBeTruthy();expect(s.hired).toBe(count);
  });
});

describe('party preparation',()=>{
  it('suggests available healing and frontline without launching or spending',()=>{
    const s=newGame(12),before=s.coin,chosen=balancedParty(s,3);expect(chosen.some(h=>h.hero.classId==='cleric')).toBe(true);expect(chosen.some(h=>h.hero.classId==='fighter')).toBe(true);
    expect(readiness(s,chosen.map(h=>h.hero.id),'I')).toEqual([]);expect(s.coin).toBe(before);expect(s.pending).toBeUndefined();
  });
  it('warns about missing roles and offers an attainable lower tier',()=>{
    const s=newGame(4);s.unlocked=2;expect(recommendedTier(s)).toBe('I');expect(readiness(s,[s.roster[2].hero.id],'III')).toHaveLength(4);
  });
  it('does not recommend an advanced tier just because veterans mask a new healer’s level',()=>{
    const s=newGame(6);s.unlocked=2;s.roster.push(candidate(s,20,'mage'));s.roster.forEach(h=>h.hero.level=20);s.roster[1].hero.level=1;
    expect(recommendedTier(s)).toBe('I');
  });
  it('recognizes a support healer as a different role from primary sustain',()=>{
    const s=newGame(6);s.roster[1].hero.classId='minstrel';
    expect(readiness(s,s.roster.map(h=>h.hero.id),'I')).toContain('No sustained healer selected. Support heals alone may not cover long fights and repeated rooms.');
  });
  it('rebuilds at the entrance instead of sending level-one volunteers back to an old boss waystone',()=>{
    const s=newGame(10033);s.waystones.I=3;const ids=s.roster.map(h=>h.hero.id);
    expect(recommendedWaystone(s,ids,'I')).toBe(false);expect(readiness(s,ids,'I',true).some(s=>s.includes('Start at the entrance'))).toBe(true);
    s.roster.forEach(h=>h.hero.level=4);expect(recommendedWaystone(s,ids,'I')).toBe(true);
  });
  it('gives a broke surviving damage party a basic healing and frontline recovery route',()=>{
    const s=newGame(2);s.coin=0;s.roster=['rogue','mage','ranger'].map(c=>candidate(s,1,c));
    expect(assist(s)).toHaveLength(2);expect(balancedParty(s,3).map(h=>h.hero.classId)).toEqual(expect.arrayContaining(['cleric','fighter']));
    const names=s.roster.map(h=>h.hero.name);s.memorial.push({id:'old',name: names[0],classId:'rogue',raceId:'human',level:1,run:0,tier:'I'});
    expect(candidate(s,1,'fighter').hero.name).not.toBe(names[0]);
  });
});

it('rejects a missed intervention target and a harmful cell independently of aggregate gains',()=>{
  const safe={noneDiff:[-.2,0] as [number,number],spamDiff:[-.2,0] as [number,number],difference:0};
  expect(orderGate(.1,[safe],70,90)).not.toHaveLength(0);
  expect(orderGate(.4,[{...safe,noneDiff:[.01,.2]}],60,90)).not.toHaveLength(0);
  expect(orderGate(.4,[safe],60,90)).toEqual([]);
});
