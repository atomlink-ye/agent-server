import { describe, expect, it, vi } from 'vitest';
import { AcceptMemoryFromBoundDocument } from './accept-memory-from-bound-document.js';

const proposal = {
  id: 'p',
  originalCategory: 'terminology',
  sourceSessionId: 's',
  sourceRunId: 'r',
  status: 'pending',
} as const;
const surface = { mode: 'card_with_doc' as const, docToken: 'doc-1' };
const owner = {
  tenantId: 't',
  workspaceId: 'w',
  principalType: 'service_account' as const,
  principalId: 'p',
  serviceAccountId: 'sa',
  policySnapshotVersion: 'policy',
};

function make(
  candidate: any,
  binding: any = { runId: 'r', sessionId: 's', providerAgentId: 'agent' },
) {
  const runtime = {
    executeTurn: vi.fn().mockResolvedValue({
      provider: 'p',
      model: 'm',
      text: 'ignored',
      workspaceBinding: {
        plane: 'paseo',
        externalWorkspaceId: 'workspace',
      },
      sessionBinding: { plane: 'paseo', externalSessionId: 'agent' },
      memoryCandidates: candidate,
    }),
  };
  const events = {
    getProviderBindingForRunInSession: vi.fn().mockResolvedValue(binding),
  };
  const review = {
    execute: vi.fn().mockResolvedValue({ entry: { id: 'entry' } }),
  };
  const managedMemory = {
    acceptEntry: vi.fn().mockResolvedValue({ projectionStatus: 'ready' }),
  };
  return {
    service: new AcceptMemoryFromBoundDocument(
      runtime,
      events,
      review,
      managedMemory,
    ),
    runtime,
    events,
    review,
    managedMemory,
  };
}

describe('AcceptMemoryFromBoundDocument', () => {
  it('uses the exact Agent and Bot-owned CLI fetch, then reviews and projects once', async () => {
    const x = make([{ category: 'terminology', content: 'changed marker' }]);
    await expect(
      x.service.execute({ ingressId: 'i', proposal, surface, owner }),
    ).resolves.toMatchObject({ content: 'changed marker' });
    expect(x.runtime.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        compatibilitySessionBinding: {
          plane: 'paseo',
          externalSessionId: 'agent',
        },
        proposalLimit: 1,
        prompt: expect.stringContaining(
          'lark-cli docs +fetch --profile agent-test --as bot --doc doc-1',
        ),
      }),
    );
    expect(x.review.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'edit_and_accept',
        accessContext: owner,
      }),
    );
    expect(x.managedMemory.acceptEntry).toHaveBeenCalledTimes(1);
  });

  it('replays accepted content without binding or runtime continuation', async () => {
    const x = make([{ category: 'terminology', content: 'new' }], null);
    await expect(
      x.service.execute({
        ingressId: 'i',
        proposal: {
          ...proposal,
          status: 'accepted',
          reviewedContent: 'old',
          reviewControllerIngressId: 'i',
        },
        surface,
        owner,
      }),
    ).resolves.toMatchObject({ content: 'old' });
    expect(x.runtime.executeTurn).not.toHaveBeenCalled();
    expect(x.events.getProviderBindingForRunInSession).not.toHaveBeenCalled();
  });
});
