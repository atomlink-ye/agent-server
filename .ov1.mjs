import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const OUT='/tmp/overify'; const BASE='http://127.0.0.1:3001';
await mkdir(OUT,{recursive:true});
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
const log=[];
p.on('console',m=>{if(m.type()==='error')log.push(m.text().slice(0,120));});

// 1. 建新 Coworker
await p.goto(BASE+'/agents',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
const nc=p.getByRole('button',{name:/New Coworker/i}).first();
await nc.click(); await p.waitForTimeout(1200);
await p.screenshot({path:OUT+'/01-new-form.png'});

// 填表单
const fill=async(re,val)=>{const f=p.getByLabel(re).first();
  if(await f.count()){await f.fill(val);return true;} return false;};
console.log('name:',await fill(/name/i,'Nova'));
console.log('role:',await fill(/role/i,'Project Researcher'));
console.log('summary:',await fill(/summary|descri/i,'Keeps project conclusions in her own working notes.'));
await p.waitForTimeout(400);
await p.screenshot({path:OUT+'/02-filled.png'});

// 提交
for(const re of [/Create & Chat/i,/^Create$/i,/Create Coworker/i]){
  const btn=p.getByRole('button',{name:re}).first();
  if(await btn.count() && await btn.isEnabled()){await btn.click();console.log('clicked',re);break;}
}
await p.waitForTimeout(6000);
await p.screenshot({path:OUT+'/03-created.png'});
console.log('URL after create:', p.url());
console.log('errors:', log.slice(0,3));
await b.close();
