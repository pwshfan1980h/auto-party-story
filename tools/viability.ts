import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runFight} from '../src/sim/fight';
import {buildEncounter} from '../src/sim/encounter';
import {party} from '../src/sim/presets';
import {stream} from '../src/sim/rng';
import {TIERS} from '../src/sim/data';
import {evidence,wilson} from './evidence';
const args=process.argv.slice(2),opt=(k:string,d:string)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]},n=+opt('seeds','100'),start=+opt('from','0'),out=opt('out',`reports/viability-${Date.now()}`);
if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(start))throw Error('Invalid sample');
const tier='III',rows=[],source=evidence();
for(const sustain of ['cleric','apothecary','minstrel']){
 let wins=0,deaths=0;
 for(let seed=start;seed<start+n;seed++){
  // All parties are level ten: the actual minimum level for the two trained alternatives.
  const heroes=party(['fighter',sustain,'ranger','mage'],tier).map(h=>({...h,level:10}));
  const result=runFight({seed,key:['viability',tier],tier,roomType:'boss',heroes,monsters:buildEncounter(tier,'boss',TIERS[tier].floors[0]+1,stream(seed,'viability',tier)),mode:'batch'});
  wins+=+(result.result==='victory');deaths+=result.died.length;
 }
 const row={tier,sustain,level:10,n,wins,winRate:wins/n,win95:wilson(wins,n),deathsPerFight:deaths/n};rows.push(row);console.log(JSON.stringify(row));
}
const target=.5,failures=rows.some(r=>r.sustain!=='cleric'&&r.winRate>=target)?[]:['No alternative sustain party reached the 50% boss-win target'];
const exitCode=args.includes('--gate')&&failures.length?1:0;
mkdirSync(out,{recursive:true});writeFileSync(join(out,'report.json'),JSON.stringify({...source,start,n,party:['fighter','sustain','ranger','mage'],room:'boss',target,rows,failures,gate:{enabled:args.includes('--gate'),passed:!failures.length,exitCode}},null,2));
process.exitCode=exitCode;
