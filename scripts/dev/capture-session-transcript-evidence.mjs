import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const work = 'eaaf207a-a655-4968-ade3-92909cbb83c5';
const run = 'd1fca21d-e75f-48b1-9be5-4ca8532b402d';
const pageUrl = `http://127.0.0.1:3001/works/${work}?tab=overview&run=${run}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
await page.getByTestId('session-transcripts').waitFor({ timeout: 60_000 });
await page.getByTestId('session-transcripts').scrollIntoViewIfNeeded();

for (const name of ['analyst', 'builder', 'lead']) {
  await page.getByTestId('session-role-nav').getByRole('button', { name: new RegExp(name, 'i') }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `/workspace/transcript-${name}.png` });
}

await page.getByTestId('session-role-nav').getByRole('button', { name: /lead/i }).click();
const stream = page.getByTestId('transcript-stream');
await stream.scrollIntoViewIfNeeded();
await page.screenshot({ path: '/workspace/transcript-lead-body.png' });

const metrics = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="transcript-activity-row"]')];
  const prose = document.querySelector('[data-testid="transcript-prose"]');
  const streamItems = [...document.querySelectorAll('.transcript__item')];
  const ordinals = new Set(streamItems.flatMap((item) => (item.dataset.sourceOrdinals ?? '').split(',').filter(Boolean).map(Number)));
  const activityItems = [...document.querySelectorAll('.transcript__item--activity')];
  const gaps = activityItems.flatMap((item, index) => {
    const previous = activityItems[index - 1];
    if (!previous || previous.nextElementSibling !== item) return [];
    const before = previous.querySelector('[data-testid="transcript-activity-row"]')?.getBoundingClientRect();
    const after = item.querySelector('[data-testid="transcript-activity-row"]')?.getBoundingClientRect();
    return before && after ? [after.top - before.bottom] : [];
  });
  const rowStyle = rows[0] ? getComputedStyle(rows[0]) : null;
  const proseStyle = prose ? getComputedStyle(prose) : null;
  const navStrong = document.querySelector('[data-testid="session-role-nav"] strong')?.textContent?.trim() ?? '';
  return {
    session: 'lead', raw_entries: 337, rendered_units: streamItems.length,
    rows_above_fold_1440x900: streamItems.filter((item) => item.getBoundingClientRect().top < 900).length,
    collapsed_rows_with_transparent_border: rows.filter((row) => !row.hasAttribute('open') && getComputedStyle(row).borderTopColor === 'rgba(0, 0, 0, 0)').length,
    max_gap_px_between_consecutive_activity_rows: Math.max(0, ...gaps),
    prose_font_size_px: proseStyle ? Number.parseFloat(proseStyle.fontSize) : 0,
    activity_row_font_size_px: rowStyle ? Number.parseFloat(rowStyle.fontSize) : 0,
    prose_border_left_width: proseStyle?.borderLeftWidth ?? '',
    matches_reasoning_started_or_completed: /Reasoning\s+(started|completed)/i.test(document.querySelector('[data-testid="transcript-stream"]')?.textContent ?? ''),
    matches_activity_running: /activity running/i.test(document.querySelector('[data-testid="transcript-stream"]')?.textContent ?? ''),
    left_nav_first_strong_text: navStrong,
    page_contains_addressed_by_role_name: document.body.textContent?.includes('addressed by role name') ?? false,
    source_ordinal_coverage: ordinals.size,
  };
});
await writeFile('/workspace/transcript-metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics));
await browser.close();
