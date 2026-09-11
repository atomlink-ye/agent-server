import { expect } from 'vitest';

/** Check the actual scrolling owner, including its visible last content. */
export function expectScrollReachable(
  host: HTMLElement,
  selector: string,
  lastContentSelector?: string,
): void {
  const region = host.querySelector<HTMLElement>(selector);
  expect.soft(region, selector).not.toBeNull();
  if (!region) return;
  expect
    .soft(['auto', 'scroll'], selector)
    .toContain(getComputedStyle(region).overflowY);
  expect.soft(region.clientHeight, selector).toBeGreaterThan(0);
  expect
    .soft(region.scrollHeight, selector)
    .toBeGreaterThan(region.clientHeight);
  region.scrollTop = 0;
  region.scrollTop = region.scrollHeight;
  expect.soft(region.scrollTop, selector).toBeGreaterThan(0);
  expect
    .soft(
      Math.abs(region.scrollHeight - region.clientHeight - region.scrollTop),
      selector,
    )
    .toBeLessThanOrEqual(1);
  const bounds = region.getBoundingClientRect();
  expect.soft(bounds.top, selector).toBeGreaterThanOrEqual(0);
  expect
    .soft(bounds.bottom, selector)
    .toBeLessThanOrEqual(window.innerHeight + 1);
  if (lastContentSelector) {
    const last = [...region.querySelectorAll(lastContentSelector)].at(-1);
    expect.soft(last, lastContentSelector).toBeDefined();
    if (!last) return;
    const end = last.getBoundingClientRect();
    expect
      .soft(end.bottom, lastContentSelector)
      .toBeLessThanOrEqual(bounds.bottom + 1);
    expect
      .soft(end.top, lastContentSelector)
      .toBeGreaterThanOrEqual(bounds.top - 1);
  }
}

/** A hidden overflow box clips its descendants even if an outer box scrolls. */
export function expectNoVerticalTraps(host: HTMLElement): void {
  const traps = [...host.querySelectorAll<HTMLElement>('*')].flatMap((el) => {
    if (el.clientHeight < 2 || el.scrollHeight <= el.clientHeight + 4)
      return [];
    const style = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(style.overflowY)) return [];
    // Screen-reader-only labels and intentional text previews are disclosures,
    // not layout scrolling owners. Long content is checked in its detail view.
    if (style.clipPath !== 'none' || Number(style.webkitLineClamp) > 0)
      return [];
    return [
      {
        selector: el.className || el.tagName,
        height: el.clientHeight,
        content: el.scrollHeight,
      },
    ];
  });
  expect.soft(traps, 'Vertically clipped content').toEqual([]);
}
