import { describe, expect, it } from 'vitest';

import { validateProductWorkDefinition } from './validate-product-work-definition.js';

const INLINE = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: one-file-research
spec:
  kind: single_agent
  agent:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedAgent
      metadata:
        name: inline-researcher
      spec:
        description: Inline Agent
        instructions: "Answer the Product input."
        runtime:
          provider: paseo
          modelPolicyRef: free-only
          mode: isolated
        tools: []
        skills: []
        input:
          schema:
            type: object
            properties: {}
            additionalProperties: false
          prompt: "Use the Product input."
        session:
          invocation: fresh_per_invocation
          followUps: queued
          binding: reusable
        memory:
          policy: workspace_snapshot
          proposalLimit: 0
        permissions:
          network: none
          filesystem: none
        completion:
          type: executable
          command: done
  environment:
    source: |
      apiVersion: agent-server/v1alpha1
      kind: ManagedEnvironment
      metadata:
        name: inline-paseo
      spec:
        adapter: paseo
        provider: opencode
        modelPolicyRef: free-only
        runtimeCellPolicy: per_runtime_session
  input_schema:
    type: object
    properties:
      question:
        type: string
    required: [question]
    additional_properties: false
`;

describe('Product Work Definition inline authoring contract', () => {
  it('accepts one file containing Agent and Environment authoring sources', () => {
    const result = validateProductWorkDefinition(INLINE);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid inline Definition');
    expect(result.document.spec.kind).toBe('single_agent');
    if (result.document.spec.kind !== 'single_agent') return;
    expect(result.document.spec.agent?.source).toContain('kind: ManagedAgent');
    expect(result.document.spec.environment?.source).toContain(
      'kind: ManagedEnvironment',
    );
    expect(result.document.spec.agent_version_id).toBeUndefined();
    expect(result.document.spec.environment_version_id).toBeUndefined();
  });

  it('requires exactly one inline source or immutable version ref per resource', () => {
    const invalid = validateProductWorkDefinition(
      INLINE.replace(
        '  agent:\n',
        '  agent_version_id: 11111111-1111-4111-8111-111111111111\n  agent:\n',
      ),
    );
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error('expected invalid mixed binding');
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.spec.agent_version_id',
          severity: 'error',
        }),
      ]),
    );
  });
});
