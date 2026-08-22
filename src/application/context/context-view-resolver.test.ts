import { describe, expect, it } from 'vitest';

import { ContextViewResolver } from './context-view-resolver.js';
import { AgentHomeContextAdapter } from './agent-home-context-adapter.js';
import type {
  LogicalFileEntry,
  LogicalFileStore,
} from '../ports/logical-file-store.js';
import {
  contextScopeKind,
  contextScopeStorageKey,
  contextScopeTenantId,
  type ContextScope,
} from '../../domain/context/context-fs.js';
import {
  principalRef,
  productScope,
} from '../../domain/tenancy/product-context.js';

class MemoryLogicalFileStore implements LogicalFileStore {
  private readonly entries = new Map<string, LogicalFileEntry>();

  async list(scope: ContextScope): Promise<readonly LogicalFileEntry[]> {
    const prefix = `${scopeKey(scope)}\0`;
    return [...this.entries.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(
    scope: ContextScope,
    path: string,
  ): Promise<LogicalFileEntry | null> {
    return this.entries.get(`${scopeKey(scope)}\0${path}`) ?? null;
  }

  async write(input: {
    readonly scope: ContextScope;
    readonly path: string;
    readonly content: string;
  }): Promise<LogicalFileEntry> {
    const key = `${scopeKey(input.scope)}\0${input.path}`;
    const existing = this.entries.get(key);
    const entry: LogicalFileEntry = {
      id: existing?.id ?? `entry-${this.entries.size + 1}`,
      scope: input.scope,
      path: input.path,
      currentVersion: (existing?.currentVersion ?? 0) + 1,
      content: input.content,
      contentSha256: `hash:${input.content}`,
      contentSizeBytes: Buffer.byteLength(input.content),
      createdAt: existing?.createdAt ?? '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    };
    this.entries.set(key, entry);
    return entry;
  }
}

function scopeKey(scope: ContextScope): string {
  return [
    contextScopeTenantId(scope),
    contextScopeKind(scope),
    contextScopeStorageKey(scope),
  ].join('|');
}

function homeScope(input: {
  namespace: 'work' | 'user';
  agentDefinitionId: string;
  scopeKey: string;
  principalType?: string;
}) {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agentDefinitionId: input.agentDefinitionId,
    namespace: input.namespace,
    scopeKey: input.scopeKey,
    principalType: input.principalType ?? 'user',
  } as const;
}

describe('ContextFS shared world', () => {
  it('gives different Agents the same canonical Work files', async () => {
    const adapter = new AgentHomeContextAdapter(new MemoryLogicalFileStore());
    await adapter.write({
      scope: homeScope({
        namespace: 'work',
        agentDefinitionId: 'agent-a',
        scopeKey: 'work-17',
      }),
      path: 'report.md',
      content: 'shared report',
      contentSha256: 'ignored',
      contentSizeBytes: 1,
    });

    await expect(
      adapter.read({
        scope: homeScope({
          namespace: 'work',
          agentDefinitionId: 'agent-b',
          scopeKey: 'work-17',
        }),
        path: 'report.md',
      }),
    ).resolves.toMatchObject({ content: 'shared report' });
  });

  it('keeps actor-private user context isolated for one shared Agent', async () => {
    const adapter = new AgentHomeContextAdapter(new MemoryLogicalFileStore());
    await adapter.write({
      scope: homeScope({
        namespace: 'user',
        agentDefinitionId: 'shared-agent',
        scopeKey: 'alice',
      }),
      path: 'preference.md',
      content: 'Alice private',
      contentSha256: 'ignored',
      contentSizeBytes: 1,
    });
    await adapter.write({
      scope: homeScope({
        namespace: 'user',
        agentDefinitionId: 'shared-agent',
        scopeKey: 'bob',
      }),
      path: 'preference.md',
      content: 'Bob private',
      contentSha256: 'ignored',
      contentSizeBytes: 1,
    });

    await expect(
      adapter.read({
        scope: homeScope({
          namespace: 'user',
          agentDefinitionId: 'shared-agent',
          scopeKey: 'alice',
        }),
        path: 'preference.md',
      }),
    ).resolves.toMatchObject({ content: 'Alice private' });
    await expect(
      adapter.read({
        scope: homeScope({
          namespace: 'user',
          agentDefinitionId: 'shared-agent',
          scopeKey: 'bob',
        }),
        path: 'preference.md',
      }),
    ).resolves.toMatchObject({ content: 'Bob private' });
  });

  it('projects different Chat and Worker views over the same canonical store', () => {
    const resolver = new ContextViewResolver();
    const scope = productScope({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
    });
    const chat = resolver.forChat({
      productScope: scope,
      actor: principalRef({ principalType: 'user', principalId: 'alice' }),
      agentDefinitionId: 'agent-a',
      conversationId: 'conversation-1',
      runtimeSessionId: 'chat-runtime-1',
    });
    const worker = resolver.forWorker({
      productScope: scope,
      agentDefinitionId: 'agent-b',
      workId: 'work-17',
      runtimeSessionId: 'worker-runtime-1',
    });

    expect(chat.mounts.map((mount) => mount.mountPath)).toEqual([
      '/agent',
      '/organization',
      '/workspace',
      '/user',
      '/conversation',
      '/scratch',
    ]);
    expect(worker.mounts.map((mount) => mount.mountPath)).toEqual([
      '/agent',
      '/organization',
      '/workspace',
      '/input',
      '/work',
      '/scratch',
    ]);
    expect(
      worker.mounts.some((mount) => mount.mountPath === '/conversation'),
    ).toBe(false);
    const input = worker.mounts.find((mount) => mount.mountPath === '/input');
    const work = worker.mounts.find((mount) => mount.mountPath === '/work');
    expect(input?.scope).toEqual(work?.scope);
    expect(input?.access).toBe('read_only');
    expect(work?.access).toBe('read_write');
  });
});
