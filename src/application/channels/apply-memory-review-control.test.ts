import { describe, expect, it, vi } from 'vitest';
import { ApplyMemoryReviewControl } from './apply-memory-review-control.js';
import { SynthesizeMemoryDocument } from './synthesize-memory-document.js';
import { testMemoryReviewCardRenderer } from './memory-review-card-renderer.test-helper.js';

const config = {
  connectionKey: 'lark',
  allowedChatId: 'chat',
  allowedOpenId: 'user',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  serviceAccountId: 'svc',
  policyVersion: 'policy',
  enabled: true,
  appId: 'app',
  appSecret: 'secret',
  botOpenId: 'bot',
  domain: 'lark',
  publishedAgentVersionId: 'agent',
} as const;

const ingress = (action: string, digest = 'a'.repeat(64)) => ({
  id: 'ingress-1',
  kind: 'card_action' as const,
  externalKey: 'event-1',
  externalMessageId: 'card-1',
  connectionKey: 'lark',
  chatId: 'chat',
  externalActorId: 'user',
  action: { action, digest },
  normalizationVersion: 'v1',
  status: 'processing' as const,
  attemptCount: 1,
  leaseOwner: 'worker',
  leaseExpiresAt: new Date(Date.now() + 10_000).toISOString(),
  createdAt: '',
  updatedAt: '',
});

