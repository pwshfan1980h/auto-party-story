import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, decodeSave, MAX_SAVE_BYTES, RECOVERY_KEY, SAVE_KEY, SaveStore } from '../src/game/persistence';
import { newGame } from '../src/game/state';
import { TIERS } from '../src/sim/data';
import { beginDelve, delve, finishPending, planProblem, settleDelve } from '../src/game/expedition';

function memory() {
  const data=new Map<string,string>();
  return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}};
}
const planFor=(s: ReturnType<typeof newGame>)=>({partyIds:s.roster.map(h=>h.hero.id),leaderId:s.roster[0].hero.id,tier:'I',doctrine:'balanced' as const,fromWaystone:false});

describe('save validation and migration',()=>{
  it('migrates existing v1 progress and infers only evidenced first clears',()=>{
    const original={...newGame(12),version:1,unlocked:2};
    delete (original as any).revision;delete (original as any).milestones;delete (original as any).bossDryStreak;
    const loaded=decodeSave(JSON.stringify(original));
    expect(loaded.kind).toBe('migrated');expect(loaded.state?.milestones).toEqual({I:0,II:0});
    expect(loaded.state?.roster).toEqual(original.roster);expect(loaded.state?.coin).toBe(original.coin);
    expect(loaded.state?.legacyCompletion).toBe(true);
  });
  it('drops unrelated payloads at every imported game-object boundary',()=>{
    const s:any=newGame(8);s.unrelated='secret';s.roster[0].unrelated='secret';s.roster[0].hero.unrelated='secret';s.hireBoard[0].unrelated='secret';
    const loaded=decodeSave(JSON.stringify(s));expect(loaded.kind).toBe('valid');expect(JSON.stringify(loaded.state)).not.toContain('secret');
  });
  it('does not lift unvalidated newer fields out of an otherwise valid v1 file',()=>{
    const old={...newGame(7),version:1,rewards:'invalid',lastReceipt:{},refinements:{bad:'invalid'},bossDryStreak:{bad:NaN},revision:-5};
    const loaded=decodeSave(JSON.stringify(old));expect(loaded.kind).toBe('migrated');
    expect(loaded.state?.rewards).toBeUndefined();expect(loaded.state?.lastReceipt).toBeUndefined();expect(loaded.state?.refinements).toBeUndefined();expect(loaded.state?.revision).toBe(0);
    expect(decodeSave(JSON.stringify(loaded.state)).kind).toBe('valid');
  });
  it.each(['{invalid','{"version":1}','null','[]'])('rejects damaged nested data: %s',raw=>expect(decodeSave(raw).kind).toBe('damaged'));
  it('does not overwrite a future version or import oversized payloads',()=>{
    expect(decodeSave('{"version":99}').kind).toBe('future');
    expect(decodeSave(' '.repeat(MAX_SAVE_BYTES+1)).kind).toBe('damaged');
  });
  it('rejects unknown equipment, nonfinite money, repeated IDs, and invalid pending references',()=>{
    for(const corrupt of [(s:any)=>{s.stash=['no-such-item']},(s:any)=>{s.coin=-1},(s:any)=>{s.roster[0].hero.id='__proto__'},(s:any)=>{s.roster[0].hero.classId=['fighter']},(s:any)=>{s.hireBoard[0].hero.id=s.roster[0].hero.id},(s:any)=>{s.pending={id:'bad',run:0,plan:planFor(s)}}]){
      const s=newGame(7);corrupt(s);expect(decodeSave(JSON.stringify(s)).kind).toBe('damaged');
    }
  });
});

