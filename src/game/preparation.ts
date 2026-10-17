import { ABILITIES,CLASSES,TIERS } from '../sim/data';
import type { GameState } from './state';
import type { RosterHero } from '../sim/roster';
export function providesSustain(h:RosterHero){return (CLASSES[h.hero.classId].roles.heal??0)>=3 && [...CLASSES[h.hero.classId].skills,CLASSES[h.hero.classId].ult].some(id=>ABILITIES[id]?.friendly && ABILITIES[id].effects.some(e=>e.type==='heal'))}
export function neededRecruit(state:GameState):'cleric'|'fighter'|undefined {
  return !state.roster.some(providesSustain)?'cleric':!state.roster.some(h=>(CLASSES[h.hero.classId].roles.tank??0)>=2)?'fighter':undefined;
}
export function balancedParty(state:GameState,size:number):RosterHero[]{
  const ready=state.roster.filter(h=>h.benched===0).sort((a,b)=>b.hero.level-a.hero.level||a.hero.id.localeCompare(b.hero.id));
  const party:RosterHero[]=[];
  for(const find of [(h:RosterHero)=>providesSustain(h),(h:RosterHero)=>(CLASSES[h.hero.classId].roles.tank??0)>=2]){const h=ready.find(find);if(h&&!party.includes(h))party.push(h)}
  for(const h of ready)if(party.length<size&&!party.includes(h))party.push(h);
  return party.slice(0,size);
}
export function recommendedTier(state:GameState):string {
  const tiers=['I','II','III'];
  for(let index=state.unlocked;index>0;index--){const tier=tiers[index],p=balancedParty(state,TIERS[tier].partySize),level=TIERS[tier].heroLevel;if(p.length===TIERS[tier].partySize && p.some(h=>providesSustain(h)&&h.hero.level>=level-1) && p.some(h=>(CLASSES[h.hero.classId].roles.tank??0)>=2&&h.hero.level>=level-1) && p.reduce((s,h)=>s+h.hero.level,0)/p.length>=level)return tier}
  return 'I';
}
export function recommendedWaystone(state:GameState,ids:string[],tier:string):boolean {
  const t=TIERS[tier],floor=state.waystones[tier]??t.floors[0];if(floor<=t.floors[0])return false;
  const party=state.roster.filter(h=>ids.includes(h.hero.id)),level=t.heroLevel+Math.max(0,floor-t.floors[0]-1);
  return party.length===t.partySize && party.reduce((n,h)=>n+h.hero.level,0)/party.length>=level && party.some(h=>providesSustain(h)&&h.hero.level>=level-1) && party.some(h=>(CLASSES[h.hero.classId].roles.tank??0)>=2&&h.hero.level>=level-1);
}
export function readiness(state:GameState,ids:string[],tier:string,fromWaystone=false):string[]{
  const party=ids.map(id=>state.roster.find(h=>h.hero.id===id)).filter((h):h is RosterHero=>!!h),messages:string[]=[];
  if(party.length<TIERS[tier].partySize)messages.push(`${party.length} of ${TIERS[tier].partySize} heroes selected. A full company is safer.`);
  if(!party.some(h=>(CLASSES[h.hero.classId].roles.tank??0)>=2))messages.push('No dedicated frontline. Backline heroes may take the first hits.');
  if(!party.some(providesSustain))messages.push('No sustained healer selected. Support heals alone may not cover long fights and repeated rooms.');
  if(party.length && tier!=='I' && (party.some(h=>h.hero.level<TIERS[tier].heroLevel-1)||party.reduce((s,h)=>s+h.hero.level,0)/party.length<TIERS[tier].heroLevel))messages.push(`Recommended party level: ${TIERS[tier].heroLevel}. An inexperienced hero can be exposed even beside veterans; consider a lower-tier recovery route.`);
  if(fromWaystone&&!recommendedWaystone(state,ids,tier))messages.push(`This waystone enters at floor ${state.waystones[tier]}. Start at the entrance while rebuilding; the deeper route stays available when the company is ready.`);
  return messages;
}
