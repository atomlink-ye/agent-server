import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://127.0.0.1:3001/conversations/c9307dea-627e-4b2e-9c30-a6dc1c4e696c',{waitUntil:'networkidle'});
await p.waitForTimeout(4000);
await p.screenshot({path:'/tmp/overify/06-reply.png',fullPage:false});
const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');
console.log(t.slice(0,700));
await b.close();
