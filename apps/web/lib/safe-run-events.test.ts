import { describe, expect, it } from 'vitest';

import { safeRunEvent } from './safe-run-events';

const keys = (value: Readonly<Record<string, unknown>> | undefined) =>
  Object.keys(value ?? {}).sort();

function outputPayload(
  payload: Record<string, unknown>,
  sequence = 1,
): Readonly<Record<string, unknown>> | undefined {
  const event = safeRunEvent({ sequence, type: 'output', payload });
  expect(event).not.toBeNull();
  return event?.payload;
}

describe('safeRunEvent output payload contract', () => {
  it('passes assistant text through with its exact whitelist', () => {
    const payload = outputPayload({
      kind: 'assistant_text',
      text: 'The real response, not a placeholder.',
      sensitive_extra: 'must not cross the boundary',
    });

    expect(payload).toEqual({
      kind: 'assistant_text',
      text: 'The real response, not a placeholder.',
    });
    expect(keys(payload)).toEqual(['kind', 'text']);
  });

  it('passes reasoning status and text, while dropping unknown keys', () => {
    const payload = outputPayload({
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'I compared the available options.',
      provider_call_id: 'secret-provider-id',
    });

    expect(payload).toEqual({
      kind: 'reasoning_progress',
      status: 'completed',
      text: 'I compared the available options.',
    });
    expect(keys(payload)).toEqual(['kind', 'status', 'text']);
  });

  it('passes every safe tool field without rewriting activity identity', () => {
    const payload = outputPayload({
      kind: 'tool_status',
      activity_id: 'upstream-tool-42',
      category: 'shell',
      status: 'completed',
      label: 'Run the verification command',
      summary: 'The command completed successfully.',
      tool_name: 'grep',
      detail_kind: 'shell',
      detail_text: 'grep -R safeOutputPayload apps/web/lib',
      exit_code: 0,
      parent_activity_id: 'upstream-parent-7',
      raw_provider_payload: { callId: 'do-not-forward' },
    });

    expect(payload).toEqual({
      kind: 'tool_status',
      activity_id: 'upstream-tool-42',
      category: 'shell',
      status: 'completed',
      label: 'Run the verification command',
      summary: 'The command completed successfully.',
      tool_name: 'grep',
      detail_kind: 'shell',
      detail_text: 'grep -R safeOutputPayload apps/web/lib',
      exit_code: 0,
      parent_activity_id: 'upstream-parent-7',
    });
    expect(keys(payload)).toEqual([
      'activity_id',
      'category',
      'detail_kind',
      'detail_text',
      'exit_code',
      'kind',
      'label',
      'parent_activity_id',
      'status',
      'summary',
      'tool_name',
    ]);
  });

  it('passes child timeline items through the child whitelist', () => {
    const payload = outputPayload({
      kind: 'child_timeline_item',
      activity_id: 'child-tool-1',
      parent_activity_id: 'upstream-parent-7',
      item_kind: 'tool',
      status: 'completed',
      label: 'Child shell command',
      summary: 'Child command completed.',
      detail_kind: 'shell',
      detail_text: 'pwd',
      exit_code: 0,
      sensitive_extra: 'drop me',
    });

    expect(payload).toEqual({
      kind: 'child_timeline_item',
      activity_id: 'child-tool-1',
      parent_activity_id: 'upstream-parent-7',
      item_kind: 'tool',
      status: 'completed',
      label: 'Child shell command',
      summary: 'Child command completed.',
      detail_kind: 'shell',
      detail_text: 'pwd',
      exit_code: 0,
    });
    expect(keys(payload)).toEqual([
      'activity_id',
      'detail_kind',
      'detail_text',
      'exit_code',
      'item_kind',
      'kind',
      'label',
      'parent_activity_id',
      'status',
      'summary',
    ]);
  });

  it('passes permission semantics and preserves the upstream activity id', () => {
    const payload = outputPayload({
      kind: 'permission',
      activity_id: 'permission-upstream-9',
      category: 'tool',
      status: 'requested',
      decision: 'allowed',
      summary: 'Allow the shell command to run?',
      sensitive_extra: 'must not cross the boundary',
    });

    expect(payload).toEqual({
      kind: 'permission',
      activity_id: 'permission-upstream-9',
      category: 'tool',
      status: 'requested',
      decision: 'allowed',
      summary: 'Allow the shell command to run?',
    });
    expect(keys(payload)).toEqual([
      'activity_id',
      'category',
      'decision',
      'kind',
      'status',
      'summary',
    ]);
  });

  it('keeps usage behavior and only emits finite numeric usage fields', () => {
    const payload = outputPayload({
      kind: 'usage',
      input_tokens: 12,
      cached_input_tokens: 3,
      output_tokens: 8,
      total_cost_usd: 0.01,
      context_window_max_tokens: 1000,
      context_window_used_tokens: 250,
      bearer: 'must not cross the boundary',
      malformed: 'drop me',
    });

    expect(payload).toEqual({
      kind: 'usage',
      input_tokens: 12,
      cached_input_tokens: 3,
      output_tokens: 8,
      total_cost_usd: 0.01,
      context_window_max_tokens: 1000,
      context_window_used_tokens: 250,
    });
    expect(keys(payload)).toEqual([
      'cached_input_tokens',
      'context_window_max_tokens',
      'context_window_used_tokens',
      'input_tokens',
      'kind',
      'output_tokens',
      'total_cost_usd',
    ]);
  });

  it('drops an invalid optional field without dropping the otherwise valid tool', () => {
    const payload = outputPayload({
      kind: 'tool_status',
      activity_id: 'tool-optional-invalid',
      category: 'read',
      status: 'completed',
      label: 'Read file',
      summary: 'File read.',
      tool_name: 42,
      detail_kind: 'not-a-detail-kind',
      detail_text: 42,
      exit_code: '0',
      parent_activity_id: 42,
    });

    expect(payload).toEqual({
      kind: 'tool_status',
      activity_id: 'tool-optional-invalid',
      category: 'read',
      status: 'completed',
      label: 'Read file',
      summary: 'File read.',
    });
  });

  it('drops an invalid optional permission decision while retaining the event', () => {
    const payload = outputPayload({
      kind: 'permission',
      activity_id: 'permission-invalid-decision',
      category: 'plan',
      status: 'resolved',
      decision: 'maybe',
      summary: 'Resolved with an invalid decision value.',
    });

    expect(payload).toEqual({
      kind: 'permission',
      activity_id: 'permission-invalid-decision',
      category: 'plan',
      status: 'resolved',
      summary: 'Resolved with an invalid decision value.',
    });
  });

  it.each([
    [
      'tool category',
      {
        kind: 'tool_status',
        activity_id: 'x',
        category: 'invalid',
        status: 'running',
        label: 'x',
        summary: 'x',
      },
    ],
    [
      'tool status',
      {
        kind: 'tool_status',
        activity_id: 'x',
        category: 'read',
        status: 'invalid',
        label: 'x',
        summary: 'x',
      },
    ],
    [
      'tool activity id',
      {
        kind: 'tool_status',
        activity_id: 42,
        category: 'read',
        status: 'running',
        label: 'x',
        summary: 'x',
      },
    ],
    [
      'tool label',
      {
        kind: 'tool_status',
        activity_id: 'x',
        category: 'read',
        status: 'running',
        label: 42,
        summary: 'x',
      },
    ],
    [
      'tool summary',
      {
        kind: 'tool_status',
        activity_id: 'x',
        category: 'read',
        status: 'running',
        label: 'x',
        summary: 42,
      },
    ],
    [
      'permission category',
      {
        kind: 'permission',
        activity_id: 'x',
        category: 'invalid',
        status: 'requested',
        summary: 'x',
      },
    ],
    [
      'permission status',
      {
        kind: 'permission',
        activity_id: 'x',
        category: 'tool',
        status: 'invalid',
        summary: 'x',
      },
    ],
    [
      'permission activity id',
      {
        kind: 'permission',
        activity_id: 42,
        category: 'tool',
        status: 'requested',
        summary: 'x',
      },
    ],
    [
      'permission summary',
      {
        kind: 'permission',
        activity_id: 'x',
        category: 'tool',
        status: 'requested',
        summary: 42,
      },
    ],
    [
      'child kind',
      {
        kind: 'child_timeline_item',
        activity_id: 'x',
        parent_activity_id: 'p',
        item_kind: 'invalid',
        status: 'running',
        label: 'x',
        summary: 'x',
      },
    ],
    [
      'child parent id',
      {
        kind: 'child_timeline_item',
        activity_id: 'x',
        parent_activity_id: 42,
        item_kind: 'tool',
        status: 'running',
        label: 'x',
        summary: 'x',
      },
    ],
    [
      'child label',
      {
        kind: 'child_timeline_item',
        activity_id: 'x',
        parent_activity_id: 'p',
        item_kind: 'tool',
        status: 'running',
        label: 42,
        summary: 'x',
      },
    ],
    [
      'child summary',
      {
        kind: 'child_timeline_item',
        activity_id: 'x',
        parent_activity_id: 'p',
        item_kind: 'tool',
        status: 'running',
        label: 'x',
        summary: 42,
      },
    ],
  ])('drops an event when required enum %s is invalid', (_name, input) => {
    const event = safeRunEvent({ sequence: 1, type: 'output', payload: input });
    expect(event).not.toBeNull();
    expect(event?.payload).toBeUndefined();
  });

  it('drops assistant text when its required text value is not a string', () => {
    expect(
      outputPayload({ kind: 'assistant_text', text: { unsafe: true } }),
    ).toBeUndefined();
  });

  it('drops invalid optional reasoning text but keeps its status', () => {
    expect(
      outputPayload({
        kind: 'reasoning_progress',
        status: 'started',
        text: 123,
      }),
    ).toEqual({ kind: 'reasoning_progress', status: 'started' });
  });
});

