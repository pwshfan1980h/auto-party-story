import { CLASSES,ENEMIES,ITEMS,PROGRESSION,RACES,TIERS } from '../sim/data';
import { ZONE,xpToNext } from '../sim/roster';
import { companyStandard,returnTorch } from '../art/standard';
import { sfx } from '../audio/sfx';
import { preferences } from '../game/preferences';
import { claimReward,COMPANY,isUsefulGear } from '../game/rewards';
import { saves } from '../game/persistence';
import type { GameState } from '../game/state';
import type { RunReceipt } from '../game/receipt';
import { clear,el } from './dom';
import { modelPortrait,portrait } from './portrait';
import { itemIcon } from '../art/itemIcon';
import { commissionCost,serviceCost } from '../game/economy';

export function standardPortrait(){return modelPortrait('company-standard',companyStandard)}
const labels:Record<string,string>={maxHp:'HP',armor:'armour',healPower:'healing',energyGain:'energy gain',atkSpeed:'attack speed',move:'movement'};
const prettyStats=(id:string)=>Object.entries(ITEMS[id].add).map(([key,v])=>`${(v??0)>=0?'+':''}${Math.abs(v??0)<1?`${Math.round((v??0)*100)}%`:v} ${labels[key]??key}`).join(' · ') || 'Equipment for the company';

