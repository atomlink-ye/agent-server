import { describe, expect, it } from 'vitest';

import { PaseoRuntimeAdapter } from '../../adapters/paseo/paseo-runtime-adapter.js';
import {
  projectTimelineItem,
  type PaseoClientPort,
} from '../../adapters/paseo/paseo-client-port.js';
import type { RuntimeEvent } from '../ports/agent-runtime.js';
import {
  boundedRunEventPayload,
  type RunEventPayload,
} from '../ports/run-events.js';
import { runtimeEventPayload } from './runtime-event-compatibility.js';
import { InMemoryRunEventRepository } from '../../infrastructure/memory/in-memory-run-event-repository.js';

const runId = '00000000-0000-4000-8000-000000000001';

describe('bounded runtime event payloads', () => {
  it('clips only the offending nested field at each JSON boundary', () => {
    const tooDeep = {
      kind: 'output',
      safe: 'keep-me',
      detail: {
        level1: {
          level2: {
            level3: {
              retained: true,
              offending: { tooDeep: 'remove-me' },
            },
          },
        },
      },
    };
    const depth = boundedRunEventPayload(tooDeep);
    expect(depth.safe).toBe('keep-me');
    expect(depth.detail).toEqual({
      level1: { level2: { level3: { retained: true } } },
    });

    const tooManyKeys = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`key_${index}`, index]),
    );
    const keys = boundedRunEventPayload({
      kind: 'output',
      safe: 'keep-me',
      detail: tooManyKeys,
    });
    expect(keys.safe).toBe('keep-me');
    expect(Object.keys(keys.detail as object)).toHaveLength(32);
    expect(keys.detail).not.toHaveProperty('key_32');

    const tooManyItems = Array.from({ length: 65 }, (_, index) => index);
    const array = boundedRunEventPayload({
      kind: 'output',
      safe: 'keep-me',
      detail: { items: tooManyItems },
    });
    expect(array.safe).toBe('keep-me');
    expect(array.detail).toEqual({ items: tooManyItems.slice(0, 64) });

    const oversized = boundedRunEventPayload({
      kind: 'output',
      safe: 'keep-me',
      detail: { giant: 'x'.repeat(100_000), retained: 'yes' },
    });
    expect(oversized.safe).toBe('keep-me');
    expect(oversized.detail).toMatchObject({ retained: 'yes' });
    expect(JSON.stringify(oversized).length).toBeLessThanOrEqual(32 * 1024);
    expect((oversized.detail as { giant?: string }).giant).not.toBe(
      'x'.repeat(100_000),
    );
  });

  it('preserves values exactly at depth, key, array, and serialized-size limits', () => {
    const exactKeys = Object.fromEntries(
      Array.from({ length: 32 }, (_, index) => [`key_${index}`, index]),
    );
    const exactArray = Array.from({ length: 64 }, (_, index) => index);
    const exactDepth = {
      level1: { level2: { level3: { retained: true } } },
    };
    const empty = JSON.stringify({ detail: { text: '' } }).length;
    const exactText = 'x'.repeat(32 * 1024 - empty);
    expect(boundedRunEventPayload({ detail: exactKeys })).toEqual({
      detail: exactKeys,
    });
    expect(boundedRunEventPayload({ detail: { items: exactArray } })).toEqual({
      detail: { items: exactArray },
    });
    expect(boundedRunEventPayload({ detail: exactDepth })).toEqual({
      detail: exactDepth,
    });
    const exactBytes = { detail: { text: exactText } };
    expect(Buffer.byteLength(JSON.stringify(exactBytes))).toBe(32 * 1024);
    expect(boundedRunEventPayload(exactBytes)).toEqual(exactBytes);
  });

  it('rejects non-plain objects and preserves detail while cropping sibling leaves', () => {
    const payload = boundedRunEventPayload({
      kind: 'tool_status',
      detail: {
        kind: 'shell',
        output: 'a'.repeat(20_000),
        command: 'b'.repeat(20_000),
        cwd: 'c'.repeat(20_000),
      },
      detail_kind: 'shell',
      detail_text: 'a'.repeat(20_000),
      extra: new Date(),
      map: new Map([['secret', 'value']]),
      regexp: /secret/,
      fn: () => 'secret',
    });
    expect(payload.detail).toBeDefined();
    expect(payload.detail_kind).toBe('shell');
    expect(payload.detail_text).toBe(
      (payload.detail as { output?: string }).output,
    );
    expect(payload).not.toHaveProperty('extra');
    expect(payload).not.toHaveProperty('map');
    expect(payload).not.toHaveProperty('regexp');
    expect(payload).not.toHaveProperty('fn');
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(
      32 * 1024,
    );
  });

  it('uses UTF-8 bytes for exact and over serialized-size boundaries', () => {
    const budget = 32 * 1024;
    const prefixBytes = Buffer.byteLength(
      JSON.stringify({ detail: { text: '' } }),
    );
    const codePoints = ['🙂', '中', 'é', 'a'];
    let mixed = '';
    let remaining = budget - prefixBytes;
    const pattern = codePoints.join('');
    const patternWidth = Buffer.byteLength(pattern);
    while (remaining >= patternWidth) {
      mixed += pattern;
      remaining -= patternWidth;
    }
    for (const codePoint of [...codePoints].reverse()) {
      const width = Buffer.byteLength(codePoint);
      if (remaining >= width) {
        mixed += codePoint;
        remaining -= width;
      }
    }
    expect(remaining).toBe(0);
    const exact = { detail: { text: mixed } };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(budget);
    expect(boundedRunEventPayload(exact)).toEqual(exact);

    const over = {
      kind: 'tool_status',
      safe: 'keep-me',
      detail_kind: 'shell',
      detail_text: `${mixed}a`,
      exit_code: 7,
      detail: { kind: 'shell', output: `${mixed}a`, exitCode: 7 },
    };
    const cropped = boundedRunEventPayload(over);
    expect(cropped).not.toEqual({});
    expect(Buffer.byteLength(JSON.stringify(cropped))).toBeLessThanOrEqual(
      budget,
    );
    expect(cropped).toMatchObject({
      safe: 'keep-me',
      detail_kind: 'shell',
      exit_code: 7,
      detail: { kind: 'shell', exitCode: 7 },
    });
    expect(cropped.detail_text).toBe(
      (cropped.detail as { output?: string }).output,
    );
    expect((cropped.detail as { output?: string }).output).toBeDefined();
  });

  it('drops an oversized flat-only field without discarding the event', () => {
    const payload = boundedRunEventPayload({
      kind: 'tool_status',
      safe: 'keep-me',
      detail_kind: 'shell',
      detail_text: 'x'.repeat(100_000),
      exit_code: 7,
    });
    expect(payload).not.toEqual({});
    expect(payload.safe).toBe('keep-me');
    expect(payload.detail_kind).toBe('shell');
    expect(payload.exit_code).toBe(7);
    expect(payload.detail_text).not.toBe('x'.repeat(100_000));
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(
      32 * 1024,
    );
  });

  it('keeps oversized subagent log synchronized with nested detail_text', () => {
    const log = 'subagent output '.repeat(4_000);
    const payload = boundedRunEventPayload({
      kind: 'tool_status',
      detail_kind: 'subagent',
      detail_text: log,
      detail: { kind: 'subagent', log },
    });
    expect(payload).not.toEqual({});
    expect(payload.detail).toMatchObject({ kind: 'subagent' });
    expect((payload.detail as { log?: string }).log).toBe(payload.detail_text);
  });

  it('keeps oversized numeric nested arrays bounded without dropping the event', () => {
    const detail = {
      kind: 'shell',
      ...Object.fromEntries(
        Array.from({ length: 31 }, (_, index) => [
          `items_${index}`,
          Array.from({ length: 64 }, () => Number.MAX_SAFE_INTEGER),
        ]),
      ),
    };
    const payload = boundedRunEventPayload({
      kind: 'tool_status',
      detail_kind: 'shell',
      detail,
    });
    expect(payload).not.toEqual({});
    expect(payload.detail).toMatchObject({ kind: 'shell' });
    expect(payload.detail_kind).toBe('shell');
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(
      32 * 1024,
    );
  });
});

