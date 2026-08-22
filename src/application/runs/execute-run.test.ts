import { describe, expect, it, vi } from 'vitest';

import { createRun, transitionRun, type Run } from '../../domain/runs/run.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import {
  createChildTask,
  createRootTask,
  type Task,
} from '../../domain/tasks/task.js';
import { createTeamMemberRun } from '../../domain/teams/team-member-run.js';
import { createTeamRun, type TeamRun } from '../../domain/teams/team-run.js';
import { TeamExecutionError } from '../ports/team-execution-repository.js';
import { RuntimeTimedOutError } from '../runtime/execution-runtime-errors.js';
import type { ExecutionRuntimeService } from '../runtime/execution-plane-runtime-facade.js';
import type { InvokableRepository } from '../ports/invokable-repository.js';
import {
  RunCompletionConflictError,
  type ClaimedRun,
} from '../ports/run-repository.js';
import type { TaskRepository } from '../ports/task-repository.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { EnvironmentVersion } from '../ports/environment-registry.js';
import { ResolveAgentVersion } from '../agents/resolve-agent-version.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import { TeamDriver } from '../teams/team-driver.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../tasks/root-task-input.js';
import { CompleteRun } from './complete-run.js';
import { ExecuteRun } from './execute-run.js';
import { RUNTIME_RECOVERY_INSTRUCTION } from './run-prompt-context.js';
import { FakeAgentRuntime } from '../../../tests/fixtures/fake-agent-runtime.js';
import { collaborationToolRefsForRole } from '../../domain/collaboration/canonical-collaboration-tools.js';
import type { CreateMemoryProposal } from '../memory/create-memory-proposal.js';
import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
} from './runtime-execution-receipt.js';

type TestExecutionRuntime = ExecutionRuntimeService;

