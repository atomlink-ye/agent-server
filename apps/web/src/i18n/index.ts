/**
 * The whole i18n layer: locale state, lookup, and interpolation.
 *
 * Deliberately dependency-free. A library (react-i18next & friends) brings a
 * loader pipeline, a namespace concept, and a plugin system we would use none
 * of: the dictionaries are small enough to ship in the bundle, and there is no
 * server-rendered HTML to hydrate around.
 *
 * The contract:
 *   - `en` is the source of truth. `MessageKey` is `keyof typeof en`, and every
 *     other dictionary is typed as a total `Record<MessageKey, string>`, so a
 *     key that a translation forgot — or misspelled — is a compile error rather
 *     than a blank space on screen.
 *   - Lookup still falls back to English at runtime. Type checking is the
 *     guarantee; the fallback is what keeps a stale bundle readable instead of
 *     empty.
 *   - The choice is per-device, in `localStorage`. Syncing it through the
 *     account would push one language onto every browser a person signs in
 *     from, which is the wrong default for someone reading English at work and
 *     Chinese at home.
 */
import { useCallback, useSyncExternalStore } from 'react';

import { en } from './en.js';
import { zhCN } from './zh-CN.js';

export type Locale = 'en' | 'zh-CN';
export type MessageKey = keyof typeof en;
export type MessageVars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: MessageVars) => string;

/**
 * Order here is the order the language picker renders. `label` is written in
 * the language itself on purpose — someone looking for Chinese scans for
 * 简体中文, not for "Chinese (Simplified)".
 */
export const LOCALES: readonly {
  readonly code: Locale;
  readonly label: string;
  readonly english: string;
  /** What fits in a 44px rail button. */
  readonly short: string;
}[] = [
  { code: 'en', label: 'English', english: 'English', short: 'EN' },
  {
    code: 'zh-CN',
    label: '简体中文',
    english: 'Chinese (Simplified)',
    short: '中',
  },
];

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  'zh-CN': zhCN,
};

const STORAGE_KEY = 'agent-server.locale';

function isLocale(value: string | null): value is Locale {
  return LOCALES.some(({ code }) => code === value);
}

/**
 * First run: no stored choice, so take the browser's. `zh`, `zh-Hans`,
 * `zh-CN`, `zh-SG` all mean "this person reads Chinese" here — only Simplified
 * ships, so anything Chinese-ish lands there instead of falling through to
 * English. A Traditional-script reader gets Simplified, which is a UI they can
 * read and then switch, rather than one they cannot.
 */
export function detectLocaleFrom(
  tags: readonly (string | undefined)[],
): Locale {
  for (const tag of tags) {
    const lower = tag?.toLowerCase() ?? '';
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  return detectLocaleFrom([navigator.language, ...(navigator.languages ?? [])]);
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Private mode or storage disabled: fall through to browser detection.
  }
  return detectLocale();
}

/**
 * Keep the document's language attribute in step. Screen readers choose a
 * voice from it, CSS `:lang()` selectors key off it, and the browser picks
 * line-breaking rules from it — all three are wrong if it stays `en` while the
 * page reads Chinese.
 */
function syncDocumentLanguage(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let current: Locale = readStoredLocale();
syncDocumentLanguage(current);

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  syncDocumentLanguage(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A locale that cannot be remembered is still worth applying now.
  }
  listeners.forEach((listener) => listener());
}

/**
 * `{name}` placeholders. A placeholder with no matching variable is left
 * standing rather than blanked, so a typo shows up as a visible `{whoops}`
 * instead of silently eating part of the sentence.
 */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/** The raw template, before interpolation — what rich rendering splits on. */
export function messageTemplate(locale: Locale, key: MessageKey): string {
  return (DICTIONARIES[locale] ?? en)[key] ?? en[key] ?? key;
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: MessageVars,
): string {
  return interpolate(messageTemplate(locale, key), vars);
}

/** The current locale, for code that branches on it rather than looking a
 *  message up (date formatting, list separators, a picker's checkmark). */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** The translator for components. Re-renders its caller on a locale switch. */
export function useT(): Translate {
  const locale = useLocale();
  return useCallback((key, vars) => translate(locale, key, vars), [locale]);
}

/**
 * The translator for module scope: shared label tables, event handlers, and
 * store code that produces a message outside a render. It reads the locale at
 * call time and does not subscribe, so a component that renders its result has
 * to be re-rendered by something else — `App` subscribes at the root for
 * exactly this reason.
 */
export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(current, key, vars);
}
