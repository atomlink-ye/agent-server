import { describe, expect, it } from 'vitest';
import type { LarkCanaryEnabledConfig } from '../../shared/config.js';
import type { ChannelIngress } from '../../domain/channels/channel-event.js';
import { SubmitSessionTurn } from '../sessions/submit-session-turn.js';
import {
  ProcessChannelIngress,
  type ChannelIngressStatusPort,
} from './process-channel-ingress.js';
import {
  ResolveLarkBinding,
  type LarkBindingSessionPort,
} from './resolve-lark-binding.js';

const config: LarkCanaryEnabledConfig = {
  enabled: true,
  connectionKey: 'connection-1',
  appId: 'app-1',
  domain: 'lark',
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

describe('ProcessChannelIngress', () => {
  it('submits a trusted Lark turn and completes the ingress with task/session IDs', async () => {
    const turns: unknown[] = [];
    const statuses: unknown[] = [];
    const process = new ProcessChannelIngress(
      new ResolveLarkBinding(bindingPort(), config),
      new SubmitSessionTurn({
        async postMessage(input) {
          turns.push(input);
          return {
            id: 'message-1',
            sessionId: 'session-message-1',
            generation: 0,
            sequence: 1,
            role: 'user',
            text: input.text,
            taskId: 'task-1',
            runId: 'run-1',
            status: 'queued',
            createdAt: '2026-07-24T00:00:00.000Z',
          };
        },
      }),
      statusPort(statuses),
      config,
    );
    await expect(
      process.execute(ingress({ botMentionVerified: true })),
    ).resolves.toMatchObject({
      accepted: true,
      sessionId: 'session-message-1',
    });
    expect(turns[0]).toMatchObject({
      sessionId: 'session-message-1',
      text: 'remember this',
      idempotencyKey: 'message-1',
      owner: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalId: 'svc-1',
        policySnapshotVersion: 'policy-1',
      },
      origin: { channel: 'lark', ingressEventId: 'ingress-1' },
    });
    expect(statuses).toEqual([
      expect.objectContaining({
        ingressId: 'ingress-1',
        status: 'processed',
        admittedSessionId: 'session-message-1',
        admittedTaskId: 'task-1',
      }),
    ]);
  });

  it('completes fail-closed ignored events so claimed ingress cannot loop forever', async () => {
    const statuses: unknown[] = [];
    const process = new ProcessChannelIngress(
      new ResolveLarkBinding(bindingPort(), config),
      new SubmitSessionTurn({
        postMessage: async () => {
          throw new Error('must not submit');
        },
      }),
      statusPort(statuses),
      config,
    );
    await expect(
      process.execute(ingress({ chatId: 'other-chat' })),
    ).resolves.toMatchObject({
      accepted: false,
      reason: 'chat_not_allowed',
    });
    expect(statuses).toEqual([
      {
        ingressId: 'ingress-1',
        status: 'processed',
        safeErrorCode: 'chat_not_allowed',
        leaseOwner: 'worker-1',
        attemptNumber: 1,
      },
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
    attemptCount: 1,
    leaseOwner: 'worker-1',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    botMentionVerified: false,
    ...overrides,
  };
}

function bindingPort(): LarkBindingSessionPort {
  return {
    async findBinding(input) {
      return input.rootMessageId === 'message-1'
        ? null
        : { id: 'binding-1', sessionId: 'session-message-1' };
    },
    async resolveBindingWithSession(input) {
      return {
        binding: {
          id: 'binding-1',
          connectionKey: input.connectionKey,
          chatId: input.chatId,
          rootMessageId: input.rootMessageId,
          creatingIngressId: input.creatingIngressId,
          status: 'active' as const,
          createdAt: '2026-07-24T00:00:00.000Z',
          updatedAt: '2026-07-24T00:00:00.000Z',
        },
        sessionId: 'session-message-1',
        created: true,
      };
    },
  };
}

function statusPort(statuses: unknown[]): ChannelIngressStatusPort {
  return {
    async completeIngress(input) {
      statuses.push(input);
    },
  };
}