describe('ExecuteRun', () => {
  it('fails a terminal run when the runtime rejects execution', async () => {
    const claim = createClaim();
    const task = createTask();
    const runtime = new FakeAgentRuntime({
      error: new Error('fake runtime rejected execution'),
    });
    const completeExecute = vi.fn(async ({ run }: { run: Run }) => run);
    const completeRun = { execute: completeExecute } as unknown as CompleteRun;
    const executeRun = createExecuteRun({
      task,
      runtime,
      completeRun,
    });

    await executeRun.execute(claim);

    expect(completeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            code: 'runtime_execution_failed',
          }),
        }),
      }),
    );
  });

  it('allows a first product-session runtime session to execute', async () => {
    const claim = createClaim();
    const task = { ...createTask(), sessionId: 'product-session-1' } as Task;
    const runtimeSession = {
      id: 'runtime-product-1',
      scopeKind: 'product_session',
      scopeId: 'product-session-1',
      productSessionId: 'product-session-1',
      taskId: null,
      launchSnapshotId: 'launch-1',
      workspaceId: task.workspaceId,
      agentVersionId: task.invokableVersionId,
      environmentVersionId: 'environment-version-1',
      resolvedSkills: [],
      toolRefs: [],
      workspaceBinding: null,
      sessionBinding: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    } as const;
    const resolver = {
      resolve: vi.fn(async () => ({
        agentVersionId: task.invokableVersionId,
        modelPolicyRef: 'free-only',
        systemPrompt: 'system',
        turnPrompt: 'turn',
        skills: [],
        toolRefs: [],
        proposalLimit: 0,
      })),
    } as never;
    const sessions = {
      getSession: vi.fn(async () => ({
        id: 'product-session-1',
        workspaceId: task.workspaceId,
        tenantId: task.tenantId,
        principalType: task.principalType,
        principalId: task.principalId,
        publishedAgentVersionId: task.invokableVersionId,
        environmentVersionId: 'environment-version-1',
        generation: 1,
        status: 'active' as const,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
    };
    const environments = {
      findVersion: vi.fn(async (): Promise<EnvironmentVersion> => ({
        id: 'environment-version-1',
        definitionId: 'environment-definition-1',
        tenantId: task.tenantId,
        workspaceId: 'workspace-1',
        principalType: task.principalType,
        principalId: task.principalId,
        status: 'published' as const,
        displayName: 'test',
        canonicalJson: '{}',
        fingerprint: 'sha256:test',
        package: {
          apiVersion: 'agent-server/v1alpha1',
          kind: 'ManagedEnvironment',
          metadata: { name: 'test' },
          spec: {
            adapter: 'paseo',
            provider: 'opencode',
            modelPolicyRef: 'free-only',
            runtimeCellPolicy: 'per_runtime_session',
          },
        },
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        publishedAt: task.createdAt,
      })),
    };
    const runtimeSessions = {
      findByProductSession: vi.fn(
        async (): Promise<typeof runtimeSession | null> => null,
      ),
      createOrGetForProductSession: vi.fn(async () => runtimeSession),
    };
    const completeRunExecute = vi.fn(async ({ run }: { run: Run }) => run);
    const executeRun = new ExecuteRun(
      { execute: completeRunExecute } as never,
      {
        findById: vi.fn(async () => task),
        save: vi.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
      createRuntime(),
      { log: vi.fn() },
      () => new Date('2026-07-23T00:00:00.000Z'),
      resolver,
      {
        append: vi.fn(async () => undefined),
        bind: vi.fn(async () => undefined),
      } as never,
      undefined,
      undefined,
      undefined,
      runtimeSessions as never,
      sessions,
      environments,
    );

    await expect(executeRun.execute(claim)).resolves.toBeDefined();
    expect(runtimeSessions.createOrGetForProductSession).toHaveBeenCalled();
    expect(completeRunExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ status: 'succeeded' }),
      }),
    );

    runtimeSessions.findByProductSession.mockResolvedValue(runtimeSession);
    await expect(executeRun.execute(claim)).resolves.toBeDefined();
    expect(completeRunExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ status: 'succeeded' }),
      }),
    );
  });

  it('does not invent detail_kind when an upstream tool event omits detailKind', async () => {
    const claim = createClaim();
    const task = createTask();
    const append = vi.fn(async (..._args: readonly unknown[]) => undefined);
    const events = {
      append,
      bind: vi.fn(async () => undefined),
    };
    const runtime = createRuntime();
    vi.mocked(runtime.executeTurn).mockImplementation(async (_input, sink) => {
      await sink?.emit({
        kind: 'tool_updated',
        activityId: 'activity-shell-1',
        category: 'shell',
        status: 'completed',
        label: 'shell',
        summary: 'command completed',
        provider: 'test-provider',
      });
      return {
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        workspaceBinding: {
          plane: 'test',
          externalWorkspaceId: 'workspace-test',
        },
        sessionBinding: {
          plane: 'test',
          externalSessionId: 'agent-test',
        },
      };
    });
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const executeRun = new ExecuteRun(
      completeRun,
      {
        findById: vi.fn(async () => task),
        save: vi.fn(async () => undefined),
      } as never,
      {} as InvokableRepository,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date('2026-07-23T00:00:00.000Z'),
      undefined,
      events as never,
    );

    await executeRun.execute(claim);

    const outputCall = (
      append.mock.calls as unknown as Array<[string, string, unknown]>
    ).find(([, kind]) => kind === 'output');
    expect(outputCall?.[2]).not.toHaveProperty('detail_kind');
  });

  it('reuses the prior session provider Agent with its canonical bootstrap and persists the returned Agent id', async () => {
    const claim = createClaim();
    const task = {
      ...createTask('agent', 'managed-version-1'),
      sessionId: 'session-1',
      memorySnapshotId: 'snapshot-1',
      memorySnapshotHash: 'hash-1',
    } as Task;
    const catalogResolve = vi.fn(async (ref: string) =>
      ref === 'custom/skill'
        ? {
            ref,
            name: 'Custom skill',
            digest: 'sha256:custom-skill',
            objectPath: 'skills/custom-skill',
            manifestPath: 'skills/custom-skill/SKILL.md',
            delivery: 'native_project' as const,
            requiredToolRefs: [],
          }
        : null,
    );
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'managed instructions',
              tools: [],
              skills: [{ ref: 'custom/skill' }],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
        findVersionByTenant: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'managed instructions',
              tools: [],
              skills: [{ ref: 'custom/skill' }],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
      },
      { resolve: catalogResolve },
    );
    const events = {
      bind: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      findLatestSessionBindingBySessionId: vi.fn(async () => ({
        plane: 'paseo',
        externalSessionId: 'agent-prior',
      })),
    };
    const runtime = createRuntimeWithCandidates('agent-prior');
    const extensionBinding = {
      mcpServers: [
        {
          name: 'agent-server',
          url: 'http://127.0.0.1:39117/mcp',
          headers: { Authorization: 'Bearer grant-token' },
        },
      ],
      endpointEpoch: 'epoch-1',
      digest: 'sha256:extensions',
      grantId: 'grant-1',
    };
    const binder = vi.fn(async () => extensionBinding);
    const batch = vi.fn(async () => undefined);
    const executeRun = new ExecuteRun(
      { execute: vi.fn(async ({ run }: { run: Run }) => run) } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date(),
      resolver,
      events as never,
      { readVerified: vi.fn(async () => 'pinned memory') } as never,
      { executeBatch: batch } as never,
      { bind: binder } as never,
    );

    const out = await executeRun.execute(claim);

    expect(runtime.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        compatibilitySessionBinding: {
          plane: 'paseo',
          externalSessionId: 'agent-prior',
        },
        prompt:
          'Pinned verified MEMORY.md:\npinned memory\n\nCurrent Task input:\nprivate prompt',
        systemPrompt: expect.stringContaining('managed instructions'),
        extensions: extensionBinding,
        proposalLimit: 1,
      }),
      expect.objectContaining({ emit: expect.any(Function) }),
    );
    expect(catalogResolve).toHaveBeenCalledWith('custom/skill');
    expect(binder).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [expect.objectContaining({ ref: 'custom/skill' })],
      }),
    );
    expect(batch).toHaveBeenCalledTimes(1);
    expect(events.findLatestSessionBindingBySessionId).toHaveBeenCalledTimes(1);
    expect(events.bind).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionBinding: {
          plane: 'test',
          externalSessionId: 'agent-prior',
        },
      }),
    );
  });
  it('recovers an agentic Lead turn with its member-scoped current-Run grant', async () => {
    const claim = createClaim();
    const task = createChildTask({
      id: claim.taskId,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      policySnapshotVersion: 'policy-1',
      rootTaskId: 'root-task-1',
      parentTaskId: 'root-task-1',
      parentRunId: 'root-run-1',
      invokableKind: 'agent',
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
        prompt: 'private prompt',
      }),
      inputFingerprint: 'fingerprint-1',
      logicalStepKey: 'lead:team-run-1:lead-member-1',
      nodePath: 'lead-turn-1',
      teamMemberRunId: 'lead-member-1',
      teamSequence: 1,
      teamTaskKind: 'lead_turn',
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const team = createTeamRun({
      id: 'team-run-1',
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
      rootTaskId: task.rootTaskId,
      rootRunId: 'root-run-1',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      initialLeadTurn: true,
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const lead = createTeamMemberRun({
      id: 'lead-member-1',
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: task.invokableVersionId,
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const getTeamMemberGrant = vi.fn(() => ({
      grantId: 'grant-1',
      activeTurn: null,
      allowedTools: [],
      catalogTools: collaborationToolRefsForRole('lead'),
    }));
    const refreshForTeamMember = vi.fn(() => ({
      grantId: 'grant-1',
      activeTurn: {
        taskId: task.id,
        runId: claim.run.id,
        contextEpoch: 'epoch-1',
      },
      allowedTools: [],
      catalogTools: collaborationToolRefsForRole('lead'),
    }));
    const closeTeamMemberTurn = vi.fn(() => ({
      grantId: 'grant-1',
      activeTurn: null,
      allowedTools: [],
      catalogTools: collaborationToolRefsForRole('lead'),
    }));
    const activeToolCalls = vi.fn(() => 0);
    const runtime = createRuntimeWithCandidates('agent-prior');
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const collaborativeExecutions = {
      findTeamRunByRootTaskId: vi.fn(async () => team),
      findTeamRunById: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => [lead]),
      findMemberRunById: vi.fn(async () => lead),
      findWorkItemsByTeamRunId: vi.fn(async () => []),
      findAttemptsByTeamRunId: vi.fn(async () => []),
      updateMemberRunStatus: vi.fn(async () => lead),
      updateMemberRuntimeSession: vi.fn(async () => lead),
    };
    const executeRun = new ExecuteRun(
      completeRun,
      {
        findById: vi.fn(async () => task),
        findByRootTaskIdForOwner: vi.fn(async () => [
          { task, latestRun: claim.run },
        ]),
        save: vi.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date('2026-07-23T00:00:00.000Z'),
      undefined,
      {
        append: vi.fn(async () => undefined),
        bind: vi.fn(async () => undefined),
      } as never,
      undefined,
      undefined,
      {
        bind: vi.fn(),
        getTeamMemberGrant,
        refreshForTeamMember,
        closeTeamMemberTurn,
        activeToolCalls,
        revoke: vi.fn(),
      } as never,
      {
        findByTeamMember: vi.fn(async () => ({
          id: 'runtime-lead-1',
          scopeKind: 'team_member',
          scopeId: lead.id,
          productSessionId: null,
          taskId: task.id,
          launchSnapshotId: 'launch-1',
          workspaceId: task.workspaceId,
          agentVersionId: task.invokableVersionId,
          environmentVersionId: team.environmentVersionId,
          resolvedSkills: [],
          toolRefs: collaborationToolRefsForRole('lead'),
          workspaceBinding: {
            plane: 'paseo',
            externalWorkspaceId: 'workspace-provider-1',
          },
          sessionBinding: {
            plane: 'paseo',
            externalSessionId: 'agent-prior',
          },
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })),
      } as never,
      undefined,
      undefined,
      undefined,
      collaborativeExecutions as never,
      {
        findByIdForOwner: vi.fn(async () => ({
          ...claim.run,
          id: 'prior-run-id',
          status: 'succeeded',
        })),
      } as never,
    );

    const out = await executeRun.execute(claim);

    expect(getTeamMemberGrant).toHaveBeenCalledWith({
      teamMemberRunId: lead.id,
      scopeId: lead.id,
    });
    expect(refreshForTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        teamMemberRunId: lead.id,
        scopeId: lead.id,
        taskId: task.id,
        runId: claim.run.id,
      }),
    );
    expect(runtime.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSessionId: 'runtime-lead-1',
      }),
      expect.anything(),
    );
    expect(
      vi.mocked(runtime.executeTurn).mock.calls[0]?.[0],
    ).not.toHaveProperty('compatibilitySessionBinding');
  });
  it('ignores a stale Lead callback but preserves current-Lead no-progress and revision fences', async () => {
    const now = () => new Date('2026-07-23T00:00:00.000Z');
    const team = {
      ...createTeamRun({
        id: 'team-race-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'user',
        principalId: 'user-1',
        rootTaskId: 'root-task-1',
        rootRunId: 'root-run-1',
        teamVersionId: 'team-version-1',
        environmentVersionId: 'environment-version-1',
        initialLeadTurn: true,
        now,
      }),
      leadTurnCount: 4,
      revision: 8,
      controlState: 'lead_running' as const,
    };
    const leadTask = (sequence: number) =>
      createChildTask({
        id: `lead-task-${sequence}`,
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
        policySnapshotVersion: 'policy-1',
        rootTaskId: team.rootTaskId,
        parentTaskId: team.rootTaskId,
        parentRunId: team.rootRunId,
        invokableKind: 'agent',
        invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
          prompt: 'private prompt',
        }),
        inputFingerprint: 'fingerprint-1',
        logicalStepKey: `lead:${team.id}:lead-member:turn:${sequence}`,
        nodePath: `lead-${sequence}`,
        teamMemberRunId: 'lead-member',
        teamSequence: sequence,
        teamTaskKind: 'lead_turn',
        now,
      });
    const succeeded = transitionRun(
      transitionRun(
        createRun('private prompt', { id: 'lead-run-4', now }),
        'running',
        {},
        now,
      ),
      'succeeded',
      { result: { text: 'no control tool call' } },
      now,
    );
    const failTeamRunAtomically = vi
      .fn()
      .mockRejectedValueOnce(new TeamExecutionError('stale_state'))
      .mockResolvedValue(team);
    const executions = {
      findAttemptsByTeamRunId: vi.fn(async () => []),
      findTeamRunById: vi.fn(async () => team),
      findWorkItemsByTeamRunId: vi.fn(async () => []),
      failTeamRunAtomically,
    };
    const admission = {
      withTransaction: vi.fn(async (work: (tx: unknown) => Promise<void>) =>
        work({
          teamExecutions: {
            findMembersByTeamRunId: vi.fn(async () => [
              {
                id: 'lead-member',
                role: 'lead',
                agentVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
              },
            ]),
            advanceAgenticLead: vi.fn(async () => {
              throw new TeamExecutionError('stale_state');
            }),
          },
          tasks: {
            findByRootTaskIdForOwner: vi.fn(async () => []),
          },
        }),
      ),
    };
    const driver = new TeamDriver(
      executions as never,
      {} as never,
      {} as never,
      admission as never,
      undefined,
      undefined,
      now,
    );

    await driver.handleTerminalRun({
      team,
      task: leadTask(3),
      run: succeeded,
    });
    expect(failTeamRunAtomically).not.toHaveBeenCalled();

    await driver.handleTerminalRun({
      team,
      task: leadTask(4),
      run: succeeded,
    });
    expect(failTeamRunAtomically).toHaveBeenCalledTimes(1);
    expect(failTeamRunAtomically).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stopReason: 'lead_no_progress',
        expectedRevision: 8,
      }),
    );

    await driver.handleTerminalRun({
      team,
      task: leadTask(4),
      run: succeeded,
    });
    expect(failTeamRunAtomically).toHaveBeenCalledTimes(2);

    const lead = createTeamMemberRun({
      id: 'lead-member',
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now,
    });
    const member = createTeamMemberRun({
      id: 'member-1',
      teamRunId: team.id,
      name: 'member',
      role: 'member',
      agentVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now,
    });
    const lateCallbackTeam = { ...team, controlState: 'lead_ready' as const };
    const advanceAgenticLead = vi.fn();
    const lateFailTeamRunAtomically = vi.fn();
    const requeueDirectForFailedTask = vi.fn(async () => []);
    const reconcileForRootTask = vi.fn(async () => 0);
    const lateCallbackDriver = new TeamDriver(
      {
        findTeamRunById: vi.fn(async () => lateCallbackTeam),
        findAttemptsByTeamRunId: vi.fn(async () => []),
        findMembersByTeamRunId: vi.fn(async () => [lead, member]),
        findWorkItemsByTeamRunId: vi.fn(async () => []),
        findWorkDependenciesByTeamRunId: vi.fn(async () => []),
        advanceAgenticLead,
        failTeamRunAtomically: lateFailTeamRunAtomically,
      } as never,
      {
        findByRootTaskIdForOwner: vi.fn(async () => [
          { task: { ...leadTask(4), status: 'active' }, latestRun: succeeded },
        ]),
      } as never,
      {
        hasNonterminalRunsForTeamMemberChildTasks: vi.fn(async () => true),
      } as never,
      {} as never,
      {
        requeueDirectForFailedTask,
        listDirectForTeamRun: vi.fn(async () => []),
      },
      { reconcileForRootTask },
      now,
    );
    const lateDirectTask = createChildTask({
      id: 'late-direct-task',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
        prompt: 'late direct callback',
      }),
      inputFingerprint: 'fingerprint-1',
      logicalStepKey: 'member:team-race-1:member-1:direct',
      nodePath: 'late-direct',
      teamMemberRunId: member.id,
      teamTaskKind: 'direct_message',
      sourceTeamMessageId: 'direct-message-1',
      inputTeamMessageIds: ['direct-message-1', 'direct-message-2'],
      now,
    });
    await lateCallbackDriver.handleTerminalRun({
      team: lateCallbackTeam,
      task: lateDirectTask,
      run: succeeded,
    });
    expect(advanceAgenticLead).not.toHaveBeenCalled();
    expect(lateFailTeamRunAtomically).not.toHaveBeenCalled();
    expect(requeueDirectForFailedTask).not.toHaveBeenCalled();
    expect(reconcileForRootTask).toHaveBeenCalledWith(
      team.rootTaskId,
      expect.objectContaining({
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
      }),
      { parentTask: lateDirectTask },
    );

    reconcileForRootTask.mockClear();
    await lateCallbackDriver.handleTerminalRun({
      team: lateCallbackTeam,
      task: lateDirectTask,
      run: { ...succeeded, status: 'failed' },
    });
    expect(requeueDirectForFailedTask).toHaveBeenCalledWith({
      messageIds: ['direct-message-1', 'direct-message-2'],
      taskId: 'late-direct-task',
      owner: {
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
      },
    });
    expect(reconcileForRootTask).toHaveBeenCalledWith(
      team.rootTaskId,
      expect.objectContaining({
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
      }),
      { parentTask: lateDirectTask },
    );
  });

  it('fails a successful work attempt when the runtime never submits canonical work', async () => {
    const now = () => new Date('2026-07-23T00:00:00.000Z');
    const team = createTeamRun({
      id: 'team-without-submit',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-task-without-submit',
      rootRunId: 'root-run-without-submit',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    });
    const task = createChildTask({
      id: 'work-attempt-task-without-submit',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
        prompt: 'prepare the report',
      }),
      inputFingerprint: 'fingerprint-1',
      logicalStepKey: 'member:team-without-submit:member-1:attempt:1',
      nodePath: 'member-attempt-1',
      teamMemberRunId: 'member-1',
      teamSequence: 1,
      teamTaskKind: 'work_attempt',
      now,
    });
    const run = transitionRun(
      transitionRun(
        createRun('prepare the report', {
          id: 'work-attempt-run-without-submit',
          now,
        }),
        'running',
        {},
        now,
      ),
      'succeeded',
      {
        runtime: { provider: 'test-provider', model: 'test-model' },
        result: { text: 'provider finished without using team.submit' },
      },
      now,
    );
    const attempt = {
      id: 'attempt-without-submit',
      workItemId: 'work-1',
      teamRunId: team.id,
      attemptNo: 1,
      assigneeMemberId: 'member-1',
      requestedByLeadTaskId: 'lead-task-1',
      feedback: null,
      executionTaskId: task.id,
      status: 'running' as const,
      resultSummary: null,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: null,
    };
    const lead = createTeamMemberRun({
      id: 'lead-1',
      teamRunId: team.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      now,
    });
    const failTeamRunAtomically = vi.fn(async () => team);
    const updateAttemptStatus = vi.fn(async () => attempt);
    const submitCurrentAttempt = vi.fn();
    const executions = {
      findAttemptsByTeamRunId: vi.fn(async () => [attempt]),
      findTeamRunById: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => [lead]),
      findWorkItemsByTeamRunId: vi.fn(async () => [
        {
          id: 'work-1',
          teamRunId: team.id,
          status: 'in_progress',
        },
      ]),
      findWorkDependenciesByTeamRunId: vi.fn(async () => []),
      updateAttemptStatus,
      failTeamRunAtomically,
      submitCurrentAttempt,
    };
    const driver = new TeamDriver(
      executions as never,
      {
        findByRootTaskIdForOwner: vi.fn(async () => []),
      } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      now,
    );

    await driver.handleTerminalRun({ team, task, run });

    expect(failTeamRunAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        teamRunId: team.id,
        attemptId: attempt.id,
        childTaskId: task.id,
        childRunId: run.id,
        stopReason: 'succeeded_without_submit',
        failure: expect.objectContaining({
          code: 'runtime_execution_failed',
          message: expect.stringMatching(
            /^(?=.*runtime)(?=.*(?:succeed|success|complet|finish))(?=.*(?:without|did not|never))(?=.*submit)(?=.*work).*$/i,
          ),
        }),
      }),
    );
    expect(updateAttemptStatus).not.toHaveBeenCalled();
    expect(submitCurrentAttempt).not.toHaveBeenCalled();
    expect(executions.findTeamRunById).toHaveBeenCalledWith(
      team.id,
      expect.objectContaining({
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
      }),
    );
  });
  it('resolves a published managed Agent with durable Task ownership and sends only its instructions', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const findVersion = vi.fn(async (_owner: unknown, _versionId: string) => ({
      id: 'managed-version-1',
      status: 'published',
      package: {
        spec: {
          instructions: 'managed instructions',
          tools: [],
          skills: [],
          runtime: { modelPolicyRef: 'free-only' },
        },
      },
    })) as unknown as (owner: unknown, versionId: string) => Promise<never>;
    const findVersionByTenant = vi.fn(
      async (input: {
        readonly tenantId: string;
        readonly versionId: string;
      }) =>
        findVersion(
          {
            tenantId: input.tenantId,
            workspaceId: 'workspace-1',
            principalType: 'user',
            principalId: 'user-1',
          },
          input.versionId,
        ),
    );
    const resolver = new ResolveAgentVersion(
      { findVersion, findVersionByTenant },
      { resolve: vi.fn(async () => null) },
    );
    const runtime = createRuntime();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
    });

    await executeRun.execute(claim);

    expect(findVersion).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'user',
        principalId: 'user-1',
      },
      'managed-version-1',
    );
    expect(runtime.executeTurn).toHaveBeenCalledTimes(1);
    expect(runtime.executeTurn).toHaveBeenCalledWith(
      {
        runId: claim.run.id,
        prompt: 'private prompt',
        systemPrompt:
          'Runtime contract: execute the supplied task input using the published agent instructions. Do not infer or access other session history.\n\nPublished AgentVersion instructions:\nmanaged instructions',
        recoveryPrompt: `private prompt\n\n${RUNTIME_RECOVERY_INSTRUCTION}`,
      },
      undefined,
    );
    const executionRequest = JSON.stringify(
      vi.mocked(runtime.executeTurn).mock.calls[0]?.[0],
    ).replace(RUNTIME_RECOVERY_INSTRUCTION, '');
    expect(executionRequest).not.toMatch(
      /package|modelPolicyRef|schema|template|completion|tools/,
    );
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('succeeds without persisting runtime candidates for a direct Task with no source Message', async () => {
    const claim = createClaim();
    const task = createTask(
      'agent',
      'managed-version-1',
      'task-without-message',
      null,
    );
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'managed instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
        findVersionByTenant: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'managed instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
      },
      { resolve: vi.fn(async () => null) },
    );
    const runtime = createRuntimeWithCandidates();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const batch = vi.fn(async () => undefined);

    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
      createMemoryProposal: { executeBatch: batch } as never,
    });

    const completed = await executeRun.execute(claim);

    expect(completed.status).toBe('succeeded');
    expect(runtime.executeTurn).toHaveBeenCalledTimes(1);
    expect(batch).not.toHaveBeenCalled();
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the shared resolver returns null without a legacy lookup in ExecuteRun', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'draft-or-foreign-version');
    const findVersion = vi.fn(async () => ({
      id: 'draft-or-foreign-version',
      status: 'draft',
      package: {
        spec: { instructions: 'not executable', tools: [], skills: [] },
      },
    })) as never;
    const resolver = new ResolveAgentVersion(
      {
        findVersion,
        findVersionByTenant: vi.fn(async () => ({
          id: 'draft-or-foreign-version',
          status: 'draft',
          package: {
            spec: { instructions: 'not executable', tools: [], skills: [] },
          },
        })) as never,
      },
      { resolve: vi.fn(async () => null) },
    );
    const runtime = createRuntime();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
    });

    const completed = await executeRun.execute(claim);

    expect(completed.status).toBe('failed');
    expect(completed.error?.code).toBe('runtime_execution_failed');
    expect(runtime.executeTurn).not.toHaveBeenCalled();
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
  });

  it('reports persistence failure with a receipt after runtime success', async () => {
    const claim = createClaim();
    const task = createTask();
    const completeRun = {
      execute: vi.fn(
        async ({ claim, run }: { claim: ClaimedRun; run: Run }) => {
          throw new RunCompletionPersistenceError(
            createRuntimeExecutionReceipt(run, claim.taskId),
          );
        },
      ),
    } as unknown as CompleteRun;
    const runtime = createRuntime();
    const executeRun = createExecuteRun({ completeRun, runtime, task });

    await expect(executeRun.execute(claim)).rejects.toMatchObject({
      name: 'RunCompletionPersistenceError',
      code: 'terminal_persistence_failed',
      receipt: {
        runId: claim.run.id,
        taskId: claim.taskId,
        terminalStatus: 'succeeded',
        provider: 'test-provider',
        model: 'test-model',
        resultAvailable: true,
        resultFingerprint: expect.any(String),
      },
    });
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(completeRun.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          status: 'failed',
          error: { code: 'runtime_execution_failed' },
        }),
      }),
    );
  });

  it('rethrows a stale terminal completion conflict without terminal member mutation or a failed retry', async () => {
    const claim = createClaim();
    const task = createChildTask({
      id: claim.taskId,
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      policySnapshotVersion: 'policy-1',
      rootTaskId: 'root-task-1',
      parentTaskId: 'root-task-1',
      parentRunId: 'root-run-1',
      invokableKind: 'agent',
      invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
        prompt: 'private prompt',
      }),
      inputFingerprint: 'fingerprint-1',
      logicalStepKey: 'member:team-run-1:member-1',
      nodePath: 'member-1',
      teamMemberRunId: 'member-1',
      teamTaskKind: 'work_attempt',
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const owner = {
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
    };
    const team = createTeamRun({
      id: 'team-run-1',
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
      rootTaskId: task.rootTaskId,
      rootRunId: 'root-run-1',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const member = createTeamMemberRun({
      id: 'member-1',
      teamRunId: team.id,
      name: 'member',
      role: 'member',
      agentVersionId: task.invokableVersionId,
      tenantId: task.tenantId,
      workspaceId: task.workspaceId,
      principalType: task.principalType,
      principalId: task.principalId,
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });
    const conflict = new RunCompletionConflictError();
    const completeRun = {
      execute: vi.fn(async () => {
        throw conflict;
      }),
    } as unknown as CompleteRun;
    const collaborativeExecutions = {
      findTeamRunByRootTaskId: vi.fn(async () => team),
      findMemberRunById: vi.fn(async () => member),
      findMembersByTeamRunId: vi.fn(async () => [member]),
      findAttemptsByTeamRunId: vi.fn(async () => []),
      updateMemberRunStatus: vi.fn(async () => member),
    };
    const executeRun = new ExecuteRun(
      completeRun,
      {
        findById: vi.fn(async () => task),
        save: vi.fn(async () => undefined),
      } as never,
      {} as never,
      {} as never,
      createRuntime(),
      { log: vi.fn() },
      () => new Date('2026-07-23T00:00:00.000Z'),
      {
        resolvePublished: vi.fn(async () => ({
          instructions: 'Complete the assigned Team work.',
          skills: [],
          proposalLimit: 0,
          toolRefs: [],
        })),
      } as never,
      undefined,
      undefined,
      undefined,
      { bind: vi.fn(async () => undefined) } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      collaborativeExecutions as never,
    );

    await expect(executeRun.execute(claim)).rejects.toBe(conflict);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(completeRun.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(collaborativeExecutions.updateMemberRunStatus).toHaveBeenCalledTimes(
      1,
    );
    expect(collaborativeExecutions.updateMemberRunStatus).toHaveBeenCalledWith(
      member.id,
      'active',
      undefined,
      owner,
    );
  });

  it('completes a failed Run when runtime execution throws', async () => {
    const claim = createClaim();
    const task = createTask();
    const failedRun = {
      ...claim.run,
      status: 'failed',
      error: {
        code: 'runtime_execution_failed',
        message: 'The runtime could not complete the run.',
      },
    } as Run;
    const completeRun = {
      execute: vi.fn(async () => failedRun),
    } as unknown as CompleteRun;
    const runtime = createRuntime(new Error('runtime exploded'));
    const executeRun = createExecuteRun({ completeRun, runtime, task });

    await expect(executeRun.execute(claim)).resolves.toBe(failedRun);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    const firstCall = (
      completeRun.execute as unknown as {
        mock: { calls: Array<Array<{ run: Run }>> };
      }
    ).mock.calls[0];
    expect(firstCall?.[0]?.run).toMatchObject({
      status: 'failed',
      error: { code: 'runtime_execution_failed' },
    });
  });

  it('retries an existing unbound Team runtime session through create and bind', async () => {
    const fixture = createLeadRuntimeFixture();
    await fixture.executeRun.execute(fixture.claim);
    expect(fixture.runtime.executeTurn).toHaveBeenCalled();

    expect(fixture.runtime.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: expect.any(String) }),
      expect.anything(),
    );
    expect(fixture.binder.bind).toHaveBeenCalledWith(
      expect.objectContaining({ teamRunId: 'team-run-1' }),
    );
  });

  it('keeps a runtime timeout classification when Team grant narrowing also fails', async () => {
    const fixture = createLeadRuntimeFixture();
    const timeout = new (RuntimeTimedOutError as typeof RuntimeTimedOutError)();
    vi.mocked(fixture.runtime.executeTurn).mockRejectedValue(timeout);
    fixture.binder.closeTeamMemberTurn.mockImplementation(() => {
      throw new Error('narrowing failed');
    });
    fixture.binder.revoke.mockImplementation(() => {
      throw new Error('revoke failed');
    });
    fixture.logger.log.mockImplementation((_level, event) => {
      if (event === 'run.runtime_grant_revoke_failed')
        throw new Error('logger failed');
    });
    const failed = {
      ...fixture.claim.run,
      status: 'timed_out',
      error: {
        code: 'runtime_timed_out',
        message: 'The runtime exceeded the configured timeout.',
      },
    } as Run;
    vi.mocked(fixture.completeRun.execute).mockResolvedValue(failed);

    await expect(fixture.executeRun.execute(fixture.claim)).resolves.toBe(
      failed,
    );
    expect(fixture.completeRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          status: 'timed_out',
          error: expect.objectContaining({ code: 'runtime_timed_out' }),
        }),
      }),
    );
    expect(fixture.binder.revoke).toHaveBeenCalledWith('grant-1');
    expect(fixture.logger.log).toHaveBeenCalledWith(
      'warn',
      'run.runtime_grant_revoke_failed',
      expect.anything(),
    );
  });

  it('does not retry completion or report persistence failure when terminal logging fails', async () => {
    const claim = createClaim();
    const task = createTask();
    const succeededRun = transitionRun(
      claim.run,
      'succeeded',
      {
        runtime: { provider: 'test-provider', model: 'test-model' },
        result: { text: 'safe result' },
      },
      () => new Date('2026-07-23T00:00:00.000Z'),
    );
    const completeRun = {
      execute: vi.fn().mockResolvedValueOnce(succeededRun),
    } as unknown as CompleteRun;
    const loggerFailure = new Error('logger unavailable');
    const logger = {
      log: vi.fn((_level: string, event: string) => {
        if (event === 'run.succeeded') throw loggerFailure;
      }),
    };
    const executeRun = createExecuteRun({
      completeRun,
      runtime: createRuntime(),
      task,
      logger,
    });

    await expect(executeRun.execute(claim)).rejects.toBe(loggerFailure);
    expect(completeRun.execute).toHaveBeenCalledTimes(1);
    expect(logger.log).not.toHaveBeenCalledWith(
      'error',
      'run.completion_persistence_failed',
      expect.anything(),
    );
  });

  it('rejects a receipt for a nonterminal run status', () => {
    const claim = createClaim();

    expect(() => createRuntimeExecutionReceipt(claim.run)).toThrow(
      'Cannot create runtime execution receipt for running run',
    );
  });

  it('raises typed recoverable persistence failure for runtime memory candidates', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const runtime = createRuntimeWithCandidates();
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
        findVersionByTenant: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 1 },
            },
          },
        })) as never,
      },
      { resolve: vi.fn(async () => null) },
    );
    const createMemoryProposal = {
      execute: vi.fn(async () => {
        throw new Error('control plane down');
      }),
    } as never;
    const executeRun = createDirectExecuteRun({
      completeRun,
      runtime,
      task,
      resolver,
      createMemoryProposal,
    });

    await expect(executeRun.execute(claim)).rejects.toMatchObject({
      name: 'RuntimeMemoryPersistenceError',
      code: 'runtime_memory_persistence_failed',
    });
    expect(completeRun.execute).not.toHaveBeenCalled();
  });

  it('applies immutable proposal limit and rejects secret-like runtime candidates', async () => {
    const claim = createClaim();
    const task = createTask('agent', 'managed-version-1');
    const runtime = {
      ...createRuntime(),
      executeTurn: vi.fn(async () => ({
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        workspaceBinding: {
          plane: 'test',
          externalWorkspaceId: 'workspace-test',
        },
        sessionBinding: {
          plane: 'test',
          externalSessionId: 'agent-test',
        },
        memoryCandidates: [
          { category: 'project_constraint', content: 'api_key=secret' },
          { category: 'project_constraint', content: 'safe constraint' },
          { category: 'project_constraint', content: 'over limit candidate' },
        ],
      })),
    } as TestExecutionRuntime;
    const completeRun = {
      execute: vi.fn(async ({ run }: { run: Run }) => run),
    } as unknown as CompleteRun;
    const batch = vi.fn(
      async (inputs: readonly { content: string }[]) => inputs as never,
    );
    const createMemoryProposal = {
      execute: vi.fn(),
      executeBatch: batch,
    } as unknown as CreateMemoryProposal;
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 2 },
            },
          },
        })) as never,
        findVersionByTenant: vi.fn(async () => ({
          id: 'managed-version-1',
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: 2 },
            },
          },
        })) as never,
      },
      { resolve: vi.fn(async () => null) },
    );
    await new ExecuteRun(
      completeRun,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date(),
      resolver,
      undefined,
      undefined,
      createMemoryProposal,
    ).execute(claim);
    expect(batch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: 'safe constraint' }),
      ]),
    );
    expect(batch.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('keeps proposal limits execution-local across concurrent managed and compatibility runs', async () => {
    const lowTask = createTask('agent', 'managed-low', 'task-low');
    const highTask = createTask('agent', 'managed-high', 'task-high');
    const compatibilityTask = createTask(
      'agent',
      RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
      'task-compat',
    );
    const tasksById = new Map([
      ['task-low', lowTask],
      ['task-high', highTask],
      ['task-compat', compatibilityTask],
    ]);
    const claims = [
      createClaimWithIds('run-low', 'task-low'),
      createClaimWithIds('run-high', 'task-high'),
      createClaimWithIds('run-compat', 'task-compat'),
    ];
    const runtime = {
      ...createRuntime(),
      executeTurn: vi.fn(async ({ runId }: { runId: string }) => {
        await new Promise((resolve) =>
          setTimeout(resolve, runId === 'run-low' ? 10 : 0),
        );
        return {
          provider: 'test-provider',
          model: 'test-model',
          text: runId,
          workspaceBinding: {
            plane: 'test',
            externalWorkspaceId: 'workspace-test',
          },
          sessionBinding: {
            plane: 'test',
            externalSessionId: 'agent-test',
          },
          memoryCandidates: [
            { category: 'project_constraint', content: 'one' },
            { category: 'project_constraint', content: 'two' },
            { category: 'project_constraint', content: 'three' },
          ],
        };
      }),
    } as TestExecutionRuntime;
    const batch = vi.fn(
      async (inputs: readonly { content: string }[]) => inputs as never,
    );
    const resolver = new ResolveAgentVersion(
      {
        findVersion: vi.fn(async (_scope, id: string) => ({
          id,
          status: 'published',
          package: {
            spec: {
              instructions: 'instructions',
              tools: [],
              skills: [],
              runtime: { modelPolicyRef: 'free-only' },
              memory: { proposalLimit: id === 'managed-low' ? 1 : 3 },
            },
          },
        })) as never,
        findVersionByTenant: vi.fn(
          async (input: {
            readonly tenantId: string;
            readonly versionId: string;
          }) => ({
            id: input.versionId,
            status: 'published',
            package: {
              spec: {
                instructions: 'instructions',
                tools: [],
                skills: [],
                runtime: { modelPolicyRef: 'free-only' },
                memory: {
                  proposalLimit: input.versionId === 'managed-low' ? 1 : 3,
                },
              },
            },
          }),
        ) as never,
      },
      { resolve: vi.fn(async () => null) },
    );
    const executeRun = new ExecuteRun(
      { execute: vi.fn(async ({ run }: { run: Run }) => run) } as never,
      {
        findById: vi.fn(async (id: string) => tasksById.get(id) ?? null),
        save: vi.fn(),
      } as never,
      {} as never,
      {} as never,
      runtime,
      { log: vi.fn() },
      () => new Date(),
      resolver,
      undefined,
      undefined,
      { executeBatch: batch } as never,
    );

    await Promise.all([
      executeRun.execute(claims[0]!),
      executeRun.execute(claims[1]!),
    ]);
    expect(runtime.executeTurn).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls.map(([inputs]) => inputs.length).sort()).toEqual([
      1, 3,
    ]);

    await executeRun.execute(claims[2]!);
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'does not emit terminal events when persistence arbitrates cancellation after runtime %s',
    async (runtimeFails) => {
      const claim = createClaim();
      const task = createTask();
      const events = {
        bind: vi.fn(async () => undefined),
        append: vi.fn(async () => undefined),
      };
      const completeRun = {
        execute: vi.fn(async () =>
          transitionRun(
            claim.run,
            'cancelled',
            { error: { code: 'cancelled', message: 'The run was cancelled.' } },
            () => new Date('2026-07-23T00:00:02.000Z'),
          ),
        ),
      } as unknown as CompleteRun;
      const executeRun = new ExecuteRun(
        completeRun,
        {
          findById: vi.fn(async () => task),
          save: vi.fn(async () => undefined),
        } as never,
        {} as never,
        {} as never,
        createRuntime(runtimeFails ? new Error('late failure') : undefined),
        { log: vi.fn() },
        () => new Date('2026-07-23T00:00:01.000Z'),
        new ResolveAgentVersion(
          {
            findVersion: vi.fn(async () => null),
            findVersionByTenant: vi.fn(async () => null),
          } as never,
          { resolve: vi.fn(async () => null) },
        ),
        events as never,
      );
      await executeRun.execute(claim);
      expect(
        (events.append.mock.calls as unknown as Array<Array<unknown>>).map(
          (call) => call[1],
        ),
      ).toEqual(['started']);
    },
  );
});

