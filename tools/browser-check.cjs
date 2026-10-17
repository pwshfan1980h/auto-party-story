// Desktop integration checks. Optional CHROMIUM_PATH selects an existing system browser.
const {chromium,firefox}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const port=Number(process.env.APS_TEST_PORT||5189),url=`http://127.0.0.1:${port}`,out='reports/desktop';
fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(out+'/failure.json'))fs.renameSync(out+'/failure.json',out+`/failure-${Date.now()}.json`);
function sourceHash(){const hash=require('node:crypto').createHash('sha256');const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=dir+'/'+e.name;if(e.isDirectory())visit(file);else{hash.update(file);hash.update(fs.readFileSync(file))}}};visit('src');visit('data');return hash.digest('hex')}
const candidateHash=sourceHash();
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
const results=[];let browser;
let active={engine:null,case:'starting server'};
const diagnostics={};
function publishSummary(error){
  if(!process.env.GITHUB_STEP_SUMMARY)return;
  const lines=['## Desktop browser checks',error?'Failed':'Passed',`Source: ${candidateHash}`,
    `Current browser: ${active.engine||'not launched'}; case: ${active.case}`,
    ...Object.keys(diagnostics).map(engine=>`${engine}: ${results.filter(r=>r.engine===engine&&r.passed).length} completed scenarios`),
    '', '```json',JSON.stringify(diagnostics,null,2),'```'];
  if(error)lines.push('','```text',String(error.stack||error).slice(0,12000),'```');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return}catch{}if(server.exitCode!==null)break;await wait(200)}throw Error('Test server unavailable: '+serverLog)}
