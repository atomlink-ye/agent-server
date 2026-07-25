import { describe, expect, it } from 'vitest';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import {
  ResolveLarkBinding,
  type LarkBindingSessionPort,
} from './resolve-lark-binding.js';

const config: LarkCanaryEnabledConfig = {
  enabled: true,
  connectionKey: 'connection-1',
  appId: 'app-1',
  domain: 'feishu',
  appSecret: 'secret',
  botOpenId: 'ou_bot',
  allowedChatId: 'oc_chat',
  allowedOpenId: 'ou_user',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  serviceAccountId: 'svc-1',
  publishedAgentVersionId: 'agent-version-1',
  policyVersion: 'policy-1',
};

describe('ResolveLarkBinding', () => {
  it('fails closed for unknown chat and user without touching binding/session state', async () => {
    const port = fakeBindingPort();
    const resolver = new ResolveLarkBinding(port, config);
    await expect(
      resolver.execute(ingress({ chatId: 'other-chat' })),
    ).resolves.toMatchObject({ accepted: false, reason: 'chat_not_allowed' });
    await expect(
      resolver.execute(ingress({ externalActorId: 'other-user' })),
    ).resolves.toMatchObject({ accepted: false, reason: 'user_not_allowed' });
    expect(port.calls).toEqual([]);
  });

  it('requires a verified bot mention before creating a new root binding', async () => {
    const port = fakeBindingPort();
    const resolver = new ResolveLarkBinding(port, config);
    await expect(
      resolver.execute(ingress({ botMentionVerified: false })),
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'bot_mention_required',
    });
    expect(port.calls).toEqual(['find']);
  });

  it('uses the root fallback, reuses threads, and asks the atomic port for fresh roots', async () => {
    const port = fakeBindingPort();
    const resolver = new ResolveLarkBinding(port, config);
    await expect(
      resolver.execute(ingress({ botMentionVerified: true })),
    ).resolves.toMatchObject({
      accepted: true,
      sessionId: 'session-message-1',
      created: true,
    });
    await expect(
      resolver.execute(
        ingress({
          rootMessageId: 'message-1',
          externalMessageId: 'message-thread',
        }),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      sessionId: 'session-message-1',
      created: false,
    });
    await expect(
      resolver.execute(
        ingress({
          externalMessageId: 'message-new-root',
          botMentionVerified: true,
        }),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      sessionId: 'session-message-new-root',
      created: true,
    });
    expect(port.resolveInputs.map((input) => input.rootMessageId)).toEqual([
      'message-1',
      'message-1',
      'message-new-root',
    ]);
  });
});

function ingress(overrides: Partial<ChannelIngress> = {}): ChannelIngress {
  return {
    id: 'ingress-1',
    connectionKey: 'connection-1',
    kind: 'message',
    externalKey: 'message-1',
    externalMessageId: 'message-1',
    chatId: 'oc_chat',
    externalActorId: 'ou_user',
    text: 'remember this',
    normalizationVersion: 'lark-v1',
    status: 'pending',
    attemptCount: 0,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    botMentionVerified: false,
    ...overrides,
  };
}

function fakeBindingPort() {
  const calls: string[] = [];
  const resolveInputs: Array<{ rootMessageId: string }> = [];
  const sessions = new Map<string, string>();
  const port: LarkBindingSessionPort & {
    calls: string[];
    resolveInputs: Array<{ rootMessageId: string }>;
  } = {
    calls,
    resolveInputs,
    async findBinding(input) {
      calls.push('find');
      const sessionId = sessions.get(input.rootMessageId);
      return sessionId
        ? { id: `binding-${input.rootMessageId}`, sessionId }
        : null;
    },
    async resolveBindingWithSession(input) {
      calls.push('resolve');
      resolveInputs.push(input);
      const previous = sessions.get(input.rootMessageId);
      const sessionId = previous ?? `session-${input.rootMessageId}`;
      sessions.set(input.rootMessageId, sessionId);
      return {
        binding: {
          id: `binding-${input.rootMessageId}`,
          connectionKey: input.connectionKey,
          chatId: input.chatId,
          rootMessageId: input.rootMessageId,
          creatingIngressId: input.creatingIngressId,
          status: 'active' as const,
          createdAt: '2026-07-24T00:00:00.000Z',
          updatedAt: '2026-07-24T00:00:00.000Z',
        },
        sessionId,
        created: previous === undefined,
      };
    },
  };
  return port;
}
