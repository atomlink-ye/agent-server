import { expect, it } from 'vitest';

import { en } from './en';
import { zhCN } from './zh-CN';
import {
  detectLocaleFrom,
  interpolate,
  LOCALES,
  translate,
  type MessageKey,
} from './index';

it('leaves no message untranslated by copying the English through', () => {
  const untranslated = (Object.keys(en) as MessageKey[]).filter(
    (key) => zhCN[key] === en[key],
  );
  // Product nouns and one shared symbol are the same word in both languages;
  // anything else identical to the English is a translation nobody wrote.
  expect(untranslated).toEqual([
    'shell.nav.work',
    'conversations.eyebrow.workspace',
    'conversations.fallback.agent',
    'dispatch.recipient.fallback',
    'workCard.eyebrow',
    'coworker.role.fallback',
  ]);
});

it('names each language in the language itself', () => {
  expect(LOCALES.map(({ code, label }) => [code, label])).toEqual([
    ['en', 'English'],
    ['zh-CN', '简体中文'],
  ]);
});

it('gives the rail language control a compact label for each locale', () => {
  expect(LOCALES.map(({ code, short }) => [code, short])).toEqual([
    ['en', 'EN'],
    ['zh-CN', '中'],
  ]);
});

it('substitutes named placeholders and leaves unmatched ones visible', () => {
  expect(interpolate('{count} conversations', { count: 3 })).toBe(
    '3 conversations',
  );
  expect(interpolate('{count} 个对话', { count: 0 })).toBe('0 个对话');
  expect(interpolate('{whoops} here', { other: 1 })).toBe('{whoops} here');
});

it('translates through the locale, falling back to English for an unknown one', () => {
  expect(translate('en', 'common.retry')).toBe('Retry');
  expect(translate('zh-CN', 'common.retry')).toBe('重试');
  expect(translate('de' as unknown as 'en', 'common.retry')).toBe('Retry');
});

it('reads a Chinese browser in any script or region as Simplified Chinese', () => {
  expect(detectLocaleFrom(['zh'])).toBe('zh-CN');
  expect(detectLocaleFrom(['zh-Hans'])).toBe('zh-CN');
  expect(detectLocaleFrom(['zh-TW'])).toBe('zh-CN');
  expect(detectLocaleFrom(['en-GB', 'zh-CN'])).toBe('en');
  expect(detectLocaleFrom(['fr-FR', 'zh-CN'])).toBe('zh-CN');
  expect(detectLocaleFrom([])).toBe('en');
  expect(detectLocaleFrom([undefined])).toBe('en');
});
