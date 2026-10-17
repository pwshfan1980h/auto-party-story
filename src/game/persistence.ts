import { CLASSES, ITEMS, PROGRESSION, RACES, TIERS } from '../sim/data';
import { canEquip } from '../sim/items';
import camp from '../../data/camp.json';
import type { GameState } from './state';

export const SAVE_KEY = 'aps-save-v1'; // Keep the original origin-local key for migration.
export const BACKUP_KEY = 'aps-save-backup';
export const RECOVERY_KEY = 'aps-save-recovery';
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveStatus = 'saved' | 'unsaved' | 'conflict';
export interface SaveNotice { status: SaveStatus; message: string }
export interface LoadedSave { kind: 'missing' | 'valid' | 'migrated' | 'damaged' | 'future' | 'unavailable'; state?: GameState; message?: string }
const object = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) => number(v, max) && Number.isSafeInteger(v);
const text = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
const identifier=(v:unknown)=>text(v,100)&&!Object.hasOwn(Object.prototype,v as string);
const reference=(table:object,v:unknown)=>typeof v==='string'&&Object.hasOwn(table,v);
const list = (v: unknown, check: (v: any) => boolean, max = 10000): v is any[] => Array.isArray(v) && v.length <= max && v.every(check);
const tier = (v: unknown) => typeof v === 'string' && Object.hasOwn(TIERS, v);
const item = (v: unknown) => typeof v === 'string' && Object.hasOwn(ITEMS, v);
const outcome = (v: unknown) => ['cleared', 'retreat', 'wipe'].includes(String(v));
const pick=<T=Record<string,any>>(v:Record<string,any>,keys:string[])=>Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])) as T;
const heroKeys=['id','name','classId','raceId','level','gearScore','zone','attrs','energy','hp','items','traitSpent','leadership'];
const progressKeys=['id','name','classId','raceId','levelBefore','levelAfter','xpBefore','xpAfter','xpGained','leadershipBefore','leadershipAfter','fallen','carried','dealt','healed','kills'];
function cleanHero(h:Record<string,any>){const hero=pick(h.hero,heroKeys);if(hero.attrs)hero.attrs=pick(hero.attrs,['might','vigor','agility','arcana']);return{...pick(h,['xp','benched','runsLed','alive','born']),hero} as GameState['roster'][number]}

