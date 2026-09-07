import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const OUT='/tmp/nver'; const BASE='http://127.0.0.1:3001';
await mkdir(OUT,{recursive:true});
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(BASE+'/agents',{waitUntil:'networkidle'});
await p.waitForTimeout(1500);
const card=p.locator('.agents-card, [class*=coworker-card], article').first();
if(await card.count()) { await card.click({timeout:5000}).catch(()=>{}); await p.waitForTimeout(2000); }
await p.screenshot({path:OUT+'/profile.png',fullPage:false});
const txt=(await p.locator('body').innerText()).replace(/\s+/g,' ');
console.log('has Context files entry:', /context file|Context Files|files/i.test(txt));
console.log(txt.slice(0,300));
await b.close();
