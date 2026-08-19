import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AgentRegistry,
  ImportAgentAtomicCommand,
} from '../ports/agent-registry.js';
import { importAgent } from './import-agent.js';
import { IdempotencyConflictError, AgentNotFoundError } from './errors.js';

const context = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account' as const,
  principalId: 'principal',
  policySnapshotVersion: 'policy-1',
};

describe('ImportAgent application boundary', () => {
  it('forwards the exact derived command through one atomic port call', async () => {
    const calls: ImportAgentAtomicCommand[] = [];
    const result = {
      kind: 'created',
      definition: { id: 'definition' },
      version: { id: 'version' },
    } as any;
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return result;
    });
    const source = validPackage('  My Agent  ');

    const returned = await importAgent(registry, {
      accessContext: context,
      idempotencyKey: 'request-1',
      source,
    });

    expect(returned).toBe(result);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      owner: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        principalType: 'service_account',
        principalId: 'principal',
      },
      compatibilityWorkspaceId: 'workspace',
      normalizedName: 'my-agent',
      idempotencyKey: 'request-1',
      requestFingerprint: hash(source),
      version: { package: { metadata: { name: 'My Agent' } }, status: 'draft' },
    });
  });

  it('keeps workspace out of managed owner identity but carries its compatibility snapshot', async () => {
    const calls: ImportAgentAtomicCommand[] = [];
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return {} as any;
    });
    await importAgent(registry, {
      accessContext: context,
      idempotencyKey: 'one',
      source: validPackage('Agent'),
    });
    await importAgent(registry, {
      accessContext: { ...context, workspaceId: 'workspace-2' },
      idempotencyKey: 'two',
      source: validPackage('Agent'),
    });
    // Workspace is part of the owner identity, so they should differ
    expect(calls[0]!.owner).toEqual({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      principalType: 'service_account',
      principalId: 'principal',
    });
    expect(calls[1]!.owner).toEqual({
      tenantId: 'tenant',
      workspaceId: 'workspace-2',
      principalType: 'service_account',
      principalId: 'principal',
    });
    expect(calls.map((call) => call.compatibilityWorkspaceId)).toEqual([
      'workspace',
      'workspace-2',
    ]);
  });

  it('rejects an overlong normalized name before calling the registry', async () => {
    const calls: ImportAgentAtomicCommand[] = [];
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return {} as any;
    });
    await expect(
      importAgent(registry, {
        accessContext: context,
        idempotencyKey: 'long-name',
        source: validPackage('a'.repeat(256)),
      }),
    ).rejects.toMatchObject({ code: 'invalid_agent_package' });
    expect(calls).toHaveLength(0);
  });

  it('makes exactly one atomic call per service invocation', async () => {
    const calls: ImportAgentAtomicCommand[] = [];
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return { kind: 'created' } as any;
    });
    const input = {
      accessContext: context,
      idempotencyKey: 'request',
      source: validPackage('Agent'),
    };

    await importAgent(registry, input);
    await importAgent(registry, { ...input, idempotencyKey: 'request-2' });

    expect(calls).toHaveLength(2);
  });

  it('propagates typed atomic conflict and hidden not-found errors unchanged', async () => {
    const conflict = new IdempotencyConflictError();
    const conflictRegistry = stubRegistry(async () => {
      throw conflict;
    });
    await expect(
      importAgent(conflictRegistry, {
        accessContext: context,
        idempotencyKey: 'key',
        source: validPackage('Agent'),
      }),
    ).rejects.toBe(conflict);

    const missing = new AgentNotFoundError();
    const missingRegistry = stubRegistry(async () => {
      throw missing;
    });
    await expect(
      importAgent(missingRegistry, {
        accessContext: context,
        idempotencyKey: 'key',
        source: validPackage('Agent'),
      }),
    ).rejects.toBe(missing);
  });
});

function stubRegistry(
  importPackageAtomically: AgentRegistry['importAgent'],
): AgentRegistry {
  return {
    importAgent: importPackageAtomically,
    publishAgentVersion: async () => {
      throw new Error('unused');
    },
    findDefinition: async () => null,
    findVersion: async () => null,
    listVersionsForOwner: async () => null,
  };
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

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
