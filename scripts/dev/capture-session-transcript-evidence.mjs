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

async function exerciseExpandableRow(kind) {
  const row = stream.locator(`[data-transcript-row-kind="${kind}"][data-transcript-row-mode="expandable"]`).first();
  if (!await row.count()) throw new Error(`No expandable ${kind} row was rendered for the lead session`);
  await row.scrollIntoViewIfNeeded();
  const beforeOpen = await row.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
  const beforeBox = await row.boundingBox();
  if (beforeOpen || !beforeBox) throw new Error(`${kind} row was not initially collapsed`);
  await row.locator('summary').click();
  await page.waitForTimeout(50);
  const afterOpen = await row.evaluate((element) => element instanceof HTMLDetailsElement && element.open);
  const afterBox = await row.boundingBox();
  const detailTextLength = await row.locator('.transcript__detail').textContent().then((text) => text?.trim().length ?? 0);
  if (!afterOpen || !afterBox || afterBox.height <= beforeBox.height || !detailTextLength)
    throw new Error(`${kind} row did not expand into visible detail`);
  return { before_open: beforeOpen, after_open: afterOpen, before_height: beforeBox.height, after_height: afterBox.height, detail_text_length: detailTextLength };
}

async function exerciseStaticRow() {
  const row = stream.locator('[data-transcript-row-mode="static"]').first();
  if (!await row.count()) throw new Error('No static activity row was rendered for the lead session');
  await row.scrollIntoViewIfNeeded();
  const beforeBox = await row.boundingBox();
  if (!beforeBox) throw new Error('Static activity row has no bounding box');
  await row.click();
  await page.waitForTimeout(50);
  const afterBox = await row.boundingBox();
  if (!afterBox || Math.abs(afterBox.height - beforeBox.height) > 0.5)
    throw new Error('Static activity row changed height after click');
  return { before_height: beforeBox.height, after_height: afterBox.height };
}

const reasoningExpand = await exerciseExpandableRow('reasoning');
const toolExpand = await exerciseExpandableRow('tool');
const staticClick = await exerciseStaticRow();

const metrics = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="transcript-activity-row"]')];
  const prose = document.querySelector('[data-testid="transcript-prose"]');
  const streamItems = [...document.querySelectorAll('.transcript__item')];
  const activityRows = [...document.querySelectorAll('[data-testid="transcript-activity-row"]')];
  const thinkingRows = activityRows.filter((row) => row.querySelector('.transcript__row-copy strong')?.textContent?.trim() === 'Thinking');
  const maxConsecutiveThinking = streamItems.reduce((state, item) => {
    const thinking = item.classList.contains('transcript__item--activity')
      && item.querySelector('.transcript__row-copy strong')?.textContent?.trim() === 'Thinking';
    const current = thinking ? state.current + 1 : 0;
    return { current, max: Math.max(state.max, current) };
  }, { current: 0, max: 0 }).max;
  const normalize = (value) => value.trim().replace(/[.。]+$/u, '').replace(/\s+/gu, ' ').toLocaleLowerCase();
  const duplicatedLabelLines = activityRows.filter((row) => {
    const label = row.querySelector('.transcript__row-copy strong')?.textContent;
    const summary = row.querySelector('.transcript__row-copy small')?.textContent;
    return Boolean(label && summary && normalize(label) === normalize(summary));
  }).length;
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
    // Final rendered DOM units, not raw entries and not an intermediate projection.
    session: 'lead', raw_entries: 337, rendered_units: streamItems.length,
    rendered_unit_breakdown: Object.fromEntries(['assistant', 'activity', 'lifecycle', 'footer'].map((kind) => [kind, document.querySelectorAll(`.transcript__item--${kind}`).length])),
    thinking_rows: thinkingRows.length,
    max_consecutive_thinking: maxConsecutiveThinking,
    duplicated_label_lines: duplicatedLabelLines,
    rows_above_fold_1440x900: streamItems.filter((item) => item.getBoundingClientRect().top < 900).length,
    expandable_rows: rows.filter((row) => row.dataset.transcriptRowMode === 'expandable').length,
    static_rows: rows.filter((row) => row.dataset.transcriptRowMode === 'static').length,
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
metrics.expandability_checks = {
  reasoning: reasoningExpand,
  tool: toolExpand,
  static: staticClick,
};
await writeFile('/workspace/transcript-metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics));
await browser.close();