describe('typed Paseo detail round-trip', () => {
  it.each([
    ['shell', 'run shell command', { command: 'pnpm test' }],
    ['read', 'read', { filePath: 'README.md' }],
    ['write', 'write', { filePath: 'output.txt' }],
    ['edit', 'edit', { filePath: 'README.md' }],
    ['search', 'grep', { query: 'runtime detail' }],
    ['fetch', 'fetch', { url: 'https://example.test/docs' }],
    [
      'subagent',
      'delegate',
      { subAgentType: 'reviewer', description: 'review the patch' },
    ],
  ] as const)(
    '%s detail survives adapter → payload → repository',
    async (category, name, input) => {
      const emitted: RuntimeEvent[] = [];
      const client = createStreamingClient((listener) => {
        const rawTimelineItem = {
          type: 'tool_call',
          callId: `call-${category}`,
          name,
          status: 'completed',
          detail: {
            type: category === 'subagent' ? 'sub_agent' : category,
            ...(category === 'shell'
              ? {
                  command: 'pnpm test',
                  cwd: '/tmp/runtime-detail-test',
                  output: 'provider detail text',
                  exitCode: 7,
                }
              : {}),
            ...(category === 'read'
              ? {
                  filePath: 'README.md',
                  content: 'provider detail text',
                  offset: 1,
                  limit: 10,
                }
              : {}),
            ...(category === 'write'
              ? { filePath: 'output.txt', content: 'provider detail text' }
              : {}),
            ...(category === 'edit'
              ? {
                  filePath: 'README.md',
                  oldString: 'old',
                  newString: 'new',
                  unifiedDiff: 'provider detail text',
                }
              : {}),
            ...(category === 'search'
              ? {
                  query: 'runtime detail',
                  toolName: 'grep',
                  content: 'provider detail text',
                  filePaths: ['README.md'],
                  webResults: [
                    { title: 'Docs', url: 'https://example.test/docs' },
                  ],
                  annotations: ['match', 'source'],
                  numFiles: 1,
                  numMatches: 1,
                  durationMs: 2,
                  durationSeconds: 0.002,
                  truncated: false,
                  mode: 'content',
                }
              : {}),
            ...(category === 'fetch'
              ? {
                  url: 'https://user:pass@example.test/docs?token=secret',
                  prompt: 'fetch docs',
                  result: 'provider detail text',
                  code: 200,
                  codeText: 'OK',
                  bytes: 10,
                  durationMs: 3,
                }
              : {}),
            ...(category === 'subagent'
              ? {
                  subAgentType: 'reviewer',
                  description: 'review the patch',
                  childSessionId: 'child-session',
                  log: 'provider detail text',
                  actions: [
                    { index: 1, toolName: 'read', summary: 'read docs' },
                  ],
                }
              : {}),
          },
        };
        const projected = projectTimelineItem(rawTimelineItem);
        expect(projected.toolCall).toBeDefined();
        expect(projected.toolCall?.detail).toMatchObject(
          category === 'shell'
            ? {
                type: 'shell',
                command: 'pnpm test',
                cwd: '/tmp/runtime-detail-test',
                output: 'provider detail text',
                exitCode: 7,
              }
            : category === 'read'
              ? {
                  type: 'read',
                  filePath: 'README.md',
                  content: 'provider detail text',
                  offset: 1,
                  limit: 10,
                }
              : category === 'write'
                ? {
                    type: 'write',
                    filePath: 'output.txt',
                    content: 'provider detail text',
                  }
                : category === 'edit'
                  ? {
                      type: 'edit',
                      filePath: 'README.md',
                      oldString: 'old',
                      newString: 'new',
                      unifiedDiff: 'provider detail text',
                    }
                  : category === 'search'
                    ? {
                        type: 'search',
                        query: 'runtime detail',
                        toolName: 'grep',
                        content: 'provider detail text',
                        filePaths: ['README.md'],
                        webResults: [
                          { title: 'Docs', url: 'https://example.test/docs' },
                        ],
                        annotations: ['match', 'source'],
                        numFiles: 1,
                        numMatches: 1,
                        durationMs: 2,
                        durationSeconds: 0.002,
                        truncated: false,
                        mode: 'content',
                      }
                    : category === 'fetch'
                      ? {
                          type: 'fetch',
                          url: 'https://user:pass@example.test/docs?token=secret',
                          prompt: 'fetch docs',
                          result: 'provider detail text',
                          code: 200,
                          codeText: 'OK',
                          bytes: 10,
                          durationMs: 3,
                        }
                      : {
                          type: 'sub_agent',
                          subAgentType: 'reviewer',
                          description: 'review the patch',
                          log: 'provider detail text',
                          actions: [
                            {
                              index: 1,
                              toolName: 'read',
                              summary: 'read docs',
                            },
                          ],
                        },
        );
        if (category === 'subagent') {
          expect(projected.toolCall).toHaveProperty(
            'childSessionId',
            'child-session',
          );
          expect(projected.toolCall?.detail).not.toHaveProperty(
            'childSessionId',
          );
        }
        listener({
          agentId: 'agent-1',
          eventType: 'tool_call',
          timestamp: '2026-08-07T00:00:00.000Z',
          seq: 1,
          epoch: 'epoch-1',
          timelineItemType: 'tool_call',
          ...projected,
        });
      });
      const adapter = new PaseoRuntimeAdapter(
        {
          wsUrl: 'ws://test',
          cwd: '/tmp/runtime-detail-test',
          provider: 'opencode',
          workspaceTitle: 'runtime detail test',
          connectTimeoutMs: 1_000,
          executionTimeoutMs: 1_000,
        },
        { log: () => undefined },
        client,
      );
      await adapter.execute(
        {
          operation: 'create',
          runId,
          provider: 'opencode',
          model: 'free/model',
          prompt: 'test',
          systemPrompt: 'test',
        },
        {
          emit: (event) => {
            emitted.push(event);
          },
        },
      );
      const event = emitted.find(
        (candidate) =>
          candidate.kind === 'tool_status' && candidate.category === category,
      );
      expect(event).toBeDefined();

      const typedEvent = event as Extract<
        RuntimeEvent,
        { kind: 'tool_status' }
      >;
      expect(typedEvent.resultObserved).toBe(category !== 'edit');
      const payload: RunEventPayload = runtimeEventPayload(typedEvent);
      const flatText =
        category === 'shell' ? 'provider detail text' : 'provider detail text';
      expect(payload).toMatchObject({
        provider: 'opencode',
        detail_kind: category,
        detail_text: flatText,
        detail: { kind: category },
      });
      if (category === 'shell') expect(payload).toHaveProperty('exit_code', 7);
      const semantic =
        category === 'shell'
          ? { command: 'pnpm test' }
          : category === 'read'
            ? { filePath: 'README.md' }
            : category === 'write'
              ? { filePath: 'output.txt' }
              : category === 'edit'
                ? { filePath: 'README.md' }
                : category === 'search'
                  ? { query: 'runtime detail' }
                  : category === 'fetch'
                    ? { url: 'https://example.test/docs' }
                    : {
                        subAgentType: 'reviewer',
                        description: 'review the patch',
                      };
      expect(payload.detail).toMatchObject({
        ...semantic,
        ...(category === 'shell'
          ? { output: 'provider detail text', exitCode: 7 }
          : category === 'read'
            ? { content: 'provider detail text' }
            : category === 'write'
              ? { content: 'provider detail text' }
              : category === 'edit'
                ? { unifiedDiff: 'provider detail text' }
                : category === 'search'
                  ? { content: 'provider detail text' }
                  : category === 'fetch'
                    ? { result: 'provider detail text' }
                    : { log: 'provider detail text' }),
      });
      if (category === 'search')
        expect(payload.detail).toMatchObject({
          toolName: 'grep',
          filePaths: ['README.md'],
          webResults: [{ title: 'Docs', url: 'https://example.test/docs' }],
          annotations: ['match', 'source'],
          numFiles: 1,
          numMatches: 1,
          durationMs: 2,
          durationSeconds: 0.002,
          truncated: false,
          mode: 'content',
        });
      if (category === 'fetch')
        expect(payload.detail).toMatchObject({
          url: 'https://example.test/docs',
          prompt: 'fetch docs',
          code: 200,
          codeText: 'OK',
          bytes: 10,
          durationMs: 3,
        });
      if (category === 'subagent')
        expect(payload.detail).not.toHaveProperty('childSessionId');
      const detail = payload.detail as { readonly kind?: unknown };
      expect(detail.kind).toBe(payload.detail_kind);

      const repository = new InMemoryRunEventRepository();
      await repository.append(runId, 'output', payload);
      const stored = (await repository.list(runId, 0)).events[0];
      expect(stored?.payload).toEqual(payload);
      expect(stored?.payload).toMatchObject({
        provider: 'opencode',
        detail_kind: category,
        detail_text: 'provider detail text',
      });
      if (category === 'shell')
        expect(stored?.payload).toHaveProperty('exit_code', 7);
    },
  );

  it('does not infer a detail discriminant from category when upstream omitted detail', () => {
    const payload = runtimeEventPayload({
      kind: 'tool_status',
      activityId: 'activity-1',
      category: 'shell',
      status: 'completed',
      label: 'Shell activity',
      summary: 'Shell activity.',
    } as RuntimeEvent);
    expect(payload).not.toHaveProperty('detail_kind');
    expect(payload).not.toHaveProperty('detail');
    expect(Object.prototype.hasOwnProperty.call(payload, 'detail_kind')).toBe(
      false,
    );
  });

  it('records canonical Team MCP provenance without provider detail', () => {
    const authorization = {
      isTeamMember: true,
      runtimeToolRefs: ['agent-server/team-state'],
      catalogTools: ['agent-server/team-state'],
    };
    const completed = runtimeEventPayload(
      {
        kind: 'tool_status',
        activityId: 'activity-team-1',
        category: 'other',
        status: 'completed',
        label: 'provider-controlled label',
        summary: 'provider-controlled summary',
        toolName: 'team_state',
        provider: 'untrusted-provider',
        resultObserved: true,
        detail: { kind: 'shell', output: 'must not persist' },
      },
      authorization,
    );
    expect(completed).toEqual({
      kind: 'tool_status',
      activity_id: 'activity-team-1',
      category: 'other',
      status: 'completed',
      tool_name: 'team_state',
      provenance: 'server_authorized_team_mcp_catalog',
      tool_identity_capture_status: 'present',
      response_observed: true,
    });

    const running = runtimeEventPayload(
      {
        kind: 'tool_status',
        activityId: 'activity-team-1',
        category: 'other',
        status: 'running',
        label: 'provider-controlled label',
        summary: 'provider-controlled summary',
        toolName: 'team_state',
        provider: 'untrusted-provider',
        resultObserved: false,
      },
      authorization,
    );
    expect(running).toMatchObject({
      provenance: 'server_authorized_team_mcp_catalog',
      response_observed: false,
    });
    expect(
      runtimeEventPayload({
        kind: 'tool_status',
        activityId: 'activity-team-no-context',
        category: 'other',
        status: 'completed',
        label: 'provider-controlled label',
        summary: 'provider-controlled summary',
        toolName: 'team_state',
        provider: 'untrusted-provider',
        resultObserved: true,
      }),
    ).not.toHaveProperty('provenance');

    const spoofed = runtimeEventPayload(
      {
        kind: 'tool_status',
        activityId: 'activity-spoofed',
        category: 'other',
        status: 'completed',
        label: 'team_state',
        summary: 'team_state',
        toolName: 'team_state_evil',
        provider: 'untrusted-provider',
        resultObserved: true,
      },
      authorization,
    );
    expect(spoofed).not.toHaveProperty('provenance');
    expect(spoofed).not.toHaveProperty('tool_name');
  });

  it('uses the provider returned by createAgent for runtime events', async () => {
    const emitted: RuntimeEvent[] = [];
    const client = createStreamingClient(
      (listener) => {
        const projected = projectTimelineItem({
          type: 'tool_call',
          callId: 'call-provider',
          name: 'shell',
          status: 'completed',
          detail: {
            type: 'shell',
            command: 'echo ok',
            output: 'ok',
            exitCode: 0,
          },
        });
        listener({
          agentId: 'agent-1',
          eventType: 'tool_call',
          timestamp: '2026-08-07T00:00:00.000Z',
          seq: 1,
          epoch: 'epoch-1',
          timelineItemType: 'tool_call',
          ...projected,
        });
      },
      'codex',
      'returned/model',
    );
    const adapter = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd: '/tmp/runtime-detail-test',
        provider: 'opencode',
        workspaceTitle: 'provider',
        connectTimeoutMs: 1_000,
        executionTimeoutMs: 1_000,
      },
      { log: () => undefined },
      client,
    );
    const execution = await adapter.execute(
      {
        operation: 'create',
        runId,
        provider: 'opencode',
        model: 'free/model',
        prompt: 'test',
        systemPrompt: 'test',
      },
      {
        emit: (event) => {
          emitted.push(event);
        },
      },
    );
    const event = emitted.find((candidate) => candidate.kind === 'tool_status');
    expect(event && event.provider).toBe('codex');
    expect(runtimeEventPayload(event!)).toMatchObject({ provider: 'codex' });
    expect(execution.provider).toBe('codex');
    expect(execution.model).toBe('returned/model');
  });
});

function createStreamingClient(
  publish: (
    listener: Parameters<
      NonNullable<PaseoClientPort['subscribeAgentStream']>
    >[0],
  ) => void,
  createdProvider = 'opencode',
  createdModel = 'free/model',
): PaseoClientPort {
  let streamListener:
    | Parameters<NonNullable<PaseoClientPort['subscribeAgentStream']>>[0]
    | undefined;
  return {
    connect: async () => undefined,
    connectionStatus: () => 'connected',
    openWorkspace: async () => 'workspace-1',
    setWorkspaceTitle: async () => undefined,
    listModels: async () => [{ id: 'free/model', label: 'free' }],
    createAgent: async () => ({
      id: 'agent-1',
      provider: createdProvider,
      model: createdModel,
    }),
    sendAgentMessage: async () => undefined,
    subscribeAgentStream: (listener) => {
      streamListener = listener;
      return () => undefined;
    },
    waitForFinish: async () => {
      if (streamListener) publish(streamListener);
      return {
        status: 'idle',
        error: null,
        lastMessage: 'done',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    close: async () => undefined,
  };
}
