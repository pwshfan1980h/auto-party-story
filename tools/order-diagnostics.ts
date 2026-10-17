import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildEncounter} from '../src/sim/encounter';
import {GOOD_POLICY,runFight,type OrderKind} from '../src/sim/fight';
import {party,PRESETS} from '../src/sim/presets';
import {TIERS} from '../src/sim/data';
import {stream} from '../src/sim/rng';
import {evidence,interval,wilson} from './evidence';
import {TARGETS} from './metrics';
export function orderGate(deathCut:number,cells:{noneDiff:[number,number];spamDiff:[number,number];difference:number}[],good:number,spam:number){
  const failures:string[]=[];
  if(deathCut<TARGETS.ordersDeathCut)failures.push(`Good-order death reduction ${deathCut} is below ${TARGETS.ordersDeathCut}`);
  if(good>=spam)failures.push('Good orders must save more lives than spam in aggregate');
  for(const [i,c]of cells.entries())if(c.noneDiff[0]>0||c.spamDiff[0]>0||c.difference>.1)failures.push(`Cell ${i}: harmful orders (paired 95% interval or >0.1 excess deaths/fight)`);
  return failures;
}
function main(){
  const args=process.argv.slice(2),opt=(k:string,d:string)=>{const at=args.indexOf('--'+k);return at<0?d:args[at+1]};
  const n=+opt('seeds','200'),start=+opt('from','0'),tiers=opt('tier','II,III').split(','),out=opt('out',`reports/orders-${Date.now()}`);
  if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(start)||start<0||tiers.some(t=>!TIERS[t]))throw Error('Invalid sample arguments');
  const variants=['none','good','spam',...(args.includes('--quick')?[]:Object.keys(GOOD_POLICY).map(k=>'without-'+k))];
  const source=evidence();
  const rows=[],traces=[],totals={none:0,good:0,spam:0};let invalid=0;
  const cells:{tier:string;room:string;noneDiff:[number,number];spamDiff:[number,number];difference:number;samples:Record<string,number[]>}[]=[];
  for(const tier of tiers)for(const room of ['elite','boss'] as const){
    const samples:Record<string,number[]>={};
    for(const variant of variants){
      for(const k of Object.keys(GOOD_POLICY) as (keyof typeof GOOD_POLICY)[])GOOD_POLICY[k]=variant!=='without-'+k;
      let wins=0,deaths=0,lapsed=0,overheal=0,healed=0,interrupts=0;const issued:Partial<Record<OrderKind,number>>={},rejected:Record<string,number>={};samples[variant]=[];
      for(let seed=start;seed<start+n;seed++){
        const r=runFight({seed,key:['o',tier,room],tier,roomType:room,heroes:party(PRESETS.starter,tier),monsters:buildEncounter(tier,room,TIERS[tier].floors[0]+1,stream(seed,'enc-o',tier,room)),embers:3,mode:'full',orderPolicy:variant==='none'?'none':variant==='spam'?'spam':'good',leader:{heroId:'fighter0',rank:'seasoned',noise:.15,temperament:'stubborn'}});
        wins+=+(r.result==='victory');deaths+=r.died.length;lapsed+=r.orders.lapsed;samples[variant].push(r.died.length);
        if(r.result==='timeout'||r.units.some(u=>!Number.isFinite(u.hp)))invalid++;
        for(const u of r.units.filter(u=>u.team===0)){overheal+=u.overheal;healed+=u.healed}
        interrupts+=r.events.filter(e=>e.type==='interrupted'&&r.units.some(u=>u.id===e.unit&&u.team===1)).length;
        for(const[k,v]of Object.entries(r.orders.issued))issued[k as OrderKind]=(issued[k as OrderKind]??0)+v;
        for(const[k,v]of Object.entries(r.orders.rejected))rejected[k]=(rejected[k]??0)+v;
        if(r.orders.trace.length)traces.push({tier,room,variant,seed,orders:r.orders.trace,actors:r.events.filter(e=>e.type==='order'&&e.outcome==='obeyed')});
      }
      if(variant==='none'||variant==='good'||variant==='spam')totals[variant]+=deaths;
      const row={tier,room,variant,n,wins,win95:wilson(wins,n),deaths,deathsPerFight:deaths/n,lapsed,issued,rejected,healed,overheal,interrupts};rows.push(row);console.log(JSON.stringify(row));
    }
    const good=samples.good,noneDiff=interval(good.map((v,i)=>v-samples.none[i])),spamDiff=interval(good.map((v,i)=>v-samples.spam[i]));
    cells.push({tier,room,noneDiff,spamDiff,difference:good.reduce((s,v,i)=>s+v-samples.none[i],0)/n,samples});
  }
  for(const k of Object.keys(GOOD_POLICY) as (keyof typeof GOOD_POLICY)[])GOOD_POLICY[k]=true;
  const deathCut=1-totals.good/Math.max(1,totals.none),failures=orderGate(deathCut,cells,totals.good,totals.spam);
  const baseline=Array.from({length:n},(_,i)=>cells.reduce((s,c)=>s+c.samples.none[i],0)),good=Array.from({length:n},(_,i)=>cells.reduce((s,c)=>s+c.samples.good[i],0)),ratio=totals.good/Math.max(1,totals.none);
  const residual=interval(good.map((v,i)=>v-ratio*baseline[i])),half=(residual[1]-residual[0])/2/(totals.none/n),deathCut95=[deathCut-half,deathCut+half];
  if(deathCut95[0]<=0)failures.push('The paired 95% interval does not establish a benefit');
  if(invalid)failures.push(`${invalid} invalid/timeout fights`);
  mkdirSync(out,{recursive:true});writeFileSync(join(out,'report.json'),JSON.stringify({...source,n,start,tiers,party:PRESETS.starter,initialEmbers:3,target:TARGETS.ordersDeathCut,deathCut,deathCut95,totals,failures,gate:{enabled:args.includes('--gate'),passed:!failures.length,exitCode:args.includes('--gate')&&failures.length?1:0},rows,cells},null,2));
  writeFileSync(join(out,'timing.json'),JSON.stringify(traces));console.log(JSON.stringify({deathCut,failures}));
  if(args.includes('--gate')&&failures.length)process.exitCode=1;
}
if(process.argv[1]?.endsWith('order-diagnostics.ts'))main();
