import { describe, expect, it, vi } from 'vitest';

import { createLarkIngressWorker } from './bootstrap.js';
import {
  closeServiceResources,
  startServiceResources,
} from './composition/lifecycle-supervisor.js';
import type { ChannelIngress } from './domain/channels/channel-event.js';
import { ProcessLarkIngress } from './application/channels/process-lark-ingress.js';
import { ApplyMemoryReviewControl } from './application/channels/apply-memory-review-control.js';
import { larkMemoryReviewCardRenderer } from './adapters/lark/lark-memory-card.js';

describe('closeServiceResources', () => {
  it('E2 bootstraps a claimed Card ingress into the Card control path', async () => {
    const cardIngress = {
      id: 'bootstrap-card',
      kind: 'card_action',
      externalKey: 'bootstrap-card',
      externalMessageId: 'card-1',
      connectionKey: 'connection',
      chatId: 'chat',
      externalActorId: 'user',
      action: { action: 'reject', digest: 'a'.repeat(64) },
      normalizationVersion: 'v1',
      status: 'processing',
      attemptCount: 1,
      leaseOwner: 'worker',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: '',
      updatedAt: '',
    } as any;
    const completeIngress = vi.fn().mockResolvedValue(undefined);
    const message = { execute: vi.fn() };
    const command = { execute: vi.fn() };
    const control = new ApplyMemoryReviewControl(
      { completeIngress, saveOutbox: vi.fn() } as any,
      {
        authorizeCardAction: vi.fn().mockResolvedValue({
          surface: {
            id: 'surface',
            version: 1,
            mode: 'card',
            status: 'active_card',
            cardMessageId: 'card-1',
            bindingId: 'binding',
          },
          proposal: {
            id: 'proposal',
            originalCategory: 'rule',
            originalContent: 'Use UTC.',
          },
        }),
        resolveSurfaceAndCreateTerminalOutboxes: vi
          .fn()
          .mockResolvedValue(undefined),
      } as any,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ proposal: { status: 'rejected' }, entry: null }),
      } as any,
      { acceptEntry: vi.fn() } as any,
      {
        enabled: true,
        connectionKey: 'connection',
        appId: 'app',
        domain: 'lark',
        appSecret: 'secret',
        botOpenId: 'bot',
        allowedChatId: 'chat',
        allowedOpenId: 'user',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        serviceAccountId: 'svc',
        publishedAgentVersionId: 'agent',
        policyVersion: 'policy',
      },
      larkMemoryReviewCardRenderer,
    );
    const processor = new ProcessLarkIngress(message, command, control);
    const claimIngress = vi
      .fn()
      .mockResolvedValueOnce(cardIngress)
      .mockResolvedValue(null);
    const worker = createLarkIngressWorker(
      { claimIngress, completeIngress },
      processor,
      {
        enabled: true,
        connectionKey: 'connection',
        appId: 'app',
        domain: 'lark',
        appSecret: 'secret',
        botOpenId: 'bot',
        allowedChatId: 'chat',
        allowedOpenId: 'user',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        serviceAccountId: 'svc',
        publishedAgentVersionId: 'agent',
        policyVersion: 'policy',
      },
      { log: vi.fn() } as any,
      { workerId: 'worker', leaseMs: 30_000 },
    );
    worker.start();
    await vi.waitFor(() =>
      expect(completeIngress).toHaveBeenCalledWith(
        expect.objectContaining({
          ingressId: 'bootstrap-card',
          status: 'processed',
        }),
      ),
    );
    await worker.stop();
    expect(message.execute).not.toHaveBeenCalled();
    expect(command.execute).not.toHaveBeenCalled();
  });
  it('stops Lark ingress before dispatcher, runtime, and database resources', async () => {
    const events: string[] = [];
    const dispatcherStopped = createDeferred();

    const closing = closeServiceResources({
      dispatcher: {
        stop: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              events.push('dispatcher.stop:start');
              dispatcherStopped.resolve = () => {
                events.push('dispatcher.stop:done');
                resolve();
              };
            }),
        ),
      },
      larkReceiver: {
        stop: vi.fn(async () => {
          events.push('lark.receiver.stop');
        }),
      },
      larkWorker: {
        stop: vi.fn(async () => {
          events.push('lark.worker.stop');
        }),
      },
      runtimeProvider: {
        close: vi.fn(async () => {
          events.push('runtime.close');
        }),
      },
      pool: {
        end: vi.fn(async () => {
          events.push('pool.end');
        }),
      },
    });

    await vi.waitFor(() =>
      expect(events).toEqual([
        'lark.receiver.stop',
        'lark.worker.stop',
        'dispatcher.stop:start',
      ]),
    );
    dispatcherStopped.resolve();
    await closing;

    expect(events).toEqual([
      'lark.receiver.stop',
      'lark.worker.stop',
      'dispatcher.stop:start',
      'dispatcher.stop:done',
      'runtime.close',
      'pool.end',
    ]);
  });

  it('rolls back every started resource when startup fails', async () => {
    const events: string[] = [];
    const resources = {
      dispatcher: {
        start: vi.fn(() => events.push('dispatcher.start')),
        stop: vi.fn(async (): Promise<void> => {
          events.push('dispatcher.stop');
        }),
      },
      larkReceiver: {
        start: vi.fn(async (): Promise<void> => {
          events.push('receiver.start');
        }),
        stop: vi.fn(async (): Promise<void> => {
          events.push('receiver.stop');
        }),
      },
      larkWorker: {
        start: vi.fn(() => {
          events.push('worker.start');
          throw new Error('worker startup secret');
        }),
        stop: vi.fn(async (): Promise<void> => {
          events.push('worker.stop');
        }),
      },
      runtimeProvider: {
        close: vi.fn(async (): Promise<void> => {
          events.push('runtime.close');
        }),
      },
      pool: {
        end: vi.fn(async (): Promise<void> => {
          events.push('pool.end');
        }),
      },
    };

    await expect(startServiceResources(resources)).rejects.toThrow(
      'service startup failed',
    );
    expect(events).toEqual([
      'dispatcher.start',
      'receiver.start',
      'worker.start',
      'receiver.stop',
      'worker.stop',
      'dispatcher.stop',
      'runtime.close',
      'pool.end',
    ]);
  });

  it('attempts every cleanup step and throws a safe aggregate failure', async () => {
    const events: string[] = [];
    const resources = {
      dispatcher: {
        stop: vi.fn(async (): Promise<void> => {
          events.push('dispatcher');
          throw new Error('dispatcher secret');
        }),
      },
      larkReceiver: {
        stop: vi.fn(async (): Promise<void> => {
          events.push('receiver');
          throw new Error('receiver secret');
        }),
      },
      larkWorker: {
        stop: vi.fn(async (): Promise<void> => {
          events.push('worker');
          throw new Error('worker secret');
        }),
      },
      runtimeProvider: {
        close: vi.fn(async (): Promise<void> => {
          events.push('runtime');
          throw new Error('runtime secret');
        }),
      },
      pool: {
        end: vi.fn(async (): Promise<void> => {
          events.push('pool');
          throw new Error('pool secret');
        }),
      },
    };

    await expect(closeServiceResources(resources)).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(events).toEqual([
      'receiver',
      'worker',
      'dispatcher',
      'runtime',
      'pool',
    ]);
  });

  it('wires one safe structured Lark worker failure log', async () => {
    const logs: unknown[] = [];
    const worker = createLarkIngressWorker(
      {
        claimIngress: vi
          .fn<() => Promise<ChannelIngress | null>>()
          .mockRejectedValue(new Error('database secret')),
        completeIngress: vi.fn(),
      },
      { execute: vi.fn() },
      {
        enabled: true,
        connectionKey: 'connection',
        appId: 'cli_0123456789abcdef',
        domain: 'feishu',
        appSecret: 'secret',
        botOpenId: 'bot',
        allowedChatId: 'chat',
        allowedOpenId: 'user',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        serviceAccountId: 'service',
        publishedAgentVersionId: 'agent',
        policyVersion: 'policy',
      },
      {
        log: vi.fn((_level, event, attributes) =>
          logs.push({ event, attributes }),
        ),
      },
    );

    worker.start();
    await vi.waitFor(() =>
      expect(logs).toEqual([
        {
          event: 'lark.ingress_worker.failed',
          attributes: { phase: 'claim', error_name: 'Error' },
        },
      ]),
    );
    await worker.stop();
    expect(JSON.stringify(logs)).not.toContain('database secret');
  });
});

function createDeferred(): { resolve: () => void } {
  return { resolve: () => undefined };
}
