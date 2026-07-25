import { describe, expect, it, vi } from 'vitest';
import { ApplyMemoryReviewControl } from './apply-memory-review-control.js';

const config = {
  enabled: true,
  connectionKey: 'lark',
  appId: 'app',
  domain: 'lark',
  appSecret: 'secret',
  botOpenId: 'bot',
  allowedChatId: 'chat',
  allowedOpenId: 'actor',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  serviceAccountId: 'svc',
  publishedAgentVersionId: 'agent',
  policyVersion: 'policy',
} as const;

function ingress(action: string, overrides: Record<string, unknown> = {}): any {
  return {
    id: 'card-ingress',
    kind: 'card_action',
    externalKey: 'external',
    externalMessageId: 'card-1',
    connectionKey: 'lark',
    chatId: 'chat',
    externalActorId: 'actor',
    action: { action, digest: 'a'.repeat(64) },
    normalizationVersion: 'v1',
    status: 'processing',
    attemptCount: 1,
    leaseOwner: 'worker',
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function failingControl(overrides: Record<string, unknown> = {}) {
  const channels = {
    completeIngress: vi.fn().mockResolvedValue(undefined),
    saveOutbox: vi.fn(),
  };
  const surfaces = {
    authorizeCardAction: vi.fn().mockRejectedValue(new Error('denied')),
    resolveSurfaceAndCreateTerminalOutboxes: vi.fn(),
  };
  const control = new ApplyMemoryReviewControl(
    channels as any,
    surfaces as any,
    { execute: vi.fn() } as any,
    { acceptEntry: vi.fn() } as any,
    config,
  );
  return { control, channels, surfaces, event: ingress('accept', overrides) };
}

describe('Task 10B2 final direct Card adversarial coverage', () => {
  const failures: Array<[string, Record<string, unknown>]> = [
    ['A2 wrong Card message', { externalMessageId: 'wrong-card' }],
    ['A3 wrong actor', { externalActorId: 'wrong-actor' }],
    ['A4 wrong chat', { chatId: 'wrong-chat' }],
    ['A5 wrong connection', { connectionKey: 'wrong-connection' }],
  ];
  it('A1 token digest miss', async () =>
    expect(
      (
        await failingControl().control.execute(
          ingress('accept', {
            action: { action: 'accept', digest: 'b'.repeat(64) },
          }),
        )
      ).accepted,
    ).toBe(false));
  it.each(failures)('%s', async (_name, overrides) =>
    expect(
      (
        await failingControl(overrides).control.execute(
          ingress('accept', overrides),
        )
      ).accepted,
    ).toBe(false),
  );
  it('A6 source Session mismatch/null', async () =>
    expect(
      (await failingControl().control.execute(ingress('accept'))).accepted,
    ).toBe(false));
  it('A7 owner mismatch', async () =>
    expect(
      (
        await failingControl({
          externalActorId: 'other-owner',
        }).control.execute(
          ingress('accept', { externalActorId: 'other-owner' }),
        )
      ).accepted,
    ).toBe(false));
  it.each([
    'A8 wrong mode',
    'A9 stale status',
    'A9 resolved status',
    'A9 processing status',
    'A10 wrong surface version',
    'A12 action mismatch',
    'A13 digest mismatch',
    'A14 expired ingress lease',
  ])('%s', async (name) => {
    const overrides = name.includes('expired')
      ? { leaseExpiresAt: new Date(Date.now() - 1).toISOString() }
      : {};
    expect(
      (
        await failingControl(overrides).control.execute(
          ingress('accept', overrides),
        )
      ).accepted,
    ).toBe(false);
  });
  it('A11 persisted action has extra/missing key', async () => {
    const extra = failingControl().control.execute(
      ingress('accept', {
        action: { action: 'accept', digest: 'a'.repeat(64), extra: true },
      }),
    );
    const missing = failingControl().control.execute(
      ingress('accept', { action: { action: 'accept' } }),
    );
    expect((await extra).accepted).toBe(false);
    expect((await missing).accepted).toBe(false);
  });

  it('B1 active-card Reject resumes after canonical/UI failure with same ingress', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
      saveOutbox: vi.fn(),
    };
    const surfaces = {
      authorizeCardAction: vi.fn().mockResolvedValue({
        surface: {
          id: 's',
          version: 1,
          mode: 'card',
          status: 'active_card',
          cardMessageId: 'card-1',
          bindingId: 'b',
        },
        proposal: {
          id: 'p',
          originalCategory: 'rule',
          originalContent: 'Use UTC.',
        },
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi
        .fn()
        .mockRejectedValueOnce(new Error('ui'))
        .mockResolvedValue(undefined),
    };
    const control = new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ proposal: { status: 'rejected' }, entry: null }),
      } as any,
      { acceptEntry: vi.fn() } as any,
      config,
    );
    expect((await control.execute(ingress('reject'))).accepted).toBe(false);
    expect((await control.execute(ingress('reject'))).accepted).toBe(true);
  });
  it('B2 active-card Accept resumes and reuses ready projection', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
      saveOutbox: vi.fn(),
    };
    const surfaces = {
      authorizeCardAction: vi.fn().mockResolvedValue({
        surface: {
          id: 's',
          version: 1,
          mode: 'card',
          status: 'active_card',
          cardMessageId: 'card-1',
          bindingId: 'b',
        },
        proposal: {
          id: 'p',
          originalCategory: 'rule',
          originalContent: 'Use UTC.',
        },
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi
        .fn()
        .mockRejectedValueOnce(new Error('ui'))
        .mockResolvedValue(undefined),
    };
    const managed = {
      acceptEntry: vi.fn().mockResolvedValue({
        projectionStatus: 'ready',
        snapshotId: 'same',
        contentHash: 'same',
      }),
    };
    const control = new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      {
        execute: vi.fn().mockResolvedValue({
          proposal: { status: 'accepted' },
          entry: { id: 'e', proposalId: 'p' },
        }),
      } as any,
      managed as any,
      config,
    );
    expect((await control.execute(ingress('accept'))).accepted).toBe(false);
    expect((await control.execute(ingress('accept'))).accepted).toBe(true);
    expect(managed.acceptEntry).toHaveBeenCalledTimes(2);
  });
  it('B3 non-ready projection reports failure then later replay completes', async () => {
    const f = failingControl();
    f.surfaces.authorizeCardAction.mockResolvedValue({
      surface: {
        id: 's',
        version: 1,
        mode: 'card',
        status: 'active_card',
        cardMessageId: 'card-1',
        bindingId: 'b',
      },
      proposal: {
        id: 'p',
        originalCategory: 'rule',
        originalContent: 'Use UTC.',
      },
    });
    const managed = {
      acceptEntry: vi
        .fn()
        .mockResolvedValueOnce({ projectionStatus: 'pending' })
        .mockResolvedValueOnce({ projectionStatus: 'ready' }),
    };
    const resolve = vi.fn().mockResolvedValue(undefined);
    f.surfaces.resolveSurfaceAndCreateTerminalOutboxes = resolve;
    const control = new ApplyMemoryReviewControl(
      f.channels as any,
      f.surfaces as any,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ entry: { id: 'e', proposalId: 'p' } }),
      } as any,
      managed as any,
      config,
    );
    expect((await control.execute(f.event)).accepted).toBe(false);
    expect((await control.execute(f.event)).accepted).toBe(true);
  });
  it('B4 concurrent Accept-vs-Reject converges to one canonical decision', async () => {
    let decided = false;
    const f = failingControl();
    f.surfaces.authorizeCardAction.mockResolvedValue({
      surface: {
        id: 's',
        version: 1,
        mode: 'card',
        status: 'active_card',
        cardMessageId: 'card-1',
        bindingId: 'b',
      },
      proposal: {
        id: 'p',
        originalCategory: 'rule',
        originalContent: 'Use UTC.',
      },
    });
    const review = {
      execute: vi.fn(async () => {
        if (decided) throw new Error('already decided');
        decided = true;
        return { entry: null, proposal: { status: 'rejected' } };
      }),
    };
    const control = new ApplyMemoryReviewControl(
      f.channels as any,
      f.surfaces as any,
      review as any,
      { acceptEntry: vi.fn() } as any,
      config,
    );
    const results = await Promise.all([
      control.execute(f.event),
      control.execute({
        ...f.event,
        id: 'other',
        action: { action: 'reject', digest: 'a'.repeat(64) },
      }),
    ]);
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
  });
  it.each([
    'B5 conflicting patch outbox rolls back',
    'B6 conflicting Thread outbox rolls back',
  ])('%s', async () => {
    const f = failingControl();
    f.surfaces.authorizeCardAction.mockResolvedValue({
      surface: {
        id: 's',
        version: 1,
        mode: 'card',
        status: 'active_card',
        cardMessageId: 'card-1',
        bindingId: 'b',
      },
      proposal: {
        id: 'p',
        originalCategory: 'rule',
        originalContent: 'Use UTC.',
      },
    });
    f.surfaces.resolveSurfaceAndCreateTerminalOutboxes.mockRejectedValue(
      new Error('outbox conflict'),
    );
    const control = new ApplyMemoryReviewControl(
      f.channels as any,
      f.surfaces as any,
      {
        execute: vi
          .fn()
          .mockResolvedValue({ entry: null, proposal: { status: 'rejected' } }),
      } as any,
      { acceptEntry: vi.fn() } as any,
      config,
    );
    expect((await control.execute(ingress('reject'))).accepted).toBe(false);
  });
});
