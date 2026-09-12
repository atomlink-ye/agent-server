import { act } from 'react';
import { expect } from 'vitest';

export async function settleScrollState() {
  for (let turn = 0; turn < 8; turn++)
    await act(async () => {
      await Promise.resolve();
    });
}

/** Use native input events so the real React form owns the oversized draft. */
export async function enterScrollDraft(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    control.focus();
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      control,
      value,
    );
    control.setSelectionRange(value.length, value.length);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function exerciseScrollStates(
  host: HTMLElement,
  route: string,
  record: (state: string) => void,
) {
  await openScrollDisclosures(host);
  record('disclosures');
  await fillScrollableDrafts(host);
  record('drafts');
  if (route === '/' || route.startsWith('/conversations/')) {
    const createTask = host.querySelector<HTMLButtonElement>(
      '.chat-message-task-action',
    );
    expect(createTask, 'Conversation task action').not.toBeNull();
    await act(async () => createTask!.click());
    expect(
      host.querySelector('.chat-task-form textarea'),
      'Task description draft opens',
    ).not.toBeNull();
    record('conversation task draft');
  }
  const mention = async (scope: Element) => {
    const control =
      scope.querySelector<HTMLTextAreaElement>(
        'textarea[aria-autocomplete="list"][aria-label]',
      ) ??
      scope.querySelector<HTMLTextAreaElement>(
        'textarea[aria-autocomplete="list"]',
      );
    if (!control) return;
    await enterScrollDraft(control, '@');
    await settleScrollState();
    expect(
      scope.querySelector('[data-testid="mention-suggestions"]'),
      'Mention list opens',
    ).not.toBeNull();
    record('mentions');
    await enterScrollDraft(control, '');
  };
  if (route.startsWith('/tasks/')) await mention(host);
  if (route.startsWith('/boards/')) {
    const card = host.querySelector<HTMLElement>(
      '[data-testid="work-board-card"]',
    );
    if (card) {
      await act(async () => card.click());
      await settleScrollState();
      record('peek');
      expect(
        host.querySelector('.work-board-peek-comments'),
        'Board comments load',
      ).not.toBeNull();
      await fillScrollableDrafts(host);
      record('peek drafts');
      const peek = host.querySelector('[data-testid="work-board-peek"]');
      if (peek) await mention(peek);
    }
  }
  if (route === '/agents') {
    const add = host.querySelector<HTMLElement>('.agents-roster-add');
    if (add) {
      await act(async () => add.click());
      await settleScrollState();
      await openScrollDisclosures(host);
      await fillScrollableDrafts(host);
      record('new coworker drafts');
    }
  } else if (route.startsWith('/agents/')) {
    const add = host.querySelector<HTMLButtonElement>(
      '.agents-capabilities .agents-section-heading button',
    );
    if (add) {
      await act(async () => add.click());
      await settleScrollState();
      const builder = host.querySelector<HTMLElement>('.agents-authoring');
      const name = builder?.querySelector<HTMLInputElement>(
        '.agents-form-grid input',
      );
      if (builder && name) {
        await enterScrollDraft(name, 'Scroll Capability');
        await fillScrollableDrafts(builder);
        const preview = [...builder.querySelectorAll('button')].find((button) =>
          /Preview plan|预览/i.test(button.textContent ?? ''),
        );
        expect(preview, 'Capability preview action').toBeDefined();
        if (preview) await act(async () => preview.click());
        await settleScrollState();
        await openScrollDisclosures(builder);
        record('capability source');
        const source = builder.querySelector<HTMLElement>(
          '.agents-source-preview',
        );
        expect(source, 'Generated source is rendered').not.toBeNull();
        expect(source!.scrollHeight).toBeGreaterThan(source!.clientHeight);
      }
    }
  }
}

export async function openScrollDisclosures(host: HTMLElement) {
  await act(async () => {
    for (const details of host.querySelectorAll('details')) details.open = true;
  });
}

export async function fillScrollableDrafts(host: HTMLElement) {
  const prose = Array.from(
    { length: 500 },
    (_, i) => `Draft line ${i + 1}`,
  ).join('\n');
  for (const control of host.querySelectorAll('textarea')) {
    if (control.readOnly || control.disabled || !control.checkVisibility())
      continue;
    // YAML editors already contain a valid definition; comments preserve it.
    const value =
      control.id === 'work-definition' ||
      control.classList.contains('work-definition__source')
        ? control.value +
          '\n' +
          prose
            .split('\n')
            .map((line) => '# ' + line)
            .join('\n')
        : prose;
    await enterScrollDraft(control, value);
  }
}
