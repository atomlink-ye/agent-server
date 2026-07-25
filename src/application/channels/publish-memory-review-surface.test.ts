import { describe, expect, it, vi } from 'vitest';

import { PublishMemoryReviewSurface } from './publish-memory-review-surface.js';
import { createMemoryProposal } from '../../domain/workspace-memory/memory-proposal.js';
import { createRootTask, transitionTask } from '../../domain/tasks/task.js';
import { createMemoryReviewActionTokenDeriver } from './memory-review-action-token.js';

describe('PublishMemoryReviewSurface', () => {
  it('publishes an Agent result even when the run has no memory proposals', async () => {
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: true,
    }));

    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => []),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
    ).execute({
      run: succeededRun({ text: 'The final answer from the Agent.' }),
      task: task() as never,
    });

    expect(saveOutbox).toHaveBeenCalledTimes(1);
    expect(saveOutbox.mock.calls[0]![0]).toMatchObject({
      connectionKey: 'lark-canary',
      bindingId: 'binding-1',
      targetId: 'root-1',
      deliveryKind: 'agent_run_result',
      aggregateId: 'run-1',
      aggregateVersion: 1,
      payload: 'Agent final answer:\nThe final answer from the Agent.',
    });
  });

  it('creates one command-only outbox per pending proposal for a bound session', async () => {
    const proposalId = '00000000-0000-4000-8000-000000000001';
    const proposal = createMemoryProposal({
      id: proposalId,
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: 'do not expose this content',
      originalCategory: 'preference',
      sourceTaskId: 'task-1',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: true,
    }));

    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      {
        findBindingBySessionId: vi.fn(async () => ({
          id: 'binding-1',
          connectionKey: 'lark-canary',
          chatId: 'chat-1',
          rootMessageId: 'root-1',
          sessionId: 'session-1',
          creatingIngressId: 'ingress-1',
          status: 'active' as const,
          createdAt: '',
          updatedAt: '',
        })),
      },
      { saveOutbox },
    ).execute({
      run: succeededRun({ text: 'Answer alongside a proposal.' }),
      task: task() as never,
    });

    expect(saveOutbox).toHaveBeenCalledTimes(2);
    const outbox = saveOutbox.mock.calls[1]![0];
    expect(outbox.connectionKey).toBe('lark-canary');
    expect(outbox.bindingId).toBe('binding-1');
    expect(outbox.aggregateId).toBe(proposalId);
    expect(outbox.aggregateVersion).toBe(1);
    expect(outbox.providerRequestId.length).toBeLessThanOrEqual(50);
    expect(outbox.payload).toContain('/memory accept');
    expect(outbox.payload).toContain('/memory edit-and-accept');
    expect(outbox.payload).toContain('/memory reject');
    expect(outbox.payload).not.toContain('do not expose this content');
    expect(saveOutbox.mock.calls[0]![0]).toMatchObject({
      deliveryKind: 'agent_run_result',
      aggregateId: 'run-1',
      payload: 'Agent final answer:\nAnswer alongside a proposal.',
    });
  });

  it('immediately creates a Doc and publishes a card_with_doc surface', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000003',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: 'Keep deployments reversible.',
      originalCategory: 'constraint',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const createSurface = vi.fn(async (input) => input);
    const createCardSurfaceAndOutbox = vi.fn(
      async ({ surface }: { surface: never; outbox: never }) =>
        createSurface(surface),
    );

    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox: vi.fn() },
      'lark-canary',
      {
        createCardSurfaceAndOutbox,
        getActiveSurface: vi.fn(async () => null),
      } as never,
      createMemoryReviewActionTokenDeriver('secret'),
      {
        create: vi.fn().mockResolvedValue({
          token: 'doc-short',
          revision: '1',
          url: 'https://lark.test/docx/doc-short',
        }),
        readDraft: vi.fn(),
      },
      'user',
    ).execute({ run: succeededRun(), task: task() as never });

    expect(createSurface).toHaveBeenCalledTimes(1);
    const surface = createSurface.mock.calls[0]![0];
    expect(surface).toMatchObject({
      mode: 'card_with_doc',
      docToken: 'doc-short',
      docRevision: '1',
      status: 'planned',
      proposalId: proposal.id,
    });
    expect(surface.actionTokenHash).toMatch(/^[a-f0-9]{64}$/);
    const outbox = createCardSurfaceAndOutbox.mock.calls[0]![0]
      .outbox as never as {
      deliveryKind: string;
      aggregateId: string;
      payload: string;
    };
    expect(outbox.deliveryKind).toBe('lark_card_reply');
    expect(outbox.aggregateId).toBe(proposal.id);
    expect(outbox.payload).toContain('Keep deployments reversible.');
    expect(outbox.payload).not.toContain(surface.actionTokenHash);
    expect(outbox.payload).not.toContain('token');
    expect(JSON.parse(outbox.payload)).toMatchObject({
      type: 'lark_memory_doc_card_v1',
      surfaceId: surface.id,
      version: 1,
      proposalId: proposal.id,
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
      },
      category: 'constraint',
      content: 'Keep deployments reversible.',
      docToken: 'doc-short',
    });
  });

  it('keeps long proposals on the safe command fallback instead of faking a short Card', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000004',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: 'line\n'.repeat(21),
      originalCategory: 'notes',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: true,
    }));
    const createSurface = vi.fn(async (input) => input);
    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
      'lark-canary',
      { createSurface, getActiveSurface: vi.fn(async () => null) } as never,
    ).execute({ run: succeededRun(), task: task() as never });
    expect(saveOutbox.mock.calls[0]![0].deliveryKind).toBe(
      'memory_review_command',
    );
    expect(saveOutbox.mock.calls[0]![0].payload).toContain('/memory accept');
  });

  it('replay does not create another active surface or Card outbox', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000005',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: 'Replay safely.',
      originalCategory: 'note',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: true,
    }));
    const createSurface = vi.fn(async (input) => input);
    const getActiveSurface = vi.fn(async () => ({ id: 'existing' }));
    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
      'lark-canary',
      { createSurface, getActiveSurface } as never,
    ).execute({ run: succeededRun(), task: task() as never });
    expect(createSurface).not.toHaveBeenCalled();
    expect(saveOutbox).not.toHaveBeenCalled();
  });

  it('keeps the Agent result request stable across replay and bounds UTF-8 payloads', async () => {
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: saveOutbox.mock.calls.length === 0,
    }));
    const notifier = new PublishMemoryReviewSurface(
      { listPendingProposalsBySourceRunForOwner: vi.fn(async () => []) },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
    );

    await notifier.execute({
      run: succeededRun({ text: '🙂'.repeat(10_000) }),
      task: task() as never,
    });
    await notifier.execute({
      run: succeededRun({ text: '🙂'.repeat(10_000) }),
      task: task() as never,
    });

    expect(saveOutbox).toHaveBeenCalledTimes(2);
    const first = saveOutbox.mock.calls[0]![0];
    const second = saveOutbox.mock.calls[1]![0];
    expect(first.deliveryKind).toBe('agent_run_result');
    expect(Buffer.byteLength(first.payload, 'utf8')).toBeLessThanOrEqual(8192);
    expect(first.payload).not.toContain('\uFFFD');
    expect(
      `Agent final answer:\n${'🙂'.repeat(10_000)}`.startsWith(first.payload),
    ).toBe(true);
    expect(second.providerRequestId).toBe(first.providerRequestId);
    expect(second.payload).toBe(first.payload);
  });

  it('replays with the same provider request and one logical outbox identity', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000002',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: 'content',
      originalCategory: 'preference',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn(async (input) => ({
      record: { ...input, status: 'pending', attemptCount: 0 },
      inserted: saveOutbox.mock.calls.length === 0,
    }));
    const notifier = new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
    );

    await notifier.execute({ run: succeededRun(), task: task() as never });
    await notifier.execute({ run: succeededRun(), task: task() as never });

    expect(saveOutbox).toHaveBeenCalledTimes(2);
    const first = saveOutbox.mock.calls[0]![0];
    const second = saveOutbox.mock.calls[1]![0];
    expect(second).toMatchObject({
      connectionKey: first.connectionKey,
      bindingId: first.bindingId,
      targetId: first.targetId,
      deliveryKind: first.deliveryKind,
      aggregateId: first.aggregateId,
      aggregateVersion: first.aggregateVersion,
      payload: first.payload,
      providerRequestId: first.providerRequestId,
    });
    expect(first.providerRequestId.length).toBeLessThanOrEqual(50);
  });

  it.each([
    ['failed run', { status: 'failed' }, task()],
    [
      'non-Lark task',
      { status: 'succeeded' },
      task({ ingress: 'api', originRef: null }),
    ],
    ['no session', { status: 'succeeded' }, task({ sessionId: null })],
  ])('does not publish for %s', async (_label, run, sourceTask) => {
    const saveOutbox = vi.fn();
    const memory = {
      listPendingProposalsBySourceRunForOwner: vi.fn(async () => []),
    };
    await new PublishMemoryReviewSurface(
      memory,
      { findBindingBySessionId: vi.fn() },
      { saveOutbox },
    ).execute({ run: run as never, task: sourceTask as never });
    expect(
      memory.listPendingProposalsBySourceRunForOwner,
    ).not.toHaveBeenCalled();
    expect(saveOutbox).not.toHaveBeenCalled();
  });

  it.each([
    ['no pending proposal', []],
    [
      'no binding',
      [
        createMemoryProposal({
          id: 'proposal-3',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'owner',
          originalContent: 'content',
          originalCategory: 'preference',
          sourceRunId: 'run-1',
          proposerSnapshot: {
            principalType: 'service_account',
            principalId: 'owner',
            policySnapshotVersion: 'policy',
          },
        }),
      ],
    ],
  ])('does not publish when there is %s', async (_label, proposals) => {
    const saveOutbox = vi.fn();
    await new PublishMemoryReviewSurface(
      { listPendingProposalsBySourceRunForOwner: vi.fn(async () => proposals) },
      { findBindingBySessionId: vi.fn(async () => null) },
      { saveOutbox },
    ).execute({ run: succeededRun(), task: task() as never });
    expect(saveOutbox).not.toHaveBeenCalled();
  });
  it('publishes a long proposal through one Doc and a tokenless Doc-card intent', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000099',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: `${'long proposal\n'.repeat(30)}`,
      originalCategory: 'context',
      sourceTaskId: 'task-1',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn();
    const create = vi.fn().mockResolvedValue({
      token: 'doc-99',
      revision: '3',
      url: 'https://lark.test/docx/doc-99',
    });
    const createSurface = vi.fn().mockResolvedValue(undefined);
    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
      'lark-canary',
      {
        getActiveSurface: vi.fn(async () => null),
        createCardSurfaceAndOutbox: createSurface,
      },
      createMemoryReviewActionTokenDeriver('secret'),
      { create, readDraft: vi.fn() },
      'user',
    ).execute({ run: succeededRun(), task: task() as never });
    expect(create).toHaveBeenCalledTimes(1);
    expect(createSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: expect.objectContaining({
          mode: 'card_with_doc',
          docToken: 'doc-99',
          docRevision: '3',
        }),
      }),
    );
  });

  it('byte-bounds a multibyte Doc excerpt without splitting Unicode', async () => {
    const content = `${'🙂'.repeat(501)}${'a'.repeat(1000)}`;
    const proposal = createMemoryProposal({
      id: '00000000-0000-0000-0000-000000000100',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: content,
      originalCategory: 'context',
      sourceTaskId: 'task-1',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const createSurface = vi.fn().mockResolvedValue(undefined);
    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox: vi.fn() },
      'lark-canary',
      {
        getActiveSurface: vi.fn(async () => null),
        createCardSurfaceAndOutbox: createSurface,
      },
      createMemoryReviewActionTokenDeriver('secret'),
      {
        create: vi.fn().mockResolvedValue({
          token: 'doc-100',
          revision: '1',
          url: 'https://lark.test/docx/doc-100',
        }),
        readDraft: vi.fn(),
      },
      'user',
    ).execute({ run: succeededRun(), task: task() as never });
    const descriptor = JSON.parse(
      createSurface.mock.calls[0]![0].outbox.payload,
    );
    expect(Buffer.byteLength(descriptor.excerpt, 'utf8')).toBeLessThanOrEqual(
      1000,
    );
    expect(descriptor.excerpt).not.toContain('\uFFFD');
    expect(content.startsWith(descriptor.excerpt)).toBe(true);
  });

  it('falls back to one command intent when the Doc provider fails', async () => {
    const proposal = createMemoryProposal({
      id: '00000000-0000-4000-8000-000000000098',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'owner',
      originalContent: `${'long proposal\n'.repeat(30)}`,
      originalCategory: 'context',
      sourceTaskId: 'task-1',
      sourceSessionId: 'session-1',
      sourceRunId: 'run-1',
      proposerSnapshot: {
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
      },
    });
    const saveOutbox = vi.fn();
    await new PublishMemoryReviewSurface(
      {
        listPendingProposalsBySourceRunForOwner: vi.fn(async () => [proposal]),
      },
      { findBindingBySessionId: vi.fn(async () => binding()) },
      { saveOutbox },
      'lark-canary',
      {
        getActiveSurface: vi.fn(async () => null),
        createCardSurfaceAndOutbox: vi.fn(),
      },
      createMemoryReviewActionTokenDeriver('secret'),
      {
        create: vi.fn().mockRejectedValue(new Error('provider')),
        readDraft: vi.fn(),
      },
      'user',
    ).execute({ run: succeededRun(), task: task() as never });
    expect(saveOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryKind: 'memory_review_command' }),
    );
  });
});

function task(
  overrides: {
    readonly ingress?: 'api' | 'lark';
    readonly originRef?: string | null;
    readonly sessionId?: string | null;
  } = {},
) {
  return {
    ...transitionTask(
      createRootTask({
        id: 'task-1',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'owner',
        policySnapshotVersion: 'policy',
        ingress: 'lark',
        originRef: 'binding-1',
        invokableKind: 'agent',
        invokableVersionId: 'version',
        inputSnapshotRef: 'snapshot',
        inputFingerprint: 'fingerprint',
        now: () => new Date('2026-07-24T00:00:00.000Z'),
      }),
      'active',
      () => new Date('2026-07-24T00:00:01.000Z'),
    ),
    sessionId: 'session-1',
    ...overrides,
  };
}

function succeededRun(result?: { readonly text: string }) {
  return {
    id: 'run-1',
    status: 'succeeded',
    ...(result ? { result } : {}),
  } as never;
}

function binding() {
  return {
    id: 'binding-1',
    connectionKey: 'lark-canary',
    chatId: 'chat-1',
    rootMessageId: 'root-1',
    sessionId: 'session-1',
    creatingIngressId: 'ingress-1',
    status: 'active' as const,
    createdAt: '',
    updatedAt: '',
  };
}
