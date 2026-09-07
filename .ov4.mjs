import { chromium } from 'playwright';
const OUT='/tmp/overify'; const BASE='http://127.0.0.1:3001';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(BASE+'/agents',{waitUntil:'networkidle'});
await p.waitForTimeout(1200);
await p.getByRole('button',{name:/New Coworker/i}).first().click();
await p.waitForTimeout(1200);

await p.getByLabel(/^Name/i).first().fill('Nova');
await p.getByLabel(/^Role/i).first().fill('Project Researcher');
// 关键：这一栏 label 是 "What should this Coworker help with?"
await p.getByLabel(/help with/i).first().fill('Keeps project conclusions in her own working notes.');
await p.waitForTimeout(400);
await p.screenshot({path:OUT+'/07-filled2.png'});

const btn=p.getByRole('button',{name:/Create & Chat/i}).first();
console.log('enabled:', await btn.isEnabled());
await btn.click();
await p.waitForTimeout(7000);
console.log('URL:', p.url());
await p.screenshot({path:OUT+'/08-created2.png'});
await b.close();