describe('ApplyMemoryReviewControl', () => {
  it('accepts an authorized card action and converges to a ready projection', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
    };
    const surfaces = {
      authorizeCardAction: vi.fn().mockResolvedValue({
        surface: {
          id: 'surface-1',
          version: 1,
          mode: 'card',
          status: 'active_card',
          cardMessageId: 'card-1',
          proposalId: 'proposal-1',
          bindingId: 'binding-1',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'svc',
          creatingIngressId: 'create-1',
          resolvingIngressId: null,
          actionTokenHash: 'hash',
          docToken: null,
          docRevision: null,
          previewContent: null,
          previewSha256: null,
          createdAt: '',
          updatedAt: '',
        },
        proposal: {
          id: 'proposal-1',
          originalCategory: 'preference',
          originalContent: 'Use dark mode',
          status: 'pending',
          tenantId: 'tenant',
          workspaceId: 'workspace',
          principalType: 'service_account',
          principalId: 'svc',
          sourceSessionId: 'session-1',
        },
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    const review = {
      execute: vi.fn().mockResolvedValue({
        proposal: { status: 'accepted' },
        entry: { id: 'entry-1', proposalId: 'proposal-1' },
      }),
    };
    const managedMemory = {
      acceptEntry: vi.fn().mockResolvedValue({
        projectionStatus: 'ready',
        snapshotId: 'snapshot-1',
        contentHash: 'hash',
      }),
    };

    const result = await new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      review as any,
      managedMemory as any,
      config,
      testMemoryReviewCardRenderer,
    ).execute(ingress('accept'));

    expect(result).toEqual({ accepted: true, outcome: 'accepted' });
    expect(review.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept' }),
    );
    expect(managedMemory.acceptEntry).toHaveBeenCalled();
    expect(
      surfaces.resolveSurfaceAndCreateTerminalOutboxes,
    ).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'accepted' }));
  });

  it('routes edit in doc to a safe handoff without touching Docs or resolving', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
      saveOutbox: vi.fn().mockResolvedValue({ inserted: true }),
    };
    const surfaces = {
      authorizeCardAction: vi.fn().mockResolvedValue({
        surface: {
          id: 's',
          version: 1,
          mode: 'card',
          status: 'active_card',
          cardMessageId: 'm',
        },
        proposal: { id: 'p' },
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi.fn(),
    };
    const review = { execute: vi.fn() };
    const result = await new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      review as any,
      {} as any,
      config,
      testMemoryReviewCardRenderer,
    ).execute(ingress('edit_in_doc'));
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        outcome: 'document_handoff_required',
      }),
    );
    expect(review.execute).not.toHaveBeenCalled();
    expect(
      surfaces.resolveSurfaceAndCreateTerminalOutboxes,
    ).not.toHaveBeenCalled();
  });

  it('continues an active-card terminal Accept after canonical commit', async () => {
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
          status: 'accepted',
        },
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    const review = {
      execute: vi.fn().mockResolvedValue({
        proposal: { status: 'accepted' },
        entry: { id: 'entry', proposalId: 'p' },
      }),
    };
    const managed = {
      acceptEntry: vi.fn().mockResolvedValue({
        projectionStatus: 'ready',
        snapshotId: 'snap',
        contentHash: 'hash',
      }),
    };
    const result = await new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      review as any,
      managed as any,
      config,
      testMemoryReviewCardRenderer,
    ).execute(ingress('accept'));
    expect(result).toEqual({ accepted: true, outcome: 'accepted' });
    expect(review.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        controller: { kind: 'channel_ingress', ingressId: 'ingress-1' },
      }),
    );
    expect(
      surfaces.resolveSurfaceAndCreateTerminalOutboxes,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseOwner: 'worker',
        attemptNumber: 1,
        actionDigest: 'a'.repeat(64),
      }),
    );
  });

  it('persists preview and accepts only the persisted preview', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
      saveOutbox: vi.fn().mockResolvedValue(undefined),
    };
    const surface = {
      id: 's',
      version: 1,
      mode: 'card_with_doc',
      status: 'active_card_with_doc',
      cardMessageId: 'card-1',
      bindingId: 'b',
      proposalId: 'p',
      docToken: 'doc-1',
      previewContent: 'persisted',
      previewSha256: 'b'.repeat(64),
    };
    const surfaces = {
      authorizeCardAction: vi.fn().mockResolvedValue({
        surface,
        proposal: {
          id: 'p',
          originalCategory: 'rule',
          originalContent: 'original',
        },
      }),
      savePreview: vi.fn().mockResolvedValue({
        ...surface,
        status: 'processing',
        previewContent: 'from doc',
        previewSha256: 'c'.repeat(64),
      }),
      saveDocument: vi.fn(),
      resolveSurfaceAndCreateTerminalOutboxes: vi
        .fn()
        .mockResolvedValue(undefined),
    };
    const documents = {
      readDraft: vi.fn().mockResolvedValue({
        body: 'from doc',
        revision: '2',
        unresolvedComments: [],
      }),
      create: vi.fn(),
    };
    const synthesize = { execute: vi.fn().mockResolvedValue('from doc') };
    const review = {
      execute: vi.fn().mockResolvedValue({
        proposal: { status: 'accepted' },
        entry: { id: 'entry', proposalId: 'p' },
      }),
    };
    const managed = {
      acceptEntry: vi.fn().mockResolvedValue({ projectionStatus: 'ready' }),
    };
    const preview = await new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      review as any,
      managed as any,
      { ...config, docWebBaseUrl: 'https://lark.test' },
      testMemoryReviewCardRenderer,
      documents as any,
      synthesize as any,
    ).execute(ingress('preview_doc'));
    expect(preview).toEqual({ accepted: true, outcome: 'previewed' });
    expect(review.execute).not.toHaveBeenCalled();
    const accepted = await new ApplyMemoryReviewControl(
      channels as any,
      surfaces as any,
      review as any,
      managed as any,
      config,
      testMemoryReviewCardRenderer,
      documents as any,
    ).execute(ingress('accept_preview'));
    expect(accepted).toEqual({ accepted: true, outcome: 'accepted' });
    expect(review.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'edit_and_accept',
        content: 'persisted',
      }),
    );
    expect(documents.readDraft).not.toHaveBeenCalled();
  });

  it('runs the sequential collaborative Doc acceptance slice without retaining comments', async () => {
    const channels = {
      completeIngress: vi.fn().mockResolvedValue(undefined),
      saveOutbox: vi.fn().mockResolvedValue(undefined),
    };
    const baseSurface = {
      id: 's',
      version: 1,
      mode: 'card',
      status: 'active_card',
      cardMessageId: 'card-1',
      bindingId: 'b',
      proposalId: 'p',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'svc',
      docToken: null,
      docRevision: null,
      previewContent: null,
      previewSha256: null,
    };
    let currentSurface: any = baseSurface;
    const surfaces = {
      authorizeCardAction: vi.fn(async ({ action }: { action: string }) => ({
        surface: currentSurface,
        proposal: {
          id: 'p',
          originalCategory: 'rule',
          originalContent: 'original',
          status: 'pending',
        },
      })),
      saveDocument: vi.fn(async (input: any) => {
        currentSurface = {
          ...currentSurface,
          mode: 'card_with_doc',
          status: 'active_card_with_doc',
          docToken: input.docToken,
          docRevision: input.docRevision,
        };
        return currentSurface;
      }),
      savePreview: vi.fn(async (input: any) => {
        currentSurface = {
          ...currentSurface,
          status: 'processing',
          previewContent: input.content,
          previewSha256: input.sha256,
        };
        return currentSurface;
      }),
      resolveSurfaceAndCreateTerminalOutboxes: vi.fn(),
    };
    const docs = {
      create: vi.fn().mockResolvedValue({
        token: 'doc-1',
        revision: '1',
        url: 'https://lark.test/docx/doc-1',
      }),
      readDraft: vi.fn().mockResolvedValue({
        body: 'MARKER_A',
        revision: '2',
        unresolvedComments: [
          {
            id: 'comment-1',
            text: 'Apply this change',
            replies: ['Confirmed'],
          },
        ],
      }),
    };
    const runtimeExecute = vi.fn().mockResolvedValue({
      provider: 'fake',
      model: 'fake',
      text: 'MARKER_A',
      usage: { inputTokens: 1, outputTokens: 1, totalCostUsd: 0 },
    });
    const synthesize = new SynthesizeMemoryDocument({
      execute: runtimeExecute,
    });
    const review = {
      execute: vi.fn().mockResolvedValue({
        proposal: { status: 'accepted' },
        entry: { id: 'entry-1', proposalId: 'p', content: 'MARKER_A' },
      }),
    };
    const managed = {
      acceptEntry: vi.fn().mockResolvedValue({
        projectionStatus: 'ready',
        snapshotId: 'snapshot-1',
        contentHash: 'hash-a',
      }),
    };
    const control = () =>
      new ApplyMemoryReviewControl(
        channels as any,
        surfaces as any,
        review as any,
        managed as any,
        { ...config, docWebBaseUrl: 'https://lark.test' },
        testMemoryReviewCardRenderer,
        docs as any,
        synthesize,
      );
    await control().execute(ingress('edit_in_doc'));
    expect(currentSurface).toMatchObject({
      mode: 'card_with_doc',
      status: 'active_card_with_doc',
    });
    const noPreview = await control().execute(ingress('accept_preview'));
    expect(noPreview).toMatchObject({
      accepted: false,
      reason: 'no_persisted_preview',
    });
    currentSurface = {
      ...currentSurface,
      status: 'active_card_with_doc',
      previewContent: null,
      previewSha256: null,
    };
    const preview = await control().execute(ingress('preview_doc'));
    expect(preview).toEqual({ accepted: true, outcome: 'previewed' });
    expect(currentSurface.previewContent).toBe('MARKER_A');
    expect(
      JSON.stringify(channels.saveOutbox.mock.calls.at(-1)?.[0]),
    ).not.toContain('Apply this change');
    await control().execute(ingress('preview_doc'));
    expect(runtimeExecute).toHaveBeenCalledTimes(1);
    currentSurface = { ...currentSurface, status: 'processing' };
    const accepted = await control().execute(ingress('accept_preview'));
    expect(accepted).toEqual({ accepted: true, outcome: 'accepted' });
    expect(review.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'edit_and_accept',
        content: 'MARKER_A',
      }),
    );
    expect(managed.acceptEntry).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'MARKER_A' }),
    );
    expect(
      surfaces.resolveSurfaceAndCreateTerminalOutboxes,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'MARKER_A', outcome: 'accepted' }),
    );
  });
});
