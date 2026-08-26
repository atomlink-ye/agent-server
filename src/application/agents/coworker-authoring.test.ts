import { describe, expect, it } from 'vitest';

import { compileCoworkerDraft } from './coworker-authoring.js';
import { parseForImport } from './validate-agent-package.js';

const WORK_TOOLS = [
  'agent-server/product-work-create',
  'agent-server/product-work-run-start',
  'agent-server/list-agent-workflows',
  'agent-server/describe-workflow',
];

describe('compileCoworkerDraft', () => {
  it('turns human profile fields into one canonical valid ManagedAgent package', () => {
    const source = compileCoworkerDraft({
      name: 'Maya',
      role: 'Research Analyst',
      summary: 'Researches competitors and challenges assumptions.',
      instructions: 'Cite evidence and stay concise.',
    });
    const parsed = parseForImport(source);

    expect(parsed.normalizedName).toBe('maya');
    expect(parsed.package.spec.description).toContain('competitors');
    expect(parsed.package.spec.instructions).toContain('Research Analyst');
    expect(parsed.package.spec.instructions).toContain('Cite evidence');
    expect(parsed.package.spec.runtime).toMatchObject({
      provider: 'paseo',
      modelPolicyRef: 'free-only',
      mode: 'isolated',
    });
    expect(parsed.package.spec.tools.map((tool) => tool.ref)).toEqual(
      WORK_TOOLS,
    );
    expect(parsed.package.spec.input.schema).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it('deduplicates advanced tools without removing the Work tools', () => {
    const source = compileCoworkerDraft({
      name: 'Maya',
      role: 'Analyst',
      summary: 'Researches markets.',
      tools: ['agent-server/memory-read', 'agent-server/memory-read'],
    });
    const parsed = parseForImport(source);
    expect(parsed.package.spec.tools.map((tool) => tool.ref)).toEqual([
      ...WORK_TOOLS,
      'agent-server/memory-read',
    ]);
  });
});