function createExecuteRun(input: {
  readonly completeRun: CompleteRun;
  readonly runtime: TestExecutionRuntime;
  readonly task: Task;
  readonly logger?: Logger;
}): ExecuteRun {
  const tasks = {
    findById: vi.fn(async () => input.task),
    save: vi.fn(async () => undefined),
  } as unknown as TaskRepository;
  return new ExecuteRun(
    input.completeRun,
    tasks,
    {} as InvokableRepository,
    {} as never,
    input.runtime,
    input.logger ?? { log: vi.fn() },
    () => new Date('2026-07-23T00:00:00.000Z'),
  );
}

function createLeadRuntimeFixture() {
  const claim = createClaim();
  const task = createChildTask({
    id: claim.taskId,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'user',
    principalId: 'user-1',
    policySnapshotVersion: 'policy-1',
    rootTaskId: 'root-task-1',
    parentTaskId: 'root-task-1',
    parentRunId: 'root-run-1',
    invokableKind: 'agent',
    invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'private prompt',
    }),
    inputFingerprint: 'fingerprint-1',
    logicalStepKey: 'lead:team-run-1:lead-member-1',
    nodePath: 'lead-turn-1',
    teamMemberRunId: 'lead-member-1',
    teamSequence: 1,
    teamTaskKind: 'lead_turn',
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  const team = createTeamRun({
    id: 'team-run-1',
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
    rootTaskId: task.rootTaskId,
    rootRunId: 'root-run-1',
    teamVersionId: 'team-version-1',
    environmentVersionId: 'environment-version-1',
    initialLeadTurn: true,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  const lead = createTeamMemberRun({
    id: 'lead-member-1',
    teamRunId: team.id,
    name: 'lead',
    role: 'lead',
    agentVersionId: task.invokableVersionId,
    tenantId: task.tenantId,
    workspaceId: task.workspaceId,
    principalType: task.principalType,
    principalId: task.principalId,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  const grant = {
    grantId: 'grant-1',
    activeTurn: null,
    allowedTools: collaborationToolRefsForRole('lead'),
    catalogTools: collaborationToolRefsForRole('lead'),
  };
  const binder = {
    bind: vi.fn(async () => ({})),
    getTeamMemberGrant: vi.fn(() => grant),
    refreshForTeamMember: vi.fn(() => ({ ...grant, allowedTools: [] })),
    closeTeamMemberTurn: vi.fn(() => ({ ...grant, activeTurn: null })),
    activeToolCalls: vi.fn(() => 0),
    revoke: vi.fn(),
  };
  const runtime = createRuntimeWithCandidates('agent-created');
  vi.mocked(runtime.executeTurn).mockResolvedValue({
    provider: 'test-provider',
    model: 'test-model',
    text: 'safe result',
    workspaceBinding: {
      plane: 'test',
      externalWorkspaceId: 'workspace-provider-1',
    },
    sessionBinding: {
      plane: 'test',
      externalSessionId: 'agent-created',
    },
  });
  const completeRun = {
    execute: vi.fn(async ({ run }: { run: Run }) => run),
  } as unknown as CompleteRun;
  const runtimeSessions = {
    findByTeamMember: vi.fn(async () => ({
      id: 'runtime-lead-1',
      scopeKind: 'team_member',
      scopeId: lead.id,
      productSessionId: null,
      taskId: task.id,
      launchSnapshotId: 'launch-1',
      workspaceId: task.workspaceId,
      agentVersionId: task.invokableVersionId,
      environmentVersionId: team.environmentVersionId,
      resolvedSkills: [],
      toolRefs: collaborationToolRefsForRole('lead'),
      workspaceBinding: null,
      sessionBinding: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
  };
  const collaborativeExecutions = {
    findTeamRunByRootTaskId: vi.fn(async () => team),
    findTeamRunById: vi.fn(async () => team),
    findMembersByTeamRunId: vi.fn(async () => [lead]),
    findMemberRunById: vi.fn(async () => lead),
    findWorkItemsByTeamRunId: vi.fn(async () => []),
    findAttemptsByTeamRunId: vi.fn(async () => []),
    updateMemberRunStatus: vi.fn(async () => lead),
    updateMemberRuntimeSession: vi.fn(async () => lead),
  };
  const logger = { log: vi.fn() };
  const executeRun = new ExecuteRun(
    completeRun,
    {
      findById: vi.fn(async () => task),
      findByRootTaskIdForOwner: vi.fn(async () => [
        { task, latestRun: claim.run },
      ]),
      save: vi.fn(async () => undefined),
    } as never,
    {} as never,
    {} as never,
    runtime,
    logger,
    () => new Date('2026-07-23T00:00:00.000Z'),
    undefined,
    {
      append: vi.fn(async () => undefined),
      bind: vi.fn(async () => undefined),
    } as never,
    undefined,
    undefined,
    binder as never,
    runtimeSessions as never,
    undefined,
    undefined,
    undefined,
    collaborativeExecutions as never,
  );
  return {
    claim,
    task,
    lead,
    team,
    executeRun,
    runtime,
    binder,
    runtimeSessions,
    completeRun,
    logger,
  };
}

function createDirectExecuteRun(input: {
  readonly completeRun: CompleteRun;
  readonly runtime: TestExecutionRuntime;
  readonly task: Task;
  readonly resolver: ResolveAgentVersion;
  readonly createMemoryProposal?: CreateMemoryProposal;
}): ExecuteRun {
  const tasks = {
    findById: vi.fn(async () => input.task),
    save: vi.fn(async () => undefined),
  } as unknown as TaskRepository;
  return new ExecuteRun(
    input.completeRun,
    tasks,
    {} as InvokableRepository,
    {} as never,
    input.runtime,
    { log: vi.fn() },
    () => new Date('2026-07-23T00:00:00.000Z'),
    input.resolver,
    undefined,
    undefined,
    input.createMemoryProposal,
  );
}

function createRuntimeWithCandidates(
  externalSessionId = 'agent-test',
): TestExecutionRuntime {
  const runtime = createRuntime();
  vi.mocked(runtime.executeTurn).mockResolvedValue({
    provider: 'test-provider',
    model: 'test-model',
    text: 'safe result',
    workspaceBinding: {
      plane: 'test',
      externalWorkspaceId: 'workspace-test',
    },
    sessionBinding: { plane: 'test', externalSessionId },
    memoryCandidates: [
      { category: 'project_constraint', content: 'keep logs' },
    ],
  });
  return runtime;
}

function createRuntime(error?: Error): TestExecutionRuntime {
  const runtime = {
    ensureReady: vi.fn(async () => true),
    executeTurn: vi.fn(async () => {
      if (error) throw error;
      return {
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        workspaceBinding: {
          plane: 'test',
          externalWorkspaceId: 'workspace-test',
        },
        sessionBinding: {
          plane: 'test',
          externalSessionId: 'agent-test',
        },
      };
    }),
    cancelRun: vi.fn(async () => undefined),
    planeHealth: vi.fn(async () => ({
      ready: true,
      plane: 'test',
      provider: 'test-provider',
      model: 'test-model',
      checks: [],
    })),
    close: vi.fn(async () => undefined),
  } as unknown as TestExecutionRuntime;
  return runtime;
}

function createClaim(): ClaimedRun {
  const queuedRun = createRun('private prompt', {
    id: 'run-1',
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  const run = transitionRun(
    queuedRun,
    'running',
    {},
    () => new Date('2026-07-23T00:00:00.000Z'),
  );
  return {
    run,
    taskId: 'task-1',
    attempt: 1,
    workerId: 'worker-1',
    activationId: 'activation-1',
    fencingToken: 1,
    leaseExpiresAt: '2026-07-23T01:00:00.000Z',
  };
}

function createClaimWithIds(runId: string, taskId: string): ClaimedRun {
  const queuedRun = createRun('private prompt', {
    id: runId,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
  return {
    run: transitionRun(
      queuedRun,
      'running',
      {},
      () => new Date('2026-07-23T00:00:00.000Z'),
    ),
    taskId,
    attempt: 1,
    workerId: 'worker-1',
    activationId: `activation-${runId}`,
    fencingToken: 1,
    leaseExpiresAt: '2026-07-23T01:00:00.000Z',
  };
}

function createTask(
  invokableKind: 'agent' | 'team' = 'agent',
  invokableVersionId = RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
  id = 'task-1',
  sourceMessageId: string | null = `message-${id}`,
): Task {
  return createRootTask({
    id,
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    principalType: 'user',
    principalId: 'user-1',
    policySnapshotVersion: 'policy-1',
    ingress: 'api',
    originRef: null,
    invokableKind,
    invokableVersionId,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'private prompt',
    }),
    inputFingerprint: 'fingerprint-1',
    sourceMessageId,
    now: () => new Date('2026-07-23T00:00:00.000Z'),
  });
}
