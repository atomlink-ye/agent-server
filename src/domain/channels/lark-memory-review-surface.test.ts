import { describe, expect, it } from 'vitest';

import {
  assertPreviewContent,
  transitionReviewSurface,
  type LarkMemoryReviewSurface,
  sha256Preview,
} from './lark-memory-review-surface.js';

const baseSurface: LarkMemoryReviewSurface = {
  id: 'surface',
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account',
  principalId: 'principal',
  proposalId: 'proposal',
  bindingId: 'binding',
  version: 1,
  mode: 'card_with_doc',
  status: 'processing',
  cardMessageId: 'card',
  docToken: 'doc',
  docRevision: 'revision',
  previewContent: null,
  previewSha256: null,
  actionTokenHash: null,
  creatingIngressId: 'ingress',
  resolvingIngressId: null,
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};

describe('Lark memory review surface preview bounds', () => {
  it('accepts exactly 4096 UTF-8 bytes and rejects 4097', () => {
    const accepted = '✓'.repeat(1365) + 'a';
    expect(Buffer.byteLength(accepted, 'utf8')).toBe(4096);
    expect(() => assertPreviewContent(accepted)).not.toThrow();
    expect(() => assertPreviewContent(`${accepted}b`)).toThrow(/4096/);
  });

  it('measures multibyte content by UTF-8 bytes', () => {
    const content = '😀'.repeat(1024);
    expect(content.length).toBe(2048);
    expect(Buffer.byteLength(content, 'utf8')).toBe(4096);
    expect(() => assertPreviewContent(content)).not.toThrow();
  });

  it('only allows card_with_doc surfaces to preview', () => {
    for (const mode of ['card', 'command_only'] as const) {
      expect(() =>
        transitionReviewSurface(
          { ...baseSurface, mode },
          {
            kind: 'preview',
            content: 'preview',
            sha256: sha256Preview('preview'),
          },
          '2026-07-25T00:01:00.000Z',
        ),
      ).toThrow(/card_with_doc/);
    }
  });
});
