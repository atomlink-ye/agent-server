import { describe, expect, it } from 'vitest';

import { importAgent } from './import-agent.js';
import type { AgentRegistry } from '../ports/agent-registry.js';

describe('ImportAgent', () => {
  it('derives an owner without workspace and normalizes the package name', async () => {
    const calls: unknown[] = [];
    const registry: AgentRegistry = {
      importAgent: async (command: unknown) => {
        calls.push(command);
        return { kind: 'created', definition: {} as any, version: {} as any };
      },
      publishAgentVersion: async () => {
        throw new Error('unused');
      },
      findDefinition: async () => null,
      findVersion: async () => null,
      listVersions: async () => [],
    };

    await importAgent(registry, {
      accessContext: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-a',
        principalType: 'service_account',
        principalId: 'principal-1',
        policySnapshotVersion: 'p1',
      },
      idempotencyKey: 'key-1',
      source: validPackage('  My Agent  '),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      owner: {
        tenantId: 'tenant-1',
        principalType: 'service_account',
        principalId: 'principal-1',
      },
      normalizedName: 'my-agent',
    });
    expect(calls[0]).not.toMatchObject({
      owner: { workspaceId: expect.anything() },
    });
  });
});

function validPackage(name: string): string {
  return `apiVersion: agent-server/v1alpha1
kind: ManagedAgent
metadata:
  name: ${name}
spec:
  description: description
  instructions: instructions
  runtime:
    provider: paseo
    modelPolicyRef: free-only
    mode: isolated
  tools: []
  skills: []
  input:
    schema:
      type: object
      additionalProperties: false
      properties: {}
    prompt: hello
  session:
    invocation: fresh_per_invocation
    followUps: queued
    binding: reusable
  memory:
    policy: workspace_snapshot
    proposalLimit: 1
  permissions:
    network: none
    filesystem: none
  completion:
    type: executable
    command: done
`;
}