async function check(engine){
  active={engine,case:'launch browser'};
  const errors=[];
  browser=await ({chromium,firefox}[engine]).launch(engine==='chromium'?{executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']}:{headless:true,firefoxUserPrefs:{'webgl.force-enabled':true}});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
  await p.goto(url);
  diagnostics[engine]={version:browser.version(),pageErrors:errors,graphics:await p.evaluate(()=>{
    const gl=document.createElement('canvas').getContext('webgl2');
    const info={webgl2:!!gl,userAgent:navigator.userAgent};
    gl?.getExtension('WEBGL_lose_context')?.loseContext();return info;
  })};
  const entry=async(label,fn)=>{active={engine,case:label};await fn();results.push({engine,case:label,passed:true});console.log(engine+': '+label)};
  async function fixture(kind='fresh',speed=.75,motion=true){
    await p.evaluate(async({kind,speed,motion})=>{
      const{newGame,candidate}=await import('/src/game/state.ts');
      const{updatePreferences}=await import('/src/game/preferences.ts');
      const s=newGame(1);
      if(kind!=='fresh'){s.unlocked=2;s.waystones={III:11};s.camp=['lamplighter','academy'];s.coin=3000;s.roster.push(candidate(s,30,'mage'));for(const h of s.roster)h.hero={...h.hero,level:30,leadership:1};s.roster[0].hero.raceId='orc'}
      if(kind==='resources')for(const h of s.roster)h.hero.raceId='orc';
      if(kind==='recovery')s.roster=['rogue','mage','ranger','bard'].map(c=>candidate(s,12,c));
      if(kind==='rebuild'){s.waystones={I:3};s.roster.forEach(h=>h.hero.level=1);s.coin=40}
      localStorage.removeItem('aps-save-v1');localStorage.setItem('aps-save-v1',JSON.stringify(s));updatePreferences({guideSeen:true,reducedMotion:motion,speed});
    },{kind,speed,motion});await p.reload();
  }
  async function drive(){return p.evaluate(()=>{let n=0;while(window.__game.player&&n++<500){const pl=window.__game.player;if(pl.councilOpen)document.querySelector('.council-panel button:not(:disabled)')?.click();pl.skipFight();window.__game.step(3)}return{iterations:n,receipt:window.__game.state.lastReceipt,pending:!!window.__game.state.pending}})}
  await entry('fresh expedition, truthful receipt, settled once',async()=>{
    await fixture();await p.getByRole('button',{name:'Delve',exact:true}).click();const r=await drive();assert(!r.pending);await p.locator('.run-recap').waitFor();assert.equal(await p.locator('.run-recap').count(),1);assert.equal(await p.locator('.recap-metrics strong').first().innerText(),'+'+r.receipt.banked.toLocaleString());
    await p.screenshot({path:`${out}/${engine}-return.png`,fullPage:true});
  });
  await entry('persistent preferences across two expeditions and reload',async()=>{
    await fixture('final');await p.locator('.global-settings summary').click();await p.getByLabel('Default battle speed',{exact:true}).selectOption('4');await p.getByLabel('Battle camera',{exact:true}).uncheck();await p.getByLabel('Clarity: show damage numbers',{exact:true}).check();
    for(let i=0;i<2;i++){await p.getByRole('button',{name:'Delve',exact:true}).click();const opts=await p.evaluate(()=>({speed:window.__game.player?.speed,camera:window.__game.player?.opts.camera,clarity:window.__game.player?.opts.clarity}));assert.deepEqual(opts,{speed:4,camera:'off',clarity:true});await drive();await p.locator('.run-recap').waitFor();await p.getByRole('button',{name:'Back to Torchwatch',exact:true}).click()}
    await p.reload();assert.equal(await p.getByLabel('Default battle speed',{exact:true}).inputValue(),'4');
  });
  await entry('away completion has no repeated settlement',async()=>{
    await fixture();await p.getByRole('button',{name:'Delve',exact:true}).click();await p.reload();await p.locator('.run-recap').waitFor();assert(await p.getByText('The company carried on while the page was closed.',{exact:false}).isVisible());const runs=await p.evaluate(()=>window.__game.state.runs);await p.reload();assert.equal(await p.evaluate(()=>window.__game.state.runs),runs);
  });
  await entry('first final clear, choice survives reload, persistent company standard',async()=>{
    await fixture('final');await p.locator('.plan select').first().selectOption('III');await p.locator('.plan select').nth(1).selectOption('depth');await p.locator('.plan input[type=checkbox]').check();await p.getByRole('button',{name:'Delve',exact:true}).click();const r=await drive();assert(r.receipt.firstFinalClear);await p.locator('.run-recap').waitFor();assert.equal(await p.locator('.run-recap h1').innerText(),'The depths remember your name.');await p.screenshot({path:`${out}/${engine}-final.png`,fullPage:true});await p.reload();assert.equal(await p.locator('.town-standard').count(),1);assert.equal(await p.locator('.unclaimed-reward').count(),1);await p.getByRole('button',{name:'Review last return',exact:true}).click();await p.locator('.reward-cards button').first().click();const stash=await p.evaluate(()=>window.__game.state.stash);await p.reload();assert.deepEqual(await p.evaluate(()=>window.__game.state.stash),stash);assert.equal(await p.locator('.unclaimed-reward').count(),0);
  });
  await entry('victory hold uses real time at every speed and can be skipped',async()=>{
    for(const speed of [.5,.75,1,2,4]){
      await fixture('final',speed,false);await p.locator('.plan select').first().selectOption('III');await p.locator('.plan select').nth(1).selectOption('depth');await p.locator('.plan input[type=checkbox]').check();await p.getByRole('button',{name:'Delve',exact:true}).click();const timing=await p.evaluate(skip=>new Promise((resolve,reject)=>{
        let start=0,skipped=false;const timeout=setTimeout(()=>{observer.disconnect();reject(Error('Victory presentation did not finish'))},15000);
        const observer=new MutationObserver(()=>{const button=[...document.querySelectorAll('#orders button')].find(b=>b.textContent==='Show results');if(button&&!start){start=performance.now();if(skip)setTimeout(()=>{if(button.isConnected){skipped=true;button.click()}},100)}if(document.querySelector('.run-recap')&&start){observer.disconnect();clearTimeout(timeout);resolve({holdMs:performance.now()-start,skipped,pending:!!window.__game.state.pending})}});
        observer.observe(document.body,{subtree:true,childList:true});let n=0;while(window.__game.player&&n++<500){const pl=window.__game.player;if(pl.councilOpen)document.querySelector('.council-panel button:not(:disabled)')?.click();pl.skipFight();window.__game.step(3)}
      }),speed===4);assert.equal(timing.pending,false);if(speed===4)assert(timing.skipped);else assert(timing.holdMs>=2850);results.push({engine,case:'victory duration',speed,...timing});
    }
  });
  await entry('boss scene survives a delayed return to the tab',async()=>{
    await fixture('final',.5,false);await p.locator('.plan select').first().selectOption('III');await p.locator('.plan select').nth(1).selectOption('depth');await p.locator('.plan input[type=checkbox]').check();await p.getByRole('button',{name:'Delve',exact:true}).click();
    await p.evaluate(()=>{let n=0;while(window.__game.player&&n++<100){const pl=window.__game.player;if(pl.replay?.setup.roomType==='boss'){pl.skipFight();window.__game.step(.01);pl.wait=99;return}if(pl.councilOpen){document.querySelector('.council-panel button:not(:disabled)')?.click();continue}pl.skipFight();window.__game.step(3)}throw Error('No boss scene')});
    await wait(5300);assert(await p.getByText('BOSS DEFEATED',{exact:false}).isVisible());await drive();await p.locator('.run-recap').waitFor();
  });
  await entry('three consecutive delves release battle graphics resources',async()=>{
    await fixture('resources',4,true);
    await p.locator('.plan select').first().selectOption('III');
    await p.locator('.plan select').nth(1).selectOption('depth');
    await p.locator('.plan input[type=checkbox]').check();
    const samples=[];
    for(let run=0;run<3;run++){
      // Recovery remains part of the shipped flow, even in this high-level graphics fixture.
      const rest=p.getByRole('button',{name:'Rest a while (everyone recovers a little)',exact:true});
      for(let i=0;i<3&&await rest.isVisible();i++)await rest.click();
      await p.getByRole('button',{name:'Suggest a balanced party',exact:true}).click();
      assert(await p.getByRole('button',{name:'Delve',exact:true}).isEnabled(),await p.locator('.plan').innerText());
      await p.getByRole('button',{name:'Delve',exact:true}).click();
      const sample=await p.evaluate(()=>{
        let scene,n=0;
        while(window.__game.player&&n++<500){
          const player=window.__game.player;
          if(player.replay)scene=player.replay.scene;
          if(player.councilOpen){document.querySelector('.council-panel button:not(:disabled)')?.click();continue}
          player.skipFight();window.__game.step(3);
        }
        if(window.__game.player||!scene)throw Error('Resource check did not complete a battle');
        return{run:window.__game.state.runs,...scene.renderer.info.memory,programs:scene.renderer.info.programs.map(p=>({name:p.name,usedTimes:p.usedTimes,cacheKey:p.cacheKey}))};
      });
      assert(sample.geometries<=4,`Battle geometries retained after results: ${sample.geometries}`);
      assert(sample.textures<=2,`Battle textures retained after results: ${sample.textures}`);
      samples.push(sample);
      fs.writeFileSync(`${out}/${engine}-resource-lifetime.json`,JSON.stringify({sourceHash:candidateHash,samples},null,2));
      await p.getByRole('button',{name:'Back to Torchwatch',exact:true}).click();
    }
    // The shared unit material keeps compiled lighting variants; owned geometry and textures must return to baseline.
    assert.equal(samples[2].geometries,samples[0].geometries);
    assert.equal(samples[2].textures,samples[0].textures);
  });
  await entry('settled expeditions cancel delayed room and ultimate sounds',async()=>{
    await fixture('resources',4,true);
    await p.evaluate(async()=>{
      const{sfx}=await import('/src/audio/sfx.ts');const room=sfx.room.bind(sfx),explosion=sfx.explosion.bind(sfx);
      window.__lateSounds=[];
      sfx.room=(...args)=>{if(!window.__game.player)window.__lateSounds.push('room');return room(...args)};
      sfx.explosion=(...args)=>{if(!window.__game.player)window.__lateSounds.push('ultimate');return explosion(...args)};
    });
    await p.getByRole('button',{name:'Delve',exact:true}).click();
    assert(await p.evaluate(async()=>{const{sfx}=await import('/src/audio/sfx.ts');sfx.ult(0,'fire');return sfx.battleTimers.size>0}));
    await drive();await p.locator('.run-recap').waitFor();
    await wait(1000);assert.deepEqual(await p.evaluate(()=>window.__lateSounds),[]);
  });
  await entry('keyboard targeting, cancellation, rejection, accepted cost and cooldown',async()=>{
    await fixture('final',.5,true);await p.locator('.plan select').first().selectOption('III');await p.locator('.plan select').nth(1).selectOption('depth');await p.locator('.plan input[type=checkbox]').check();await p.getByRole('button',{name:'Delve',exact:true}).click();await p.evaluate(()=>{let n=0;while(window.__game.player&&!window.__game.player.replay&&n++<50){if(window.__game.player.councilOpen)document.querySelector('.council-panel button:not(:disabled)')?.click();window.__game.step(3)}if(window.__game.player)window.__game.player.speed=0});await p.locator('[data-order=mend]').waitFor();
    await p.locator('[data-order=mend]').focus();await p.keyboard.press('Enter');assert.equal(await p.getByLabel('Target for Mend').evaluate(e=>document.activeElement===e),true);await p.keyboard.press('Escape');assert(await p.locator('[data-order=mend]').evaluate(e=>document.activeElement===e));
    await p.keyboard.press('Enter');await p.getByRole('button',{name:'Confirm Mend',exact:true}).focus();await p.keyboard.press('Enter');assert.match(await p.locator('.order-flash').innerText(),/already healthy/);
    await p.locator('[data-order=hold]').focus();await p.keyboard.press('Enter');assert.match(await p.locator('.order-flash').innerText(),/accepted.*2 embers/);assert(await p.locator('[data-order=hold]').isDisabled());assert(await p.locator('.order-flash').getAttribute('role')==='status');
  });
  await entry('promotion portrait and paid service',async()=>{
    await fixture('final');const before=await p.locator('.roster img.portrait').first().getAttribute('src');await p.getByRole('button',{name:'Train',exact:true}).first().click();await p.getByRole('button',{name:'Train as Knight',exact:true}).click();assert.notEqual(await p.locator('.roster img.portrait').first().getAttribute('src'),before);await p.getByRole('button',{name:'Gear',exact:true}).first().click();const coin=await p.evaluate(()=>window.__game.state.coin);await p.getByRole('button',{name:/^Service gear/}).click();assert(await p.evaluate(()=>window.__game.state.coin)<coin);
  });
  await entry('direct recovery recruitment buys and selects the missing roles',async()=>{
    await fixture('recovery');const before=await p.evaluate(()=>window.__game.state.coin);await p.getByRole('button',{name:/^Recruit Cleric & prepare/}).click();await p.getByRole('button',{name:/^Recruit Fighter & prepare/}).click();const current=await p.evaluate(()=>({coin:window.__game.state.coin,classes:window.__game.state.roster.map(h=>h.hero.classId),selected:[...document.querySelectorAll('.roster .card.picked .who')].map(e=>e.textContent)}));assert(current.coin<before);assert(current.classes.includes('cleric')&&current.classes.includes('fighter'));assert(current.selected.some(x=>/Cleric/.test(x)));assert(current.selected.some(x=>/Fighter/.test(x)));await p.screenshot({path:`${out}/${engine}-recovery.png`,fullPage:true});
  });
  await entry('old boss waystones offer an entrance route for a rebuilding party',async()=>{
    await fixture('rebuild');await p.locator('.plan input[type=checkbox]').check();assert(await p.getByText('Start at the entrance while rebuilding',{exact:false}).isVisible());await p.getByRole('button',{name:'Prepare an entrance recovery route',exact:true}).click();assert(!await p.locator('.plan input[type=checkbox]').isChecked());await p.getByRole('button',{name:'Delve',exact:true}).click();assert.equal(await p.evaluate(()=>window.__game.state.pending.plan.fromWaystone),false);
  });
  await entry('save export/import, invalid import preserves original',async()=>{
    await fixture('final');const downloadPromise=p.waitForEvent('download');await p.getByRole('button',{name:'Export save',exact:true}).click();const download=await downloadPromise;const raw=fs.readFileSync(await download.path(),'utf8');assert(JSON.parse(raw).roster.length===4);const old=await p.evaluate(()=>localStorage.getItem('aps-save-v1'));
    await p.getByLabel('Choose a saved company').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"version":1}')});assert.equal(await p.evaluate(()=>localStorage.getItem('aps-save-v1')),old);
    const imported=JSON.parse(raw);imported.coin=4321;await p.getByLabel('Choose a saved company').setInputFiles({name:'company.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await p.waitForFunction(()=>window.__game?.state?.coin===4321);assert(await p.evaluate(()=>!!localStorage.getItem('aps-save-backup')));
  });
  await entry('desktop widths, reduced motion and all recap variants',async()=>{
    for(const outcome of ['retreat','cleared','wipe'])for(const variant of ['ordinary','costly','first','final','away']){
      await p.evaluate(async({outcome,variant})=>{const{newGame}=await import('/src/game/state.ts');const{renderRunRecap}=await import('/src/ui/runRecap.ts');const s=newGame(5),receipt={id:'5:0',run:1,tier:'I',outcome,banked:outcome==='wipe'?0:100,balance:140,firstClear:variant==='first'||variant==='final',firstFinalClear:variant==='final',heroes:s.roster.map(h=>({id:h.hero.id,name:h.hero.name,classId:h.hero.classId,raceId:h.hero.raceId,levelBefore:1,levelAfter:2,xpBefore:0,xpAfter:5,xpGained:50,leadershipBefore:3,leadershipAfter:3,fallen:outcome==='wipe'||variant==='costly'&&h===s.roster[0],carried:false})),gear:[],newRaces:[],volunteers:[],waystoneBefore:0,waystoneAfter:outcome==='wipe'?0:2,floor:2,rooms:4,fights:2,fightsWon:outcome==='wipe'?0:2,returnReason:'The company is hurt.',ledger:['Floor 2: returned']};renderRunRecap(document.getElementById('app'),s,receipt,()=>{}, {away:variant==='away'})},{outcome,variant});
      for(const viewport of [{width:1024,height:768},{width:1280,height:800},{width:1440,height:900}]){await p.setViewportSize(viewport);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
    }
  });
  await entry('production audio signals, one shared context, persistent mute and no autoplay',async()=>{
    await fixture();
    const audio=await p.evaluate(async()=>{
      const{cues,scheduleCue}=await import('/src/audio/cues.ts');const{sfx}=await import('/src/audio/sfx.ts');
      const metrics=[];for(const[key,cue]of Object.entries(cues)){const ctx=new OfflineAudioContext(1,Math.ceil((cue.duration+.1)*44100),44100);scheduleCue(ctx,ctx.destination,key,0);const b=await ctx.startRendering(),samples=b.getChannelData(0);let peak=0,energy=0;for(const x of samples){peak=Math.max(peak,Math.abs(x));energy+=x*x}metrics.push({key,peak,rms:Math.sqrt(energy/samples.length),tail:Math.abs(samples[samples.length-1])})}
      return{metrics,contextsBefore:sfx.ctx?1:0};
    });assert.equal(audio.contextsBefore,0);for(const cue of audio.metrics){assert(cue.peak>0&&cue.peak<.98);assert(cue.rms>0);assert(cue.tail<.001)}fs.writeFileSync(`${out}/${engine}-audio.json`,JSON.stringify(audio,null,2));
    await p.locator('.global-settings summary').click();await p.getByRole('button',{name:'Preview return sound',exact:true}).click();const first=await p.evaluate(async()=>{const{sfx}=await import('/src/audio/sfx.ts');window.__audioContext=sfx.ctx;return sfx.ctx.state});assert(['running','suspended'].includes(first));await p.getByRole('button',{name:'Preview return sound',exact:true}).click();assert(await p.evaluate(async()=>{const{sfx}=await import('/src/audio/sfx.ts');return sfx.ctx===window.__audioContext}));await p.getByLabel('Sound enabled',{exact:true}).uncheck();assert(await p.evaluate(async()=>{const{sfx}=await import('/src/audio/sfx.ts');return sfx.muted&&!sfx.cueBus}));await p.reload();assert.equal(await p.locator('#sound').innerText(),'Sound off');
  });
  await entry('damaged and future saves kept intact',async()=>{
    for(const raw of ['{"version":1}','{"version":99}']){await p.evaluate(raw=>localStorage.setItem('aps-save-v1',raw),raw);await p.reload();assert(await p.getByRole('heading',{name:'Your company needs a little care.'}).isVisible());assert.equal(await p.evaluate(()=>localStorage.getItem('aps-save-v1')),raw)}
  });
  await entry('stale tab cannot overwrite a newer company',async()=>{
    await fixture();const second=await context.newPage();await second.goto(url);await p.getByRole('button',{name:'Hire',exact:false}).filter({hasText:'Hire ·'}).first().click().catch(async()=>{await p.locator('.board button').first().click()});await second.getByRole('button',{name:'Reload newer company',exact:true}).waitFor();assert(await second.locator('#app').evaluate(e=>e.inert));await second.close();
  });
  for(const failure of ['storage','webgl','audio'])await entry(failure+' unavailable is recoverable',async()=>{
    const c=await browser.newContext();await c.addInitScript(failure=>{
      if(failure==='storage')Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError')};
      if(failure==='webgl'){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args)}}
      if(failure==='audio'){window.AudioContext=class{constructor(){throw Error('No audio device')}};window.webkitAudioContext=undefined}
    },failure);const q=await c.newPage();q.on('dialog',d=>d.accept());q.on('pageerror',e=>errors.push(e.message));await q.goto(url);assert(await q.getByRole('button',{name:'Delve',exact:true}).isVisible());if(failure==='storage')assert(await q.locator('.save-warning').isVisible());await q.getByRole('button',{name:'Delve',exact:true}).click();if(failure==='webgl'){assert.equal(await q.evaluate(()=>!!window.__game.state.pending),false);assert(!await q.evaluate(()=>document.body.classList.contains('delving')))}else assert(await q.evaluate(()=>!!window.__game.state.pending));await c.close();
  });
  assert.deepEqual(errors,[]);await context.close();await browser.close();browser=null;
}
(async()=>{try{await ready();for(const engine of (process.env.APS_BROWSERS||'chromium').split(','))await check(engine);fs.writeFileSync(out+'/checks.json',JSON.stringify({at:new Date().toISOString(),sourceHash:candidateHash,diagnostics,results},null,2));publishSummary()}finally{if(browser)await browser.close();server.kill()}})().catch(e=>{fs.writeFileSync(out+'/failure.json',JSON.stringify({at:new Date().toISOString(),sourceHash:candidateHash,active,diagnostics,error:e.stack,results},null,2));publishSummary(e);console.error(e);process.exitCode=1});
