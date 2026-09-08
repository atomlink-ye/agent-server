import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import '../../index.css';
import '../../features/agents/agents.css';
import '../../features/files/files.css';
import '../../features/whispers/whispers.css';
import '../../features/work/work-page.css';
import '../../features/work-organization/work-organization.css';

const regions = [
  ['Conversations transcript', 'chat-transcript scroll-region'],
  ['Agents roster/detail', 'agents-main scroll-region'],
  ['Files scope list', 'files-scope-list scroll-region'],
  ['Files content', 'files-main scroll-region'],
  ['Work detail and transcript', 'work-main-content scroll-region'],
  ['Observe detail', 'work-main-content scroll-region'],
  ['Tasks list', 'work-org-list scroll-region'],
  ['Tasks detail', 'work-org-content scroll-region'],
  ['Boards list', 'work-org-list scroll-region'],
  ['Boards canvas', 'work-org-content scroll-region'],
  ['Whispers channels', 'whispers-list scroll-region'],
  ['Whispers messages', 'whisper-message-log scroll-region'],
] as const;

afterEach(() => {
  document.body.replaceChildren();
});

it('keeps every desktop panel locally scrollable and exposes its final marker', async () => {
  const desktop = document.createElement('div');
  desktop.className = 'app-shell';
  desktop.style.cssText = 'width: 1440px; height: 720px;';
  document.body.append(desktop);

  for (const [label, className] of regions) {
    const region = document.createElement('section');
    region.className = className;
    region.setAttribute('aria-label', label);
    region.style.cssText = 'height: 220px; width: 500px; flex: none;';
    for (let index = 0; index < 40; index += 1) {
      const row = document.createElement('p');
      row.textContent = `${label} row ${index}`;
      row.style.margin = '0';
      row.style.padding = '10px';
      region.append(row);
    }
    const bottom = document.createElement('strong');
    bottom.textContent = `${label} bottom marker`;
    bottom.style.cssText = 'display: block; padding: 12px;';
    region.append(bottom);
    desktop.append(region);

    expect(region.scrollHeight, `${label} overflows`).toBeGreaterThan(
      region.clientHeight,
    );
    region.scrollTop = region.scrollHeight;
    expect(region.scrollTop, `${label} accepts scrollTop`).toBeGreaterThan(0);
    expect(
      bottom.getBoundingClientRect().bottom,
      `${label} bottom is visible`,
    ).toBeLessThanOrEqual(region.getBoundingClientRect().bottom + 1);
  }

  const longRow = document.createElement('div');
  longRow.className = 'work-main-content scroll-region';
  longRow.style.cssText = 'width: 420px; height: 80px; flex: none;';
  longRow.textContent = 'unbroken-content-'.repeat(300);
  longRow.style.whiteSpace = 'nowrap';
  desktop.append(longRow);
  expect(longRow.scrollWidth).toBeGreaterThan(longRow.clientWidth);
  longRow.scrollLeft = longRow.scrollWidth;
  expect(longRow.scrollLeft).toBeGreaterThan(0);

  // One non-versioned visual artifact complements the geometry assertions.
  // It stays under the ignored .local evidence directory, never in Git.
  await page.screenshot({
    path: '../../../../../.local/scroll-regions-browser.png',
  });
});
