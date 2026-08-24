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

function make() {
  const review = {
    execute: vi.fn().mockResolvedValue({ entry: { id: 'entry' } }),
  };
  const managedMemory = {
    acceptEntry: vi.fn().mockResolvedValue({ projectionStatus: 'ready' }),
  };
  return {
    service: new AcceptMemoryFromBoundDocument(review, managedMemory),
    review,
    managedMemory,
  };
}

describe('AcceptMemoryFromBoundDocument', () => {
  it('replays accepted content without binding or runtime continuation', async () => {
    const x = make();
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
  });
});
