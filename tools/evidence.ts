import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

export function evidence(){
  const hash=createHash('sha256');
  const digest=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,e.name);if(e.isDirectory())digest(p);else{hash.update(p);hash.update(readFileSync(p))}}};
  digest('src');digest('data');
  let revision='unknown';try{const head=readFileSync('.git/HEAD','utf8').trim();revision=head.startsWith('ref: ')?readFileSync(join('.git',head.slice(5)),'utf8').trim():head}catch{/* content hash identifies working files even in an exported checkout */}
  return{at:new Date().toISOString(),revision,sourceHash:hash.digest('hex'),runtime:process.version};
}
export function interval(values:number[]):[number,number]{
  const n=values.length,mean=values.reduce((s,v)=>s+v,0)/n;
  if(n<2)return[-Infinity,Infinity];
  const se=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(n-1)/n);
  return[mean-1.96*se,mean+1.96*se];
}
export function wilson(wins:number,n:number):[number,number]{const z=1.96,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return[c-h,c+h]}
