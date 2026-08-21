import { describe, expect, it } from 'vitest';
import type {
  AgentRegistry,
  ManagedAgentDefinitionRead,
} from '../ports/agent-registry.js';
import { listAgentVersions } from './read-agent.js';
import { AgentNotFoundError } from './errors.js';

const context = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account' as const,
  principalId: 'principal',
  policySnapshotVersion: 'p1',
};

describe('ListAgentVersions', () => {
  it('derives tenant command, passes cursor/limit, and preserves repository order', async () => {
    const calls: unknown[] = [];
    const page = {
      items: [version('z', '2026-01-02'), version('a', '2026-01-01')],
      nextCursor: 'next',
    };
    const registry = {
      listVersionsByTenant: async (input: unknown) => {
        calls.push(input);
        return page;
      },
    } as unknown as AgentRegistry &
      Pick<
        ManagedAgentDefinitionRead,
        | 'findManagedDefinitionByTenant'
        | 'findVersionByTenant'
        | 'listVersionsByTenant'
      >;
    const result = await listAgentVersions(registry, context, {
      definitionId: 'definition',
      cursor: 'cursor',
      limit: 2,
    });
    expect(calls[0]).toEqual({
      tenantId: 'tenant',
      command: { definitionId: 'definition', cursor: 'cursor', limit: 2 },
    });
    expect(result).toEqual(page);
  });

  it('rejects invalid bounded limits', async () => {
    let calls = 0;
    const registry = {
      listVersionsByTenant: async () => {
        calls += 1;
        throw new Error('must not call');
      },
    } as unknown as AgentRegistry &
      Pick<
        ManagedAgentDefinitionRead,
        | 'findManagedDefinitionByTenant'
        | 'findVersionByTenant'
        | 'listVersionsByTenant'
      >;
    await expect(
      listAgentVersions(registry, context, {
        definitionId: 'd',
        cursor: null,
        limit: 0,
      }),
    ).rejects.toMatchObject({ code: 'invalid_limit' });
    await expect(
      listAgentVersions(registry, context, {
        definitionId: 'd',
        cursor: null,
        limit: 101,
      }),
    ).rejects.toMatchObject({ code: 'invalid_limit' });
    expect(calls).toBe(0);
  });

  it('maps a missing tenant-visible definition to not-found', async () => {
    const registry = {
      listVersionsByTenant: async () => null,
    } as unknown as AgentRegistry &
      Pick<
        ManagedAgentDefinitionRead,
        | 'findManagedDefinitionByTenant'
        | 'findVersionByTenant'
        | 'listVersionsByTenant'
      >;
    await expect(
      listAgentVersions(registry, context, {
        definitionId: 'missing',
        cursor: null,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});

function version(id: string, createdAt: string) {
  return { id, createdAt } as never;
}
