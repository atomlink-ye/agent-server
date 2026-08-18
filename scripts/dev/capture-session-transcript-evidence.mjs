import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

import { projectTranscript } from '../../apps/web/features/run-trace/transcript-projection.ts';

const work = process.argv[2] ?? 'eaaf207a-a655-4968-ade3-92909cbb83c5';
const run = process.argv[3] ?? 'd1fca21d-e75f-48b1-9be5-4ca8532b402d';
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
const stream = page.locator('[data-testid="transcript-stream"]:visible');
await stream.scrollIntoViewIfNeeded();
await page.screenshot({ path: '/workspace/transcript-lead-body.png' });

const leadEntries = await page.evaluate(async ({ work, run }) => {
  const response = await fetch(`/api/works/${work}/runs/${run}/session-transcripts`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not reload the transcript: ${response.status}`);
  const body = await response.json();
  return body.sessions.find((session) => session.label.name === 'lead')?.entries ?? [];
}, { work, run });

function toolActivityIdReusesAcrossSequenceRuns(entries) {
  let segment = 0;
  let previousSequence = null;
  const segmentsByActivityId = new Map();
  for (const entry of entries) {
    if (previousSequence !== null && entry.sequence < previousSequence) segment += 1;
    previousSequence = entry.sequence;
    if (entry.kind !== 'tool_status') continue;
    const segments = segmentsByActivityId.get(entry.activity_id) ?? new Set();
    segments.add(segment);
    segmentsByActivityId.set(entry.activity_id, segments);
  }
  return [...segmentsByActivityId.entries()]
    .filter(([, segments]) => segments.size > 1)
    .map(([activity_id, segments]) => ({ activity_id, run_segments: [...segments] }));
}

const reusedToolActivityIds = toolActivityIdReusesAcrossSequenceRuns(leadEntries);
const toolRowsWithDetail = leadEntries.filter((entry) => entry.kind === 'tool_status' && (entry.detail_text || entry.exit_code !== null));
const projectedEntries = projectTranscript(leadEntries);
const projectedRows = (rows) => rows.flatMap((row) => [row, ...projectedRows(row.children ?? [])]);

async function exerciseExpandableRow(kind, expectedDetailText = null) {
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
  const detailText = await row.locator('.transcript__detail pre').textContent();
  const detailTextLength = detailText?.length ?? 0;
  if (!afterOpen || !afterBox || afterBox.height <= beforeBox.height || !detailTextLength)
    throw new Error(`${kind} row did not expand into visible detail`);
  if (expectedDetailText !== null && detailText !== expectedDetailText) {
    const mismatchAt = [...expectedDetailText].findIndex((character, index) => character !== detailText?.[index]);
    const sourceOrdinals = await row.getAttribute('data-detail-source-ordinals');
    throw new Error(`${kind} detail did not contain the full merged text (expected=${expectedDetailText.length}, actual=${detailTextLength}, mismatch_at=${mismatchAt}, source_ordinals=${sourceOrdinals})`);
  }
  return { before_open: beforeOpen, after_open: afterOpen, before_height: beforeBox.height, after_height: afterBox.height, detail_text_length: detailTextLength };
}

async function exerciseStaticToolRow() {
  const row = stream.locator('[data-transcript-row-kind="tool"][data-transcript-row-mode="static"]').first();
  if (!await row.count()) throw new Error('No static tool row was rendered for the lead session');
  await row.scrollIntoViewIfNeeded();
  const tagName = await row.evaluate((element) => element.tagName);
  const isStatic = await row.evaluate((element) => element.classList.contains('transcript__row--static'));
  if (tagName !== 'DIV' || !isStatic) throw new Error('Tool row without detail was rendered as interactive');
  const beforeBox = await row.boundingBox();
  if (!beforeBox) throw new Error('Static tool row has no bounding box');
  await row.click();
  await page.waitForTimeout(50);
  const afterBox = await row.boundingBox();
  if (!afterBox || Math.abs(afterBox.height - beforeBox.height) > 0.5)
    throw new Error('Static tool row changed height after click');
  return { tag_name: tagName, static_class: isStatic, before_height: beforeBox.height, after_height: afterBox.height };
}

const reasoningRow = stream.locator('[data-transcript-row-kind="reasoning"][data-transcript-row-mode="expandable"]').first();
// A parent activity also carries descendant ordinals for A3 coverage. Detail
// correctness must instead use the ordinals that produced the row itself.
const reasoningSourceOrdinals = await reasoningRow.getAttribute('data-detail-source-ordinals');
const expectedReasoningText = projectedRows(projectedEntries).find((entry) => (
  entry.event.kind === 'reasoning_progress'
  && entry.detailSourceOrdinals.join(',') === reasoningSourceOrdinals
))?.event.text ?? null;
if (expectedReasoningText === null)
  throw new Error(`Could not find the projected reasoning row for source ordinals ${reasoningSourceOrdinals}`);
const reasoningExpand = await exerciseExpandableRow('reasoning', expectedReasoningText);
const toolDetailCheck = toolRowsWithDetail.length
  ? { status: 'PASS', ...(await exerciseExpandableRow('tool')) }
  : { status: 'MISSING', reason: 'No tool_status event in the dataset contains detail_text or exit_code.' };
const staticToolClick = await stream.locator('[data-transcript-row-kind="tool"][data-transcript-row-mode="static"]').count()
  ? { status: 'PASS', ...(await exerciseStaticToolRow()) }
  : { status: 'MISSING', reason: 'No ordinary tool_status row is static in this dataset; all tool rows are platform activities.' };
await reasoningRow.hover();
const hoverChevron = await reasoningRow.evaluate((element) => {
  const icon = element.querySelector('.transcript__icon');
  const chevron = element.querySelector('.transcript__chevron');
  return { icon_display: icon ? getComputedStyle(icon).display : '', chevron_display: chevron ? getComputedStyle(chevron).display : '' };
});
if (hoverChevron.icon_display !== 'none' || hoverChevron.chevron_display === 'none')
  throw new Error('Expandable row hover did not replace its icon with a chevron');

const sourcePlatformEntries = leadEntries.filter((entry) => entry.kind === 'tool_status' && entry.tool_name !== null).length;
const metrics = await page.evaluate(({ reusedToolActivityIds, toolRowsWithDetailCount, rawEntryCount, sourcePlatformEntries }) => {
  const transcriptStream = [...document.querySelectorAll('[data-testid="transcript-stream"]')]
    .find((element) => element.getClientRects().length > 0);
  if (!transcriptStream) throw new Error('No visible transcript stream was rendered');
  const transcriptStreams = [...document.querySelectorAll('[data-testid="transcript-stream"]')];
  const rows = [...transcriptStream.querySelectorAll('[data-testid="transcript-activity-row"]')];
  const prose = transcriptStream.querySelector('[data-testid="transcript-prose"]');
  const streamItems = [...transcriptStream.querySelectorAll('.transcript__item')];
  const activityRows = rows;
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
  const activityItems = [...transcriptStream.querySelectorAll('.transcript__item--activity')];
  const gaps = activityItems.flatMap((item, index) => {
    const previous = activityItems[index - 1];
    if (!previous || previous.nextElementSibling !== item) return [];
    const before = previous.querySelector('[data-testid="transcript-activity-row"]')?.getBoundingClientRect();
    const after = item.querySelector('[data-testid="transcript-activity-row"]')?.getBoundingClientRect();
    return before && after ? [after.top - before.bottom] : [];
  });
  const platformRows = rows.filter((row) => row.dataset.platformTool === 'true');
  const platformSourceOrdinals = new Set(platformRows.flatMap((row) => (
    (row.dataset.sourceOrdinals ?? '').split(',').filter(Boolean).map(Number)
  )));
  const platformDetails = platformRows.filter((row) => row.tagName === 'DETAILS');
  const platformDetailText = platformRows.map((row) => row.querySelector('.transcript__detail')?.textContent ?? '');
  const staticToolRows = rows.filter((row) => row.dataset.transcriptRowKind === 'tool' && row.dataset.transcriptRowMode === 'static');
  const activitySummary = activityRows[0]?.querySelector('summary') ?? activityRows[0];
  const rowStyle = activitySummary ? getComputedStyle(activitySummary) : null;
  const proseStyle = prose ? getComputedStyle(prose) : null;
  const platformSummary = platformRows[0]?.querySelector('summary') ?? null;
  const platformStyle = platformSummary ? getComputedStyle(platformSummary) : null;
  const summaryPlatformCount = document.querySelector('[data-testid="session-platform-tool-count"]')?.textContent?.trim() ?? null;
  const navStrong = document.querySelector('[data-testid="session-role-nav"] strong')?.textContent?.trim() ?? '';
  return {
    // Final rendered DOM units, not raw entries and not an intermediate projection.
    session: 'lead', raw_entries: rawEntryCount, rendered_units: streamItems.length,
    transcript_stream_count: transcriptStreams.length,
    visible_transcript_stream_count: transcriptStreams.filter((element) => element.getClientRects().length > 0).length,
    transcript_streams: transcriptStreams.map((element) => ({
      visible: element.getClientRects().length > 0,
      parent_class: element.parentElement?.className ?? null,
      first_source_ordinals: element.querySelector('.transcript__item')?.getAttribute('data-source-ordinals') ?? null,
      text_prefix: element.textContent?.trim().slice(0, 80) ?? '',
    })),
    rendered_unit_breakdown: Object.fromEntries(['assistant', 'activity', 'lifecycle', 'footer'].map((kind) => [kind, document.querySelectorAll(`.transcript__item--${kind}`).length])),
    thinking_rows: thinkingRows.length,
    max_consecutive_thinking: maxConsecutiveThinking,
    duplicated_label_lines: duplicatedLabelLines,
    rows_above_fold_1440x900: streamItems.filter((item) => item.getBoundingClientRect().top < 900).length,
    expandable_rows: rows.filter((row) => row.dataset.transcriptRowMode === 'expandable').length,
    static_rows: rows.filter((row) => row.dataset.transcriptRowMode === 'static').length,
    static_tool_rows: staticToolRows.length,
    max_gap_px_between_consecutive_activity_rows: Math.max(0, ...gaps),
    prose_font_size_px: proseStyle ? Number.parseFloat(proseStyle.fontSize) : 0,
    activity_row_font_size_px: rowStyle ? Number.parseFloat(rowStyle.fontSize) : 0,
    prose_border_left_width: proseStyle?.borderLeftWidth ?? '',
    matches_reasoning_started_or_completed: /Reasoning\s+(started|completed)/i.test(transcriptStream.textContent ?? ''),
    matches_activity_running: /activity running/i.test(transcriptStream.textContent ?? ''),
    left_nav_first_strong_text: navStrong,
    page_contains_addressed_by_role_name: document.body.textContent?.includes('addressed by role name') ?? false,
    source_ordinal_coverage: ordinals.size,
    tool_activity_id_reused_across_sequence_runs: reusedToolActivityIds.length,
    tool_activity_id_reuses: reusedToolActivityIds,
    tool_rows_with_detail: toolRowsWithDetailCount,
    tool_detail_available_in_dataset: toolRowsWithDetailCount > 0,
    // F1/F4/F5/F6/F8 MCP projection checks. The current fixture may have no
    // platform rows; then the fields remain explicit rather than claiming pass.
    platform_rows: platformRows.length,
    source_platform_entries: sourcePlatformEntries,
    platform_source_ordinal_coverage: platformSourceOrdinals.size,
    platform_source_ordinal_coverage_matches_entries: platformSourceOrdinals.size === sourcePlatformEntries,
    platform_rows_are_details: platformRows.length === platformDetails.length,
    platform_detail_panels: platformDetailText.length,
    platform_detail_pre_count: platformRows.reduce((count, row) => count + row.querySelectorAll('pre').length, 0),
    platform_detail_not_captured: platformDetailText.every((text) => /not captured/i.test(text)),
    static_tool_rows_are_divs: staticToolRows.length ? staticToolRows.every((row) => row.tagName === 'DIV') : null,
    platform_font_size_px: platformStyle ? Number.parseFloat(platformStyle.fontSize) : null,
    activity_padding_top_px: rowStyle ? Number.parseFloat(rowStyle.paddingTop) : null,
    platform_padding_top_px: platformStyle ? Number.parseFloat(platformStyle.paddingTop) : null,
    session_platform_tool_count_text: summaryPlatformCount,
  };
}, { reusedToolActivityIds, toolRowsWithDetailCount: toolRowsWithDetail.length, rawEntryCount: leadEntries.length, sourcePlatformEntries });
metrics.expandability_checks = {
  reasoning: reasoningExpand,
  tool: toolDetailCheck,
  static_tool: staticToolClick,
  hover_icon_replaced_with_chevron: hoverChevron,
};
await writeFile('/workspace/transcript-metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics));
await browser.close();
