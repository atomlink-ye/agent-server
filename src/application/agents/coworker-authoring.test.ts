import { describe, expect, it } from 'vitest';

import {
  compileCoworkerDefaultCapability,
  compileCoworkerDraft,
} from './coworker-authoring.js';
import { validateProductWorkDefinition } from '../work/validate-product-work-definition.js';
import { parseForImport } from './validate-agent-package.js';

const WORK_TOOLS = [
  'agent-server/product-work-create',
  'agent-server/product-work-run-start',
  'agent-server/list-agent-workflows',
  'agent-server/describe-workflow',
  'agent-server/work-item-claim',
  'agent-server/work-item-comment',
  'agent-server/work-item-status',
  'agent-server/whisper-open',
  'agent-server/whisper-send',
  'agent-server/workspace-list',
  'agent-server/workspace-read',
  'agent-server/workspace-write',
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

describe('compileCoworkerDefaultCapability', () => {
  it('compiles the hire form into one valid Work Definition the Coworker can run', () => {
    const { source, normalizedName } = compileCoworkerDefaultCapability({
      name: 'Iris',
      role: 'Release Analyst',
      summary: 'Tracks release risks and keeps a running log.',
      instructions: 'Always cite the release tag.',
    });
    const parsed = validateProductWorkDefinition(source);

    expect(parsed.valid).toBe(true);
    expect(normalizedName).toBe('iris-assignment');
    // The Coworker's own words reach the Worker that executes the Work, so
    // the Capability is this Coworker's, not a generic placeholder.
    expect(source).toContain('You are Iris, Release Analyst.');
    expect(source).toContain('Always cite the release tag.');
  });

  it('requires no input, because product_work_run_start supplies none', () => {
    const { source } = compileCoworkerDefaultCapability({
      name: 'Iris',
      role: 'Release Analyst',
      summary: 'Tracks release risks.',
    });
    const parsed = validateProductWorkDefinition(source);

    expect(parsed.valid).toBe(true);
    expect(parsed.valid && parsed.document.spec.input_schema?.required).toEqual(
      [],
    );
  });

  it('keeps every derived name legal for a name that is long or unusable', () => {
    for (const name of ['\u2728\u2728\u2728', 'A'.repeat(120)]) {
      const { source, normalizedName } = compileCoworkerDefaultCapability({
        name,
        role: 'Analyst',
        summary: 'Does the work.',
      });
      expect(validateProductWorkDefinition(source).valid).toBe(true);
      expect(normalizedName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(`${normalizedName}-environment`.length).toBeLessThanOrEqual(80);
    }
  });
});
