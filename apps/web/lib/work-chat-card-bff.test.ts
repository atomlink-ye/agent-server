import { afterEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({
  getChatWorkCard: vi.fn(),
}));

vi.mock('@/lib/agent-server-client', () => ({
  AgentServerError: class AgentServerError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  },
  ...upstream,
}));

import {
  readWorkChatCardBff,
  workChatCardErrorResponse,
} from '@/lib/work-chat-card-bff';
import { AgentServerError } from '@/lib/agent-server-client';

afterEach(() => {
  vi.clearAllMocks();
});

const workId = '00000000-0000-4000-8000-000000000001';

describe('work chat card BFF', () => {
  it('returns only safe card fields and keeps the opaque session boundary', async () => {
    upstream.getChatWorkCard.mockResolvedValue({
      workId,
      workRef: workId,
      title: 'Example Work',
      productState: 'complete',
      problemKind: null,
      attentionReason: null,
      resultSummary: 'Done',
      resultCaptureStatus: 'present',
      taskId: 'task-secret',
      runId: 'run-secret',
      providerSessionId: 'provider-secret',
      sessionId: 'session-secret',
    });

    await expect(
      readWorkChatCardBff('opaque-session', workId),
    ).resolves.toEqual({
      workId,
      workRef: workId,
      title: 'Example Work',
      productState: 'complete',
      problemKind: null,
      attentionReason: null,
      resultSummary: 'Done',
      resultCaptureStatus: 'present',
    });
    expect(upstream.getChatWorkCard).toHaveBeenCalledWith(workId);
    expect(
      JSON.stringify(await readWorkChatCardBff('opaque-session', workId)),
    ).not.toMatch(/task|run|provider|session/i);
  });

  it('does not expose an upstream internal error body or code', async () => {
    upstream.getChatWorkCard.mockRejectedValue(
      new AgentServerError(500, 'database_password=super-secret'),
    );

    const result = await readWorkChatCardBff('opaque-session', workId).catch(
      workChatCardErrorResponse,
    );
    expect(result).toEqual({
      status: 502,
      body: {
        error: {
          code: 'work_chat_card_unavailable',
          message: 'Work Chat cards are unavailable.',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });

  it('requires a session and validates the work UUID before upstream access', async () => {
    await expect(readWorkChatCardBff(undefined, workId)).rejects.toMatchObject({
      status: 401,
      code: 'missing_session',
    });
    await expect(
      readWorkChatCardBff('opaque-session', 'not-a-uuid'),
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
    });
    expect(upstream.getChatWorkCard).not.toHaveBeenCalled();
  });
});
