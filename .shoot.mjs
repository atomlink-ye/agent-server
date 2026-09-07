import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
const BASE = 'http://127.0.0.1:3001';

const routes = [
  ['home', '/'],
  ['agents', '/agents'],
  ['tasks', '/tasks'],
  ['boards', '/boards'],
  ['work', '/work'],
  ['files', '/files'],
  ['notfound', '/this-route-does-not-exist'],
];

const widths = [
  ['1440', 1440, 900],
  ['900', 900, 900],
  ['mobile', 390, 844],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const [wname, w, h] of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  for (const [rname, path] of routes) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`));
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `${OUT}/${wname}-${rname}.png`,
        fullPage: true,
      });
    } catch (e) {
      problems.push(`${wname}/${rname}: ${String(e).slice(0, 160)}`);
    }
    if (errors.length) problems.push(`${wname}/${rname} console: ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
  await ctx.close();
}

await browser.close();
console.log(problems.length ? problems.join('\n') : 'no console errors, all routes rendered');