/** Validate untrusted imports before the game can touch their nested fields. */
export function decodeSave(raw: string): LoadedSave {
  if (new TextEncoder().encode(raw).length > MAX_SAVE_BYTES) return { kind: 'damaged', message: 'This save is too large to import safely.' };
  let s: Record<string, any>;
  try { const value: unknown = JSON.parse(raw); if (!object(value)) throw Error(); s = value; }
  catch { return { kind: 'damaged', message: 'The save is not readable JSON. Its original contents have been kept.' }; }
  if (integer(s.version) && s.version > 2) return { kind: 'future', message: 'This save needs a newer version of the game. It has not been overwritten.' };
  const bad = (): LoadedSave => ({ kind: 'damaged', message: 'Some saved company data is missing or invalid. The original save has been kept.' });
  const rosterHero = (h: unknown) => {
    if (!object(h) || !object(h.hero)) return false;
    const u = h.hero;
    if (!identifier(u.id) || !text(u.name, 100) || !reference(CLASSES, u.classId) || !reference(RACES, u.raceId)) return false;
    if (!integer(u.level, PROGRESSION.maxLevel) || u.level < 1 || !number(u.gearScore, 10000) || !integer(u.leadership, 10) || u.leadership < 1 || !['front','middle','back'].includes(u.zone)) return false;
    if (u.items !== undefined && (!list(u.items, item, 4) || new Set(u.items.map((id: string) => ITEMS[id].slot)).size !== u.items.length || !u.items.every((id: string) => canEquip(u.classId, id)))) return false;
    if (u.attrs !== undefined && (!object(u.attrs) || !['might','vigor','agility','arcana'].every(k => number(u.attrs[k],10000)))) return false;
    if (['hp','energy'].some(k => u[k] !== undefined && !number(u[k], 1e7))) return false;
    if(u.traitSpent!==undefined && typeof u.traitSpent!=='boolean')return false;
    return number(h.xp, 1e12) && integer(h.benched, 100) && integer(h.runsLed) && h.alive === true && number(h.born);
  };
  if (![1,2].includes(s.version) || !integer(s.seed) || !integer(s.runs) || !number(s.coin, 1e12) || !integer(s.unlocked, 2) || !integer(s.hired)) return bad();
  if (!list(s.roster, rosterHero, 500) || !list(s.hireBoard, rosterHero, 100) || !object(s.waystones)) return bad();
  if (Object.entries(s.waystones).some(([t,f]) => !tier(t) || !integer(f, TIERS[t].floors[1]) || f < TIERS[t].floors[0])) return bad();
  const ids = [...s.roster,...s.hireBoard].map(h => h.hero.id);
  if (new Set(ids).size !== ids.length) return bad();
  if (!list(s.memorial, m => object(m) && identifier(m.id) && text(m.name,100) && reference(CLASSES,m.classId) && reference(RACES,m.raceId) && integer(m.level,30) && m.level>=1 && integer(m.run) && tier(m.tier) && (m.cause===undefined || text(m.cause,500)))) return bad();
  if (!list(s.history, r => object(r) && integer(r.run) && tier(r.tier) && outcome(r.outcome) && number(r.banked) && integer(r.floors,11) && list(r.died, n=>text(n,100),500) && integer(r.levelled,500),30)) return bad();
  if (s.stash !== undefined && !list(s.stash,item)) return bad();
  if (s.camp !== undefined && (!list(s.camp,u=>typeof u==='string' && Object.hasOwn(camp.upgrades,u),4) || new Set(s.camp).size!==s.camp.length)) return bad();
  if (s.pending !== undefined) {
    const p=s.pending, plan=p?.plan;
    if (!object(p) || !object(plan) || p.run!==s.runs || !tier(plan.tier) || ['I','II','III'].indexOf(plan.tier)>s.unlocked || !['balanced','home','pack','depth'].includes(plan.doctrine) || typeof plan.fromWaystone!=='boolean') return bad();
    if (!list(plan.partyIds,id=>s.roster.some((h: any)=>h.hero.id===id && h.benched===0),TIERS[plan.tier].partySize) || !plan.partyIds.length || new Set(plan.partyIds).size!==plan.partyIds.length || !plan.partyIds.includes(plan.leaderId)) return bad();
    if (s.version===2 && p.id!==`${s.seed}:${s.runs}`) return bad();
  }
  if (s.version===2) {
    if(s.legacyCompletion!==undefined && typeof s.legacyCompletion!=='boolean')return bad();
    if (!integer(s.revision) || !object(s.milestones) || !object(s.bossDryStreak)) return bad();
    if (Object.entries(s.milestones).some(([t,r])=>!tier(t)||!integer(r)||r>s.runs)) return bad();
    if (Object.entries(s.bossDryStreak).some(([t,n])=>!tier(t)||!integer(n,10000))) return bad();
    if(s.refinements!==undefined && (!object(s.refinements) || Object.entries(s.refinements).some(([id,n])=>!identifier(id)||!integer(n,5))))return bad();
    if(s.favorites!==undefined && !list(s.favorites,item,100))return bad();
    if(s.rewards!==undefined && (!list(s.rewards,r=>object(r)&&text(r.id,100)&&integer(r.run)&&r.run<=s.runs&&tier(r.tier)&&list(r.options,item,3)&&(r.claimed===undefined||r.claimed==='coin'||r.options.includes(r.claimed)),3) || new Set(s.rewards.map((r:any)=>r.id)).size!==s.rewards.length))return bad();
    if(s.lastReceipt!==undefined){
      const r=s.lastReceipt;
      if(!object(r)||!text(r.id,100)||r.run!==s.runs||!tier(r.tier)||!outcome(r.outcome)||!number(r.banked)||!number(r.balance)||typeof r.firstClear!=='boolean'||typeof r.firstFinalClear!=='boolean')return bad();
      if(r.legacyFinal!==undefined&&typeof r.legacyFinal!=='boolean')return bad();
      if(!list(r.heroes,h=>object(h)&&identifier(h.id)&&text(h.name,100)&&reference(CLASSES,h.classId)&&reference(RACES,h.raceId)&&['levelBefore','levelAfter','leadershipBefore','leadershipAfter'].every(k=>integer(h[k],30)&&h[k]>=1)&&['xpBefore','xpAfter','xpGained'].every(k=>number(h[k],1e12))&&['dealt','healed','kills'].every(k=>h[k]===undefined||number(h[k],1e12))&&typeof h.fallen==='boolean'&&typeof h.carried==='boolean',4))return bad();
      if(!list(r.gear,item)||!list(r.newRaces,x=>typeof x==='string'&&Object.hasOwn(RACES,x),30)||!list(r.volunteers,x=>text(x,100),10)||!list(r.ledger,x=>text(x,4000),80)||!text(r.returnReason,1000))return bad();
      if(!['waystoneBefore','waystoneAfter','floor','rooms','fights','fightsWon'].every(k=>integer(r[k],10000)) || (r.unlockedTier!==undefined && !tier(r.unlockedTier)) || (r.rewardId!==undefined && !s.rewards?.some((x:any)=>x.id===r.rewardId)))return bad();
    }
  }
  const migrated=s.version===1;
  // Pick known top-level fields so exported game data cannot carry unrelated imported payloads.
  const state: GameState = {
    version:2, seed:s.seed, runs:s.runs, coin:s.coin, unlocked:s.unlocked, waystones:s.waystones,
    roster:s.roster.map(cleanHero), hireBoard:s.hireBoard.map(cleanHero), memorial:s.memorial.map((m:any)=>pick<GameState['memorial'][number]>(m,['id','name','classId','raceId','level','run','tier','cause'])), history:s.history.map((h:any)=>pick<GameState['history'][number]>(h,['run','tier','outcome','banked','floors','died','levelled'])), hired:s.hired,
    camp:s.camp??[], stash:s.stash??[], revision:migrated?0:s.revision,
    milestones:migrated ? Object.fromEntries(['I','II','III'].filter((t,i)=>i<s.unlocked || s.history.some((h: any)=>h.tier===t && h.outcome==='cleared')).map(t=>[t,0])) : s.milestones,
    bossDryStreak:migrated?{}:s.bossDryStreak,
    ...((migrated?s.unlocked===2&&!s.history.some((h:any)=>h.tier==='III'&&h.outcome==='cleared'):s.legacyCompletion)?{legacyCompletion:true}:{}),
    ...(!migrated&&s.rewards ? {rewards:s.rewards.map((r:any)=>pick(r,['id','run','tier','options','claimed']))}:{}),
    ...(!migrated&&s.refinements?{refinements:s.refinements}:{}),...(!migrated&&s.favorites?{favorites:s.favorites}:{}),
    ...(!migrated&&s.lastReceipt ? {lastReceipt:{...pick<NonNullable<GameState['lastReceipt']>>(s.lastReceipt,['id','run','tier','outcome','banked','balance','firstClear','firstFinalClear','legacyFinal','gear','rewardId','unlockedTier','newRaces','volunteers','waystoneBefore','waystoneAfter','floor','rooms','fights','fightsWon','returnReason','ledger']),heroes:s.lastReceipt.heroes.map((h:any)=>pick(h,progressKeys))}}:{}),
    ...(s.pending ? {pending:{run:s.pending.run,plan:pick(s.pending.plan,['partyIds','leaderId','tier','doctrine','fromWaystone']),id:`${s.seed}:${s.runs}`}}:{}),
  };
  return {kind:migrated?'migrated':'valid',state};
}