describe('durable writes',()=>{
  it('exports and imports exact progress and retains the previous valid save',()=>{
    const storage=memory(),store=new SaveStore(()=>storage),s=newGame(7);
    expect(store.write(s)).toBe(true);const old=storage.getItem(SAVE_KEY)!;
    s.coin=150;expect(store.write(s)).toBe(true);expect(storage.getItem(BACKUP_KEY)).toBe(old);
    const other=new SaveStore(()=>memory());const loaded=other.replace(store.export(s));
    expect(loaded.state?.coin).toBe(150);expect(loaded.state?.roster).toEqual(s.roster);
  });
  it('leaves damaged primary data untouched until an explicit replacement',()=>{
    const storage=memory();storage.setItem(SAVE_KEY,'{"version":1}');const store=new SaveStore(()=>storage);
    expect(store.read().kind).toBe('damaged');expect(store.write(newGame(1))).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe('{"version":1}');
    expect(store.replace(JSON.stringify(newGame(2))).state?.seed).toBe(2);
    expect(storage.getItem(RECOVERY_KEY)).toBe('{"version":1}');
  });
  it('fails a blocked or full write visibly without advancing its saved revision',()=>{
    const storage=memory(),store=new SaveStore(()=>storage),s=newGame(4);store.write(s);const before=storage.getItem(SAVE_KEY),revision=s.revision;
    storage.setItem=()=>{throw new Error('QuotaExceeded')};s.coin+=20;
    expect(store.write(s)).toBe(false);expect(store.notice.status).toBe('unsaved');expect(s.revision).toBe(revision);expect(storage.getItem(SAVE_KEY)).toBe(before);
  });
  it('prevents a stale tab from overwriting a newer revision',()=>{
    const storage=memory(),a=new SaveStore(()=>storage),b=new SaveStore(()=>storage);a.write(newGame(5));
    const first=a.read().state!,stale=b.read().state!;first.coin=90;a.write(first);stale.coin=999;
    expect(b.write(stale)).toBe(false);expect(b.notice.status).toBe('conflict');expect(decodeSave(storage.getItem(SAVE_KEY)!).state?.coin).toBe(90);
  });
  it('does not remove the current company if backup creation fails during reset',()=>{
    const storage=memory(),store=new SaveStore(()=>storage);store.write(newGame(9));const raw=storage.getItem(SAVE_KEY);
    storage.setItem=()=>{throw Error('blocked')};expect(store.clear()).toBe(false);expect(storage.getItem(SAVE_KEY)).toBe(raw);
  });
});

describe('one settlement per expedition',()=>{
  it('finishes a migrated v1 pending expedition with the same gameplay result',()=>{
    const current=newGame(14),plan=planFor(current);beginDelve(current,plan);
    const old:any=JSON.parse(JSON.stringify(current));old.version=1;delete old.revision;delete old.milestones;delete old.bossDryStreak;delete old.pending.id;
    const migrated=decodeSave(JSON.stringify(old)).state!,a=finishPending(current)!,b=finishPending(migrated)!;
    expect(b.result).toEqual(a.result);expect(migrated.roster).toEqual(current.roster);expect(migrated.coin).toBe(current.coin);expect(migrated.pending).toBeUndefined();
  });
  it('refuses duplicated party IDs and an overlapping expedition',()=>{
    const s=newGame(1),plan=planFor(s);expect(planProblem(s,{...plan,partyIds:[plan.leaderId,plan.leaderId]})).toMatch(/once/);
    beginDelve(s,plan);expect(()=>beginDelve(s,plan)).toThrow(/under way/);
  });
  it('rejects the same result after settlement, including after a save round trip',()=>{
    const s=newGame(3),plan=planFor(s),out=delve(s,plan),id=s.lastReceipt!.id,coin=s.coin;
    expect(out.receipt.waystoneBefore).toBe(TIERS.I.floors[0]);
    expect(()=>settleDelve(s,plan,out.result,id)).toThrow(/already settled/);expect(s.coin).toBe(coin);expect(s.runs).toBe(1);
    const reloaded=decodeSave(JSON.stringify(s)).state!;
    expect(()=>settleDelve(reloaded,plan,out.result,id)).toThrow(/already settled/);expect(finishPending(reloaded)).toBeNull();expect(reloaded.runs).toBe(1);
  });
});