export function renderRunRecap(root:HTMLElement,state:GameState,r:RunReceipt,onBack:()=>void,options:{fresh?:boolean;away?:boolean}={}) {
  const fallen=r.heroes.filter(h=>h.fallen),loss=r.outcome==='wipe',clearTier=r.outcome==='cleared';
  const boss=ENEMIES[TIERS[r.tier].boss.boss]?.name??'The boss';
  const waystoneGain=r.waystoneAfter>Math.max(r.waystoneBefore,TIERS[r.tier].floors[0]);
  const hasGain=r.banked>0||r.gear.length>0||r.heroes.some(h=>h.xpGained>0)||waystoneGain;
  const title=loss?'Their names stay with Torchwatch.':r.firstFinalClear?'The depths remember your name.':r.firstClear?`${boss} has fallen.`:clearTier?'The way is held.':fallen.length?'Home. Not everyone made it.':hasGain?'Home, with something to show for it.':'Home, with the company intact.';
  const line=loss?'The company did not return. The town they built still stands.':r.firstFinalClear?`${boss} has fallen in ${TIERS[r.tier].name}. Your company carried the torch through every region. Torchwatch will remember.`:clearTier?`${boss} is defeated in ${TIERS[r.tier].name}. The company brought its story home.`:'The company returned with what it could carry. Surviving and banking progress counts.';
  const heading=el('h1',{tabindex:-1,class:r.firstFinalClear?'final-title':loss?'warn':''},title);
  const stage=el('div',{class:`recap-company ${loss?'memorial':''}`,'aria-label':loss?'The fallen company':'The returning company'});
  if(r.firstClear){const standard=standardPortrait();if(standard)stage.append(el('img',{class:'company-standard',src:standard,alt:'The company standard on its stone plinth'}))}
  else if(!loss){const torch=modelPortrait('return-torch',returnTorch);if(torch)stage.append(el('img',{class:'company-standard',src:torch,alt:'A flame brought safely home beside the route marker'}))}
  for(const h of r.heroes){const src=portrait({id:h.id,name:h.name,classId:h.classId,raceId:h.raceId,level:h.levelAfter,leadership:h.leadershipAfter,gearScore:10,zone:ZONE[h.classId]??'middle'});stage.append(el('figure',{class:h.fallen?'fallen':''},src?el('img',{src,alt:`${h.name}, ${CLASSES[h.classId].name}`,width:96,height:112}):null,el('figcaption',{},h.name)))}
  const metrics=el('section',{class:'recap-metrics','aria-label':'Expedition results'},
    el('div',{},el('small',{},'COIN BANKED'),el('strong',{},`+${r.banked.toLocaleString()}`),el('span',{},`${r.balance.toLocaleString()} coin after the run`)),
    el('div',{},el('small',{},loss?'LAST REACHED':'PROGRESS'),el('strong',{},`Floor ${r.floor}`),el('span',{},`${r.fightsWon}/${r.fights} fights won · ${r.rooms} rooms`)),
    el('div',{},el('small',{},'COMPANY'),el('strong',{},`${r.heroes.length-fallen.length} / ${r.heroes.length}`),el('span',{},fallen.length?`${fallen.length} remembered in the memorial`:'Everyone made it home')));
  const reward=state.rewards?.find(x=>x.id===r.rewardId),rewardPanel=el('section',{class:'reward-choice'});
  if(reward){
    rewardPanel.append(el('h2',{},reward.claimed?'First-clear reward claimed':'A first-clear reward you can use'));
    if(reward.claimed)rewardPanel.append(el('p',{class:'gain'},reward.claimed==='coin'?'A service fund was added to the company’s coin.':`Reward claimed: ${ITEMS[reward.claimed].name}.`));
    else {
      rewardPanel.append(el('p',{class:'muted'},'Choose one item, or take a service fund. Your choice can wait in town.'));
      const cards=el('div',{class:'reward-cards'});
      const choose=(id:string)=>{const error=claimReward(state,reward.id,id);if(error){alert(error);return}sfx.cue('gear');renderRunRecap(root,state,r,onBack,{fresh:false})};
      for(const id of reward.options){const it=ITEMS[id];cards.append(el('article',{class:'reward-item'},el('img',{class:'item-thumbnail',src:itemIcon(id),alt:'',width:64,height:64}),el('strong',{},it.name),el('p',{},prettyStats(id)),el('small',{class:'muted'},isUsefulGear(state,id)?'Fills a slot or offers a better stat; compare the tradeoffs':'Equipable sidegrade; compare before choosing'),el('button',{type:'button',onclick:()=>choose(id)},`Choose ${it.name}`)))}
      rewardPanel.append(cards,el('button',{type:'button',class:'quiet',onclick:()=>choose('coin')},`Take ${COMPANY.rewards.firstClearCoin[['I','II','III'].indexOf(r.tier)]} coin for services instead`));
    }
  }
  const progress=el('section',{class:'recap-progress'},el('h2',{},loss?'The company is remembered':'The company grows'));
  const damage=[...r.heroes].sort((a,b)=>(b.dealt??0)-(a.dealt??0))[0],healer=[...r.heroes].sort((a,b)=>(b.healed??0)-(a.healed??0))[0];
  const highlight=damage?.dealt?el('p',{class:'recap-highlight'},`${damage.name} dealt ${Math.round(damage.dealt).toLocaleString()} damage${healer?.healed?`; ${healer.name} restored ${Math.round(healer.healed).toLocaleString()} health`:''}.`):null;
  for(const h of r.heroes){
    progress.append(el('article',{class:`hero-progress ${h.fallen?'fallen':''}`},el('strong',{},`${h.name} · ${CLASSES[h.classId].name}`),
      h.fallen?el('p',{class:'warn'},'Fell, and is gone for good.'):el('div',{},
        el('p',{class:h.levelAfter>h.levelBefore?'gain':''},h.levelAfter>=PROGRESSION.maxLevel?`Level ${h.levelAfter>h.levelBefore?h.levelBefore+' → ':''}${h.levelAfter} · fully trained`:h.levelAfter>h.levelBefore?`Level ${h.levelBefore} → ${h.levelAfter}`:`Level ${h.levelAfter} · +${Math.round(h.xpGained)} XP`),
        h.levelAfter<PROGRESSION.maxLevel?el('meter',{min:0,max:xpToNext(h.levelAfter),value:h.xpAfter,'aria-label':`${h.name}: ${Math.floor(h.xpAfter)} of ${xpToNext(h.levelAfter)} XP toward next level`}):null,
        h.leadershipAfter>h.leadershipBefore?el('p',{class:'gain'},`Leadership ${h.leadershipBefore} → ${h.leadershipAfter}`):null,
        h.carried?el('p',{class:'warn'},'Carried home; recovering at the Inn.'):null)));
  }
  const changes=el('section',{class:'recap-changes'},el('h2',{},'What changed'));
  if(r.firstFinalClear)changes.append(el('p',{class:'gain'},'Your company standard now stands in Torchwatch. Your first final clear remains remembered.'));
  if(r.unlockedTier)changes.append(el('p',{class:'gain'},`Tier ${r.unlockedTier} · ${TIERS[r.unlockedTier].name} is open.`));
  if(waystoneGain)changes.append(el('p',{class:'gain'},`Waystone ${r.waystoneBefore||'entrance'} → floor ${r.waystoneAfter}. Begin deeper next time with a fresh torch.`));
  if(r.gear.length)changes.append(el('p',{},`Gear in the stores: ${r.gear.map(id=>ITEMS[id].name).join(', ')}.`));
  if(r.newRaces.length)changes.append(el('p',{class:'gain'},`New faces at the Inn: ${r.newRaces.map(id=>RACES[id].name).join(', ')}.`));
  if(r.volunteers.length)changes.append(el('p',{},`${r.volunteers.join(', ')} volunteered to help rebuild the company.`));
  if(!changes.querySelector('p'))changes.append(el('p',{class:'muted'},loss?'Town upgrades, stored equipment, and earlier waystones remain yours.':'Your company’s coin, experience, and equipment are kept.'));
  if(!clearTier)changes.append(el('p',{class:'muted'},`Why the expedition ended: ${r.returnReason}`));
  const next=el('section',{class:'recap-next'},el('div',{},el('h2',{},loss||fallen.length?'Prepare a safer return':r.firstFinalClear?'Let the company’s story continue':'Put the haul to work'),
    el('p',{},loss?`Rebuild at the Inn, then ${r.tier==='I'?'return to the shallows':'choose a lower-tier recovery route'}. Your company’s progress is kept.`:r.rewardId&&!reward?.claimed?'Claim your first-clear reward now, or review it later in town.':'Review your stores, commission a needed role, or improve a hero before the next push.'),
    state.coin>=commissionCost(state)?el('p',{class:'muted'},`You can afford a targeted recruit: ${commissionCost(state)} coin.`):state.roster.some(h=>(state.refinements?.[h.hero.id]??0)<COMPANY.economy.serviceCap&&serviceCost(state,h.hero.id)<=state.coin)?el('p',{class:'muted'},'You can afford an equipment service. Open a hero’s Gear in town to compare the improvement.'):null),
    el('button',{type:'button',class:'go',onclick:()=>{sfx.stopCue();onBack();window.scrollTo(0,0);const title=root.querySelector('h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true})}}},'Back to Torchwatch'));
  const detail=el('details',{class:'recap-ledger'},el('summary',{},'Read the full room ledger'),el('ol',{},...r.ledger.map(line=>el('li',{},line))));
  clear(root).append(el('main',{class:`run-recap ${loss?'loss':''} ${options.fresh&&!preferences.reducedMotion?'arrival':''}`},
    el('header',{},el('p',{class:'recap-kicker'},r.firstFinalClear?r.legacyFinal?'FIRST RECORDED FINAL CLEAR':'FIRST FINAL CLEAR':r.firstClear?'FIRST TIER CLEAR':`DELVE ${r.run} · ${TIERS[r.tier].name}`),heading,el('p',{},line),
      options.away?el('p',{class:'muted'},'The company carried on while the page was closed. This expedition has settled once.'):null),stage,highlight,metrics,reward?rewardPanel:null,progress,changes,next,detail));
  heading.focus({preventScroll:true});
  if(options.fresh){sfx.stopCue();sfx.cue(loss||fallen.length?'memorial':r.firstFinalClear?'final':r.firstClear?'tier':waystoneGain?'waystone':r.heroes.some(h=>h.levelAfter>h.levelBefore)?'level':'home')}
  if(saves.notice.status!=='saved' && !options.away)root.querySelector('main')?.append(el('p',{class:'warn'},'This result is in memory. Check the save warning above before closing the tab.'));
}
