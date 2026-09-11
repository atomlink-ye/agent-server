import { act } from 'react';
import { getLocale, setLocale } from '../i18n';
import { commands } from 'vitest/browser';
import { expect } from 'vitest';
import '../index.css';

export async function surfaceMetrics(host: HTMLElement, surface: string, selectors: readonly string[]) {
  expect(window.innerWidth).toBe(1440);
  const originalLocale = getLocale();
  for (const locale of ['en', 'zh-CN'] as const) {
  await act(async () => setLocale(locale));
  const result = Object.fromEntries(selectors.map(selector => {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `${surface}: ${selector}`).not.toBeNull();
    const style = getComputedStyle(element!);
    const rect = element!.getBoundingClientRect();
    return [selector, { height: rect.height, padding: style.padding, gap: style.gap, margin: style.margin, fontSize: style.fontSize, radius: style.borderRadius, font: style.fontFamily, color: style.color }];
  }));
  await commands.writeFile(`../../.local/visual-system/${surface}-${locale}.json`, JSON.stringify(result, null, 2));
  }
  await act(async () => setLocale(originalLocale));
}
