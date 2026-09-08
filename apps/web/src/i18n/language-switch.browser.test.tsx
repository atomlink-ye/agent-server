import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';

import Rail from '../app/shell/Rail';
import { getLocale, setLocale } from './index';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'agent-server.locale';

afterEach(() => {
  // The locale is process-wide state in a shared browser context, so a test
  // that leaves it in Chinese would translate every later test's assertions.
  setLocale('en');
  window.localStorage.removeItem(STORAGE_KEY);
});

it('starts in English in an English browser', () => {
  expect(getLocale()).toBe('en');
  const { host, root } = renderRail();
  try {
    expect(railLabels(host)).toContain('Conversations');
  } finally {
    act(() => root.unmount());
  }
});

it('retranslates the mounted UI when the language changes, with no reload', () => {
  const { host, root } = renderRail();
  try {
    const railBefore = host.querySelector('.rail');
    expect(railLabels(host)).toContain('Conversations');

    chooseLanguage(host, '简体中文');

    expect(railLabels(host)).toContain('对话');
    expect(railLabels(host)).not.toContain('Conversations');
    // Same DOM node: the tree was re-rendered in place, not torn down and
    // rebuilt by a navigation or a reload.
    expect(host.querySelector('.rail')).toBe(railBefore);
  } finally {
    act(() => root.unmount());
  }
});

it('remembers the choice and tells the document what language it is in', () => {
  const { host, root } = renderRail();
  try {
    chooseLanguage(host, '简体中文');

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  } finally {
    act(() => root.unmount());
  }
});

function renderRail() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter>
        <Rail activeTab="conversations" onSelectTab={() => {}} />
      </MemoryRouter>,
    );
  });
  return { host, root };
}

function railLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.rail-tab-label')].map(
    (node) => node.textContent ?? '',
  );
}

/** Opens the rail's language menu and picks the option written as `label`. */
function chooseLanguage(host: HTMLElement, label: string): void {
  const toggle = host.querySelector<HTMLButtonElement>('.rail-language-button');
  if (!toggle) throw new Error('The rail has no language control.');
  act(() => toggle.click());

  const option = [
    ...host.querySelectorAll<HTMLButtonElement>('.rail-language-option'),
  ].find((candidate) => candidate.textContent === label);
  if (!option) throw new Error(`No language option labelled ${label}.`);
  act(() => option.click());
}
