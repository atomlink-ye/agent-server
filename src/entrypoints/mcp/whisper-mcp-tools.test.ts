import { describe, expect, it } from 'vitest';

import type { AuthorizedRuntimeToolContext } from '../../application/runtime/authorize-runtime-tool.js';
import { FakeWhisperRepository } from '../../application/whisper/whisper-repository.test-helper.js';
import {
  AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
  AGENT_SERVER_WHISPER_SEND_TOOL_REF,
  registerWhisperMcpTools,
} from './whisper-mcp-tools.js';

type Handler = (args: any) => Promise<{
  isError?: boolean;
  content: { text: string }[];
}>;

function grant(
  overrides?: Record<string, unknown>,
): AuthorizedRuntimeToolContext {
  return {
    grantId: 'grant-1',
    tenantId: 'tenant-test',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    principalType: 'service_account',
    principalId: 'runtime-principal',
    scopeId: 'chat-runtime-1',
    allowedTools: [
      AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
      AGENT_SERVER_WHISPER_SEND_TOOL_REF,
    ],
    catalogTools: [
      AGENT_SERVER_WHISPER_OPEN_TOOL_REF,
      AGENT_SERVER_WHISPER_SEND_TOOL_REF,
    ],
    runtimeSession: 'session-1',
    generation: 1,
    chatContext: {
      conversationId: '00000000-0000-4000-8000-000000000010',
      triggerMessageId: '00000000-0000-4000-8000-000000000011',
    },
    ...overrides,
  } as unknown as AuthorizedRuntimeToolContext;
}

function register(input: {
  readonly current: AuthorizedRuntimeToolContext | null;
  readonly identity: string | null;
  readonly repository?: FakeWhisperRepository;
  readonly grantOverrides?: Record<string, unknown>;
}) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: unknown, callback: Handler) {
      handlers.set(name, callback);
    },
  };
  const repository = input.repository ?? new FakeWhisperRepository();
  registerWhisperMcpTools({
    server: server as never,
    grant: grant(input.grantOverrides),
    async authorize() {
      return input.current;
    },
    repository,
    agentIdentities: {
      async resolve() {
        return input.identity;
      },
    },
  });
  return { handlers, repository };
}

describe('whisper_open MCP tool', () => {
  it('opens a whisper as the Coworker resolved from the conversation', async () => {
    const { handlers, repository } = register({
      current: grant(),
      identity: 'agent-a',
    });
    const result = await handlers.get('whisper_open')!({
      partner_agent_ids: ['agent-b'],
      opening_message: 'Need to align privately.',
      topic: 'align on W-1',
      work_ref: 'W-1',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.members).toEqual(['agent-a', 'agent-b']);
    expect(repository.openCalls[0]?.origin).toEqual({
      conversationId: '00000000-0000-4000-8000-000000000010',
      triggerMessageId: '00000000-0000-4000-8000-000000000011',
      workRef: 'W-1',
    });
  });

  it('refuses without a conversation context', async () => {
    const { handlers } = register({
      current: grant({ chatContext: undefined }),
      identity: 'agent-a',
      grantOverrides: { chatContext: undefined },
    });
    const result = await handlers.get('whisper_open')!({
      partner_agent_ids: ['agent-b'],
      opening_message: 'hi',
    });
    expect(result.isError).toBe(true);
  });

  it('refuses when the caller identity cannot be resolved', async () => {
    const { handlers } = register({ current: grant(), identity: null });
    const result = await handlers.get('whisper_open')!({
      partner_agent_ids: ['agent-b'],
      opening_message: 'hi',
    });
    expect(result.isError).toBe(true);
  });

  it('registers nothing when the grant does not carry the tool', () => {
    const handlers = new Map<string, Handler>();
    registerWhisperMcpTools({
      server: {
        registerTool(name: string, _config: unknown, callback: Handler) {
          handlers.set(name, callback);
        },
      } as never,
      grant: grant({ catalogTools: [] }),
      async authorize() {
        return null;
      },
      repository: new FakeWhisperRepository(),
      agentIdentities: {
        async resolve() {
          return null;
        },
      },
    });
    expect(handlers.size).toBe(0);
  });
});

describe('whisper_send MCP tool', () => {
  it('posts a follow-up as the resolved member', async () => {
    const repository = new FakeWhisperRepository();
    const { handlers } = register({
      current: grant(),
      identity: 'agent-a',
      repository,
    });
    const opened = await handlers.get('whisper_open')!({
      partner_agent_ids: ['agent-b'],
      opening_message: 'Opening.',
    });
    const channelId = JSON.parse(opened.content[0]!.text).whisper_channel_id;

    const { handlers: handlersAsB } = register({
      current: grant(),
      identity: 'agent-b',
      repository,
    });
    const result = await handlersAsB.get('whisper_send')!({
      whisper_channel_id: channelId,
      body: 'Got it.',
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text).sequence).toBe(2);
  });

  it('surfaces a non-member rejection as a tool error', async () => {
    const repository = new FakeWhisperRepository();
    const { handlers } = register({
      current: grant(),
      identity: 'agent-a',
      repository,
    });
    const opened = await handlers.get('whisper_open')!({
      partner_agent_ids: ['agent-b'],
      opening_message: 'Opening.',
    });
    const channelId = JSON.parse(opened.content[0]!.text).whisper_channel_id;

    const { handlers: handlersOutsider } = register({
      current: grant(),
      identity: 'agent-outsider',
      repository,
    });
    const result = await handlersOutsider.get('whisper_send')!({
      whisper_channel_id: channelId,
      body: 'Should not land.',
    });
    expect(result.isError).toBe(true);
  });
});
