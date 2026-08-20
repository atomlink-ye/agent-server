import { afterEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  postConversationMessage: vi.fn(),
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
  conversationErrorResponse,
  listConversationBff,
  postConversationBff,
  readConversationBff,
} from '@/lib/conversation-bff';
import { AgentServerError } from '@/lib/agent-server-client';

afterEach(() => {
  vi.clearAllMocks();
});

const conversation = {
  conversation_id: 'conv-1',
  kind: 'direct' as const,
  title: 'A conversation',
  direct_agent: null,
  topic: null,
  created_at: '2026-08-20T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:01.000Z',
  links: { self: 'https://internal.example/secret' },
};

const message = {
  message_id: 'msg-1',
  conversation_id: 'conv-1',
  sequence: 1,
  author_type: 'principal' as const,
  author_id: 'principal-1',
  body: 'hello',
  agent_definition_id: 'agent-1',
  agent_version_id: null,
  runtime_epoch: null,
  work_ref: null,
  created_at: '2026-08-20T00:00:02.000Z',
  internal: 'must not escape',
};

describe('conversation BFF', () => {
  it('supports list, read, and post through the configured server client', async () => {
    upstream.listConversations.mockResolvedValue({
      conversations: [conversation],
    });
    upstream.getConversation.mockResolvedValue({ conversation });
    upstream.postConversationMessage.mockResolvedValue({
      message,
      dispatch_enqueued: true,
    });

    await expect(listConversationBff()).resolves.toEqual({
      conversations: [
        {
          conversation_id: 'conv-1',
          kind: 'direct',
          title: 'A conversation',
          direct_agent: null,
          topic: null,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
        },
      ],
    });
    await expect(readConversationBff('conv-1')).resolves.toEqual({
      conversation: expect.objectContaining({ conversation_id: 'conv-1' }),
    });
    await expect(postConversationBff('conv-1', 'hello')).resolves.toEqual({
      message: expect.objectContaining({ message_id: 'msg-1', body: 'hello' }),
      dispatch_enqueued: true,
    });
    expect(upstream.getConversation).toHaveBeenCalledWith('conv-1');
    expect(upstream.postConversationMessage).toHaveBeenCalledWith('conv-1', 'hello');
  });

  it('forwards an unknown id to the upstream membership check', async () => {
    upstream.getConversation.mockRejectedValue(new AgentServerError(404, 'not_found'));
    upstream.postConversationMessage.mockRejectedValue(new AgentServerError(404, 'not_found'));

    await expect(readConversationBff('not-listed')).rejects.toMatchObject({
      status: 404,
      code: 'conversation_unavailable',
    });
    await expect(postConversationBff('not-listed', 'intent')).rejects.toMatchObject({
      status: 404,
      code: 'conversation_unavailable',
    });
    expect(upstream.getConversation).toHaveBeenCalledWith('not-listed');
    expect(upstream.postConversationMessage).toHaveBeenCalledWith('not-listed', 'intent');
  });

  it('does not expose an upstream internal error body or code', async () => {
    upstream.listConversations.mockRejectedValue(
      new AgentServerError(500, 'database_password=super-secret'),
    );

    const result = await listConversationBff().catch(conversationErrorResponse);
    expect(result).toEqual({
      status: 502,
      body: {
        error: {
          code: 'conversation_unavailable',
          message: 'Conversations are unavailable.',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
  });
});