describe('safeRunEvent field bounds', () => {
  it.each([
    ['activity_id', 256],
    ['parent_activity_id', 256],
    ['label', 120],
    ['summary', 2000],
    ['detail_text', 12000],
  ])('%s at exactly its limit is retained', (field, limit) => {
    const input: Record<string, unknown> = {
      kind: 'tool_status',
      activity_id: 'a',
      category: 'shell',
      status: 'running',
      label: 'label',
      summary: 'summary',
      detail_kind: 'shell',
      detail_text: 'detail',
      parent_activity_id: 'parent',
    };
    input[field] = 'x'.repeat(limit);
    const payload = outputPayload(input);
    expect(payload).toBeDefined();
    expect(payload?.[field]).toBe('x'.repeat(limit));
  });

  it.each([
    ['activity_id', 256],
    ['parent_activity_id', 256],
    ['label', 120],
    ['summary', 2000],
    ['detail_text', 12000],
  ])(
    '%s at limit + 1 is truncated and remains reducer-parseable',
    (field, limit) => {
      const input: Record<string, unknown> = {
        kind: 'tool_status',
        activity_id: 'a',
        category: 'shell',
        status: 'running',
        label: 'label',
        summary: 'summary',
        detail_kind: 'shell',
        detail_text: 'detail',
        parent_activity_id: 'parent',
      };
      input[field] = 'x'.repeat(limit + 1);
      const payload = outputPayload(input);
      expect(payload).toBeDefined();
      expect(typeof payload?.[field]).toBe('string');
      expect((payload?.[field] as string).length).toBe(limit);
    },
  );

  it.each([
    ['assistant_text', 'text'],
    ['reasoning_progress', 'text'],
  ])('%s text is retained at 32000 and truncated at 32001', (kind, field) => {
    const exact = outputPayload({
      kind,
      ...(kind === 'reasoning_progress' ? { status: 'completed' } : {}),
      [field]: 'x'.repeat(32_000),
    });
    expect(exact?.[field]).toBe('x'.repeat(32_000));

    const over = outputPayload({
      kind,
      ...(kind === 'reasoning_progress' ? { status: 'completed' } : {}),
      [field]: 'x'.repeat(32_001),
    });
    expect(over?.[field]).toBe('x'.repeat(32_000));
  });
});