/** Single-key state commits; backups never replace or hide an invalid primary save. */
export class SaveStore {
  private expected = new WeakMap<GameState,string|null>();
  notice: SaveNotice = {status:'unsaved',message:'Progress has not been saved yet.'};
  constructor(private storage: () => StorageLike, private changed: (n: SaveNotice) => void = () => {}) {}
  private announce(status: SaveStatus,message: string) { this.notice={status,message};this.changed(this.notice);return status==='saved'; }
  read(): LoadedSave {
    try {
      const raw=this.storage().getItem(SAVE_KEY);
      if(raw===null)return{kind:'missing'};
      const loaded=decodeSave(raw);if(loaded.state){this.expected.set(loaded.state,raw);if(loaded.kind==='valid')this.notice={status:'saved',message:'Progress saved'}}
      return loaded;
    } catch { return {kind:'unavailable',message:'Browser storage is unavailable. Download a backup before closing this tab.'}; }
  }
  write(state: GameState): boolean {
    try {
      const store=this.storage(),current=store.getItem(SAVE_KEY),expected=this.expected.get(state);
      if(current!==(expected??null))return this.announce('conflict','Another tab or saved company is newer. Download this session, then reload before continuing.');
      const revision=state.revision;state.revision++;
      const next=JSON.stringify(state);const checked=decodeSave(next);
      if(!checked.state){state.revision=revision;return this.announce('unsaved','This company could not be validated. Download a backup and keep this tab open.');}
      // A backup failure must not prevent the primary write (e.g. near storage quota).
      if(current && decodeSave(current).state)try{store.setItem(BACKUP_KEY,current)}catch{/* primary commit still attempted */}
      try { store.setItem(SAVE_KEY,next); } catch(e) {state.revision=revision;throw e;}
      this.expected.set(state,next);return this.announce('saved','Progress saved');
    } catch {return this.announce('unsaved',"Progress isn't saved. Keep this tab open; retry or download a backup.");}
  }
  isCurrent(state: GameState): boolean {
    try{return this.storage().getItem(SAVE_KEY)===(this.expected.get(state)??null)}catch{return true}
  }
  raw(): string {try{return this.storage().getItem(SAVE_KEY)??''}catch{return ''}}
  backup(): LoadedSave {try{return decodeSave(this.storage().getItem(BACKUP_KEY)??'')}catch{return{kind:'unavailable'}}}
  export(state: GameState): string {return JSON.stringify(state,null,2)}
  replace(raw: string): LoadedSave {
    const loaded=decodeSave(raw);if(!loaded.state)return loaded;
    try {
      const store=this.storage(),old=store.getItem(SAVE_KEY);
      if(old!==null)store.setItem(decodeSave(old).state?BACKUP_KEY:RECOVERY_KEY,old);
      this.expected.set(loaded.state,old);
      if(!this.write(loaded.state))return{kind:'unavailable',message:this.notice.message};
      return loaded;
    } catch {this.announce('unsaved','The replacement could not be saved. Your existing save has not been removed.');return{kind:'unavailable',message:this.notice.message}}
  }
  clear(): boolean {
    try {const store=this.storage(),raw=store.getItem(SAVE_KEY);if(raw!==null)store.setItem(decodeSave(raw).state?BACKUP_KEY:RECOVERY_KEY,raw);store.removeItem(SAVE_KEY);return true}
    catch{return this.announce('unsaved','The old save could not be backed up and removed. It has been kept.')}
  }
}

export const saves = new SaveStore(() => localStorage, notice => {
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('aps-save',{detail:notice}));
});
