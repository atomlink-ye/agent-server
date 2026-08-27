import { describe, expect, it } from 'vitest';

import {
  compileCapabilityDraft,
  type CapabilityDraft,
  type SkillCatalogEntry,
} from './authoring';

const baseDraft: CapabilityDraft = {
  name: 'Competitor Research',
  description: 'Research a company’s major competitors.',
  mode: 'single',
  participants: [
    {
      name: 'specialist',
      role: 'Research Analyst',
      instructions: 'Research thoroughly and cite evidence.',
      skills: [],
    },
  ],
  inputs: [],
};

const catalog: readonly SkillCatalogEntry[] = [
  {
    ref: 'agent-server/memory-api',
    requiredToolRefs: ['agent-server/memory-read', 'agent-server/memory-write'],
  },
  {
    ref: 'agent-server/web-search',
    requiredToolRefs: ['agent-server/memory-read'],
  },
];

describe('compileCapabilityDraft skill/tool emission', () => {
  it('emits empty tools and skills when no skill is selected', () => {
    const source = compileCapabilityDraft(baseDraft, catalog).source;
    expect(source).toMatch(/tools:\s*\n\s*\[\]/);
    expect(source).toMatch(/skills:\s*\n\s*\[\]/);
  });

  it('emits the selected skill and the union of its required tool refs', () => {
    const draft: CapabilityDraft = {
      ...baseDraft,
      participants: [
        {
          ...baseDraft.participants[0]!,
          skills: ['agent-server/memory-api'],
        },
      ],
    };
    const source = compileCapabilityDraft(draft, catalog).source;
    expect(source).toContain('"agent-server/memory-read"');
    expect(source).toContain('"agent-server/memory-write"');
    expect(source).toContain('"agent-server/memory-api"');
    // Worker packages state tools and skills as reference OBJECTS. A bare
    // scalar still parses as YAML but is rejected downstream with
    // `invalid_reference`, so assert the `- ref:` shape rather than merely
    // that the string appears somewhere.
    expect(source).toMatch(/skills:\s*\n\s*- ref: "agent-server\/memory-api"/);
    expect(source).toMatch(/tools:\s*\n\s*- ref: "agent-server\/memory-read"/);
  });

  it('unions required tool refs across every skill selected for a participant', () => {
    const draft: CapabilityDraft = {
      ...baseDraft,
      participants: [
        {
          ...baseDraft.participants[0]!,
          skills: ['agent-server/memory-api', 'agent-server/web-search'],
        },
      ],
    };
    const source = compileCapabilityDraft(draft, catalog).source;
    const toolsBlock = source.slice(
      source.indexOf('  tools:'),
      source.indexOf('  skills:'),
    );
    expect(toolsBlock).toContain('- ref: "agent-server/memory-read"');
    expect(toolsBlock).toContain('- ref: "agent-server/memory-write"');
    expect(toolsBlock.match(/agent-server\/memory-read/g)).toHaveLength(1);
  });

  it('leaves the permissions block untouched by skill selection', () => {
    const draft: CapabilityDraft = {
      ...baseDraft,
      participants: [
        {
          ...baseDraft.participants[0]!,
          skills: ['agent-server/memory-api'],
        },
      ],
    };
    const source = compileCapabilityDraft(draft, catalog).source;
    expect(source).toContain('network: read_only');
    expect(source).toContain('filesystem: workspace_read');
  });
});
