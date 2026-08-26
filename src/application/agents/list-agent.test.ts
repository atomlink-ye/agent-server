import { describe, expect, it } from 'vitest';
import type { AgentRegistry } from '../ports/agent-registry.js';
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
    const registry: Partial<AgentRegistry> = {
      listVersionsForOwner: async (owner, command) => {
        calls.push({ owner, command });
        return page;
      },
    };
    const result = await listAgentVersions(registry as AgentRegistry, context, {
      definitionId: 'definition',
      cursor: 'cursor',
      limit: 2,
    });
    expect(calls[0]).toEqual({
      owner: context,
      command: { definitionId: 'definition', cursor: 'cursor', limit: 2 },
    });
    expect(result).toEqual(page);
  });

  it('rejects invalid bounded limits', async () => {
    let calls = 0;
    const registry: Partial<AgentRegistry> = {
      listVersionsForOwner: async () => {
        calls += 1;
        throw new Error('must not call');
      },
    };
    await expect(
      listAgentVersions(registry as AgentRegistry, context, {
        definitionId: 'd',
        cursor: null,
        limit: 0,
      }),
    ).rejects.toMatchObject({ code: 'invalid_limit' });
    await expect(
      listAgentVersions(registry as AgentRegistry, context, {
        definitionId: 'd',
        cursor: null,
        limit: 101,
      }),
    ).rejects.toMatchObject({ code: 'invalid_limit' });
    expect(calls).toBe(0);
  });

  it('maps a missing tenant-visible definition to not-found', async () => {
    const registry: Partial<AgentRegistry> = {
      listVersionsForOwner: async () => null,
    };
    await expect(
      listAgentVersions(registry as AgentRegistry, context, {
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
