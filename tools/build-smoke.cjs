const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const{createHash}=require('node:crypto');
function buildIdentity(){
  const files=[];const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())visit(path);else files.push(path)}};visit('dist');
  const hash=createHash('sha256');let bytes=0;
  for(const file of files.sort()){const data=fs.readFileSync(file);hash.update(file.slice(5)+'\0');hash.update(data);hash.update('\0');bytes+=data.length}
  return{productionBuildSHA256:hash.digest('hex'),files:files.length,bytes,packageLockSHA256:createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'),runtime:process.version};
}
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5190','--strictPort'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let browser;
(async()=>{try{
  let ready=false;for(let i=0;i<50;i++){try{ready=(await fetch('http://127.0.0.1:5190/')).ok}catch{}if(ready)break;await wait(200)}assert(ready,'Production server did not start');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:5190/')&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
  for(const path of ['/','/viewer.html','/gallery.html']){await page.goto('http://127.0.0.1:5190'+path,{waitUntil:'networkidle'});if(path==='/')await page.getByRole('button',{name:'Delve',exact:true}).waitFor();else assert(await page.locator('canvas').count());assert(await page.locator('body').innerText());results.push({path,passed:true})}
  for(const path of ['/CREDITS.txt','/licenses/three-MIT.txt'])assert((await page.request.get('http://127.0.0.1:5190'+path)).ok());
  assert.deepEqual(errors,[]);fs.mkdirSync('reports/production',{recursive:true});fs.writeFileSync('reports/production/smoke.json',JSON.stringify({at:new Date().toISOString(),...buildIdentity(),browser:browser.version(),errors,results},null,2));console.log(JSON.stringify({errors,results}));
}finally{if(browser)await browser.close();server.kill()}})().catch(e=>{console.error(e);process.exitCode=1});
