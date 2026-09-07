import { chromium } from 'playwright';
const OUT='/tmp/overify'; const BASE='http://127.0.0.1:3001';
const AG='ac17fa2f-3a1d-42a9-8f1c-ecb3f116269f';
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(BASE+'/agents/'+AG,{waitUntil:'networkidle'});
await p.waitForTimeout(1500);

// 找 Chat 入口
for(const re of [/^Chat$/i,/Message/i,/Open chat/i,/Start chat/i]){
  const btn=p.getByRole('button',{name:re}).first();
  const lnk=p.getByRole('link',{name:re}).first();
  if(await btn.count()){await btn.click().catch(()=>{});break;}
  if(await lnk.count()){await lnk.click().catch(()=>{});break;}
}
await p.waitForTimeout(3000);
console.log('chat url:', p.url());
await p.screenshot({path:OUT+'/04-dm.png'});

const MSG='Please write a short markdown note to your own workspace at notes/workspace-boundary.md using workspace_write. Content: "Agent persistent files are managed by ContextFS; the provider local working directory is not the same as Files." Then call workspace_read to read it back, and workspace_list to confirm it exists. Tell me the path and what you read back.';
const box=p.locator('textarea, [contenteditable=true]').first();
if(await box.count()){await box.click();await box.fill(MSG);await p.waitForTimeout(300);
  await p.keyboard.press('Enter');console.log('sent');}
else console.log('NO INPUT FOUND');
await p.waitForTimeout(3000);
await p.screenshot({path:OUT+'/05-sent.png'});
await b.close();
