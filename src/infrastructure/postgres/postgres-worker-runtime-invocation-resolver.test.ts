import { describe, expect, it, vi } from 'vitest';

import { PostgresWorkerRuntimeInvocationResolver } from './postgres-worker-runtime-invocation-resolver.js';

describe('PostgresWorkerRuntimeInvocationResolver', () => {
  it('projects durable Work/Agent/runtime facts into a Worker ContextFS invocation', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          scope_kind: 'task',
          scope_id: 'task-1',
          task_id: 'task-1',
          tenant_id: 'tenant-1',
          principal_type: 'user',
          principal_id: 'alice',
          workspace_id: 'workspace-1',
          agent_version_id: 'agent-version-1',
          definition_id: 'agent-1',
          agent_tenant_id: 'tenant-1',
          agent_workspace_id: 'workspace-agent-owner',
          agent_principal_type: 'service_account',
          agent_principal_id: 'agent-owner',
          root_task_id: 'root-task-1',
          work_id: 'work-1',
          work_run_id: 'work-run-1',
        },
      ],
    }));
    const resolver = new PostgresWorkerRuntimeInvocationResolver({
      query,
    } as any);

    const resolved = await resolver.resolve('runtime-session-1');

    expect(resolved).toMatchObject({
      scope: { kind: 'task', taskId: 'task-1' },
      productScope: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
      actor: { type: 'user', id: 'alice' },
      agentOwner: {
        scope: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-agent-owner',
        },
        principal: { type: 'service_account', id: 'agent-owner' },
      },
      agentDefinitionId: 'agent-1',
      agentVersionId: 'agent-version-1',
      workId: 'work-1',
      workRunId: 'work-run-1',
    });
    expect(resolved?.contextView?.kind).toBe('worker');
    expect(
      resolved?.contextView?.mounts.map((mount) => mount.mountPath),
    ).toEqual([
      '/agent',
      '/organization',
      '/workspace',
      '/input',
      '/work',
      '/scratch',
    ]);
    expect(
      resolved?.contextView?.mounts.some(
        (mount) => mount.mountPath === '/conversation',
      ),
    ).toBe(false);
  });

  it('does not manufacture a Work view for non-formal runtime scopes', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          scope_kind: 'agent_chat',
          scope_id: 'chat-runtime-1',
          task_id: null,
          tenant_id: 'tenant-1',
          principal_type: 'user',
          principal_id: 'alice',
          workspace_id: 'workspace-1',
          agent_version_id: 'agent-version-1',
          definition_id: 'agent-1',
          agent_tenant_id: 'tenant-1',
          agent_workspace_id: 'workspace-1',
          agent_principal_type: 'service_account',
          agent_principal_id: 'agent-owner',
          root_task_id: null,
          work_id: null,
          work_run_id: null,
        },
      ],
    }));
    const resolver = new PostgresWorkerRuntimeInvocationResolver({
      query,
    } as any);

    await expect(resolver.resolve('chat-session-1')).resolves.toBeNull();
  });
});
