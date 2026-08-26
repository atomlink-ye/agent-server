import { describe, expect, it } from 'vitest';

import { compileCapabilityDraft } from '../../../apps/web/src/features/agents/authoring.js';
import { parseWorkerForImport } from '../workers/validate-worker-package.js';
import { validateEnvironmentPackage } from '../environments/environment-use-cases.js';
import {
  validateProductWorkDefinition,
  validateProductWorkRunInput,
} from './validate-product-work-definition.js';

const specialist = {
  name: 'researcher',
  role: 'Research Analyst',
  instructions:
    'Research the request, cite evidence, and return a concise comparison.',
} as const;

function parse(source: string) {
  const result = validateProductWorkDefinition(source);
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('CapabilityDraft canonical compilation', () => {
  it('round-trips a single specialist and every supported input shape', () => {
    const compiled = compileCapabilityDraft({
      name: 'Competitor Research',
      description: 'Compare one company with its market competitors.',
      mode: 'single',
      participants: [specialist],
      inputs: [
        {
          label: 'Company',
          key: 'company',
          type: 'text',
          required: true,
          minLength: 1,
          maxLength: 80,
        },
        {
          label: 'Depth',
          key: 'depth',
          type: 'integer',
          required: false,
          minimum: 1,
          maximum: 5,
        },
        {
          label: 'Confidence',
          key: 'confidence',
          type: 'number',
          required: false,
          minimum: 0,
          maximum: 1,
        },
        {
          label: 'Region',
          key: 'region',
          type: 'select',
          required: false,
          choices: ['Global', 'APAC'],
        },
        {
          label: 'Include private companies',
          key: 'include_private',
          type: 'boolean',
          required: true,
        },
      ],
    });

    expect(compiled.source).toContain('kind: single_worker');
    expect(compiled.source).not.toContain('single_agent');
    const document = parse(compiled.source);
    expect(document.spec.kind).toBe('single_worker');
    if (document.spec.kind !== 'single_worker') return;
    expect(document.spec.worker_version_id).toBeUndefined();
    expect(document.spec.worker?.source).toContain('kind: Worker');
    expect(document.spec.environment?.source).toContain(
      'kind: ManagedEnvironment',
    );
    parseWorkerForImport(document.spec.worker!.source);
    validateEnvironmentPackage(document.spec.environment!.source);

    const input = validateProductWorkRunInput(document.spec.input_schema, {
      company: 'OpenAI',
      depth: 3,
      confidence: 0.8,
      region: 'Global',
      include_private: false,
    });
    expect(input.valid).toBe(true);
    const rejected = validateProductWorkRunInput(document.spec.input_schema, {
      depth: 7,
      include_private: true,
    });
    expect(rejected.valid).toBe(false);
    if (rejected.valid) throw new Error('expected invalid typed Work input');
    expect(rejected.diagnostics.map((item) => item.path)).toContain(
      '$.input.company',
    );
  });

  it('round-trips bounded collaboration entirely through Worker vocabulary', () => {
    const compiled = compileCapabilityDraft({
      name: 'Investment Review',
      description:
        'Research an investment thesis and independently review its risks.',
      mode: 'collaboration',
      participants: [
        specialist,
        {
          name: 'reviewer',
          role: 'Risk Reviewer',
          instructions:
            'Review independently and request corrections for material gaps.',
        },
      ],
      inputs: [],
    });

    const document = parse(compiled.source);
    expect(document.spec.kind).toBe('collaboration');
    if (document.spec.kind !== 'collaboration') return;
    expect(document.spec.lead.worker?.source).toContain('kind: Worker');
    expect(document.spec.members).toHaveLength(1);
    expect(document.spec.members[0]?.worker?.source).toContain('kind: Worker');
    parseWorkerForImport(document.spec.lead.worker!.source);
    parseWorkerForImport(document.spec.members[0]!.worker!.source);
    validateEnvironmentPackage(document.spec.environment!.source);
    expect(compiled.source).not.toContain('agent_version_id');
    expect(compiled.source).not.toContain('single_agent');
  });

  it('is deterministic for the same structured draft', () => {
    const draft = {
      name: 'Market Brief',
      description: 'Summarize the market.',
      mode: 'single' as const,
      participants: [specialist],
      inputs: [],
    };
    expect(compileCapabilityDraft(draft).source).toBe(
      compileCapabilityDraft(draft).source,
    );
  });
});
