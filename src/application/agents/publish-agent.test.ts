import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  AgentRegistry,
  PublishAgentAtomicCommand,
} from '../ports/agent-registry.js';
import { publishAgentVersion } from './publish-agent-version.js';
import { AgentNotFoundError, IdempotencyConflictError } from './errors.js';

const context = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account' as const,
  principalId: 'principal',
  policySnapshotVersion: 'policy-1',
};

describe('PublishAgentVersion application boundary', () => {
  it('forwards the derived owner, version, key, and request fingerprint once', async () => {
    const calls: PublishAgentAtomicCommand[] = [];
    const result = { id: 'published', status: 'published' } as any;
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return result;
    });

    const returned = await publishAgentVersion(registry, {
      accessContext: context,
      idempotencyKey: 'publish-1',
      versionId: 'version-1',
    });

    expect(returned).toBe(result);
    expect(calls).toEqual([
      {
        owner: {
          tenantId: 'tenant',
          principalType: 'service_account',
          principalId: 'principal',
        },
        idempotencyKey: 'publish-1',
        versionId: 'version-1',
        requestFingerprint: hash('version-1'),
      },
    ]);
  });

  it('makes one atomic call per invocation and returns each stubbed result', async () => {
    const calls: PublishAgentAtomicCommand[] = [];
    const results = [{ id: 'one' }, { id: 'two' }];
    const registry = stubRegistry(async (command) => {
      calls.push(command);
      return results[calls.length - 1] as any;
    });

    expect(
      await publishAgentVersion(registry, {
        accessContext: context,
        idempotencyKey: 'one',
        versionId: 'one',
      }),
    ).toBe(results[0]);
    expect(
      await publishAgentVersion(registry, {
        accessContext: context,
        idempotencyKey: 'two',
        versionId: 'two',
      }),
    ).toBe(results[1]);
    expect(calls).toHaveLength(2);
  });

  it('propagates typed conflict and hidden not-found errors', async () => {
    const conflict = new IdempotencyConflictError();
    await expect(
      publishAgentVersion(
        stubRegistry(async () => {
          throw conflict;
        }),
        { accessContext: context, idempotencyKey: 'key', versionId: 'version' },
      ),
    ).rejects.toBe(conflict);
    const missing = new AgentNotFoundError();
    await expect(
      publishAgentVersion(
        stubRegistry(async () => {
          throw missing;
        }),
        { accessContext: context, idempotencyKey: 'key', versionId: 'version' },
      ),
    ).rejects.toBe(missing);
  });
});

function stubRegistry(
  publish: AgentRegistry['publishAgentVersion'],
): AgentRegistry {
  return {
    importAgent: async () => {
      throw new Error('unused');
    },
    publishAgentVersion: publish,
    findDefinition: async () => null,
    findVersion: async () => null,
    listVersionsForOwner: async () => null,
  };
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
