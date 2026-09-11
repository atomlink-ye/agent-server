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
  // Product nouns, provider labels and punctuation-only templates are shared;
  // anything else identical to the English is a translation nobody wrote.
  expect(untranslated).toEqual([
    'shell.nav.work',
    'conversations.eyebrow.workspace',
    'conversations.fallback.agent',
    'dispatch.recipient.fallback',
    'workCard.eyebrow',
    'coworker.role.fallback',
    'tasks.taskEyebrow',
    'boards.title',
    'work.title',
    'work.tab.definition',
    'authoring.runtimeClaude',
    'authoring.runtimeCodex',
    'shell.brand',
    'trace.actorActivity',
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

it('keeps exactly the same message keys in English and Simplified Chinese', () => {
  expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
});

it('preserves every interpolation placeholder in both catalogs', () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en) as MessageKey[]) {
    expect(placeholders(zhCN[key]), key).toEqual(placeholders(en[key]));
  }
});
