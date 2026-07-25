import { describe, expect, it, vi } from 'vitest';
import { SynthesizeMemoryDocument } from './synthesize-memory-document.js';

describe('SynthesizeMemoryDocument', () => {
  it('calls the runtime once with server-owned instructions and no candidates', async () => {
    const execute = vi.fn().mockResolvedValue({ text: 'Synthesized memory' });
    const result = await new SynthesizeMemoryDocument({ execute }).execute({
      ingressId: 'ingress-1',
      category: 'policy',
      draft: {
        body: 'draft',
        revision: '2',
        unresolvedComments: [
          { id: 'c1', text: 'Use UTC', replies: ['Confirmed'] },
        ],
      },
    });
    expect(result).toBe('Synthesized memory');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'ingress-1',
        memoryCandidates: { maxCandidates: 0, proposalLimit: 0 },
        prompt: expect.stringContaining('category policy'),
      }),
    );
  });

  it.each(['', 'x'.repeat(4097)])(
    'rejects output outside bounds: %s',
    async (text) => {
      await expect(
        new SynthesizeMemoryDocument({
          execute: vi.fn().mockResolvedValue({ text }),
        }).execute({
          ingressId: 'i',
          category: 'policy',
          draft: { body: 'draft', revision: '1', unresolvedComments: [] },
        }),
      ).rejects.toThrow(/synthesized preview/);
    },
  );
});
