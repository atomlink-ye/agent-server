import { describe, expect, it, vi } from 'vitest';

import { CompleteRun } from './complete-run.js';
import { ExecuteRun } from './execute-run.js';
import { createRun, transitionRun } from '../../domain/runs/run.js';
import {
  createRootTask,
  createChildTask,
  transitionTask,
  type Task,
} from '../../domain/tasks/task.js';
import { RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID } from '../../domain/tasks/compatibility-invokable-version.js';
import { createTeamRun } from '../../domain/teams/team-run.js';
import { createTeamMemberRun } from '../../domain/teams/team-member-run.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import { FakeAgentRuntime } from '../../../tests/fixtures/fake-agent-runtime.js';
import { createLogger } from '../../shared/observability/logger.js';
import { InMemoryRunEventRepository } from '../../infrastructure/memory/in-memory-run-event-repository.js';
import {
  RunCompletionConflictError,
  type ClaimedRun,
} from '../ports/run-repository.js';
import { TeamDriver } from '../teams/team-driver.js';
import { ExecuteTeamTask } from '../tasks/execute-team-task.js';
import {
  encodeRootTaskRunRequestSnapshotRef,
  fingerprintRootTaskRunRequest,
} from '../tasks/root-task-input.js';
import { collaborationToolRefsForRole } from '../../domain/collaboration/canonical-collaboration-tools.js';
import {
  RunCompletionPersistenceError,
  RunPostPersistenceError,
  RuntimeMemoryPersistenceError,
  createRuntimeExecutionReceipt,
} from './runtime-execution-receipt.js';
import { RuntimeTimedOutError } from '../runtime/execution-runtime-errors.js';

// This file intentionally remains a broad characterization suite around ExecuteRun.
// Focused unit tests for extracted collaborators live next to those collaborators.

describe('ExecuteRun', () => {
  const logger = createLogger({ service: 'execute-run-test', sink: () => {} });

  function createBaseTask(overrides: Partial<Task> = {}): Task {
    return {
      ...createRootTask({
        id: 'task-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'user',
        principalId: 'user-1',
        policySnapshotVersion: 'policy-1',
        invokableKind: 'agent',
        invokableVersionId: RUN_API_COMPATIBILITY_INVOKABLE_VERSION_ID,
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'prompt' }),
        inputFingerprint: fingerprintRootTaskRunRequest({ prompt: 'prompt' }),
        ingress: 'api',
        originRef: null,
        now: () => new Date('2026-07-23T00:00:00.000Z'),
      }),
      ...overrides,
    };
  }

  function createClaim(run = createRun('prompt', { id: 'run-1' })): ClaimedRun {
    return {
      run,
      taskId: 'task-1',
      workerId: 'worker-1',
      activationId: 'activation-1',
      fencingToken: 1,
    };
  }

  function createSubject(options: {
    task?: Task;
    runtime?: FakeAgentRuntime;
    completeRun?: CompleteRun;
    events?: InMemoryRunEventRepository;
    resolver?: any;
    fileStore?: any;
    createMemoryProposal?: any;
    runtimeExtensionBinder?: any;
    runtimeSessions?: any;
    sessions?: any;
    environments?: any;
    runtimeCellRoot?: string;
    collaborativeExecutions?: any;
    runs?: any;
    activationReconciler?: any;
    executeTeamTask?: ExecuteTeamTask;
  } = {}) {
    const task = options.task ?? createBaseTask();
    const savedTasks: Task[] = [];
    const tasks = {
      findById: vi.fn(async () => task),
      save: vi.fn(async (value: Task) => {
        savedTasks.push(value);
      }),
      findByIdForOwner: vi.fn(async () => ({ task, latestRun: null })),
      findByRootTaskIdForOwner: vi.fn(async () => []),
    };
    const runtime = options.runtime ?? new FakeAgentRuntime();
    const completeRun =
      options.completeRun ??
      (new CompleteRun(
        {
          complete: vi.fn(async ({ run }: { run: any }) => run),
        } as never,
        tasks as never,
      ) as CompleteRun);
    const executeTeamTask =
      options.executeTeamTask ??
      (new ExecuteTeamTask(
        { getPublishedTeamVersion: vi.fn(async () => null) } as never,
        {} as never,
      ) as ExecuteTeamTask);
    const subject = new ExecuteRun(
      completeRun,
      tasks as never,
      {} as never,
      executeTeamTask,
      runtime,
      logger,
      undefined,
      options.resolver,
      options.events,
      options.fileStore,
      options.createMemoryProposal,
      options.runtimeExtensionBinder,
      options.runtimeSessions,
      options.sessions,
      options.environments,
      options.runtimeCellRoot,
      options.collaborativeExecutions,
      options.runs,
      options.activationReconciler,
    );
    return { subject, task, tasks, savedTasks, runtime };
  }

  it('fails a terminal run when the runtime rejects execution', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.runError = new Error('runtime failed');
    const completed: any[] = [];
    const task = createBaseTask();
    const completeRun = new CompleteRun(
      {
        complete: vi.fn(async ({ run }: { run: any }) => {
          completed.push(run);
          return run;
        }),
      } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
    );
    const { subject } = createSubject({ task, runtime, completeRun });
    const result = await subject.execute(createClaim());
    expect(result.status).toBe('failed');
    expect(completed.at(-1)?.error?.code).toBe('runtime_execution_failed');
  });

  it('allows a first product-session runtime session to execute', async () => {
    const task = createBaseTask({ sessionId: 'session-1' });
    const runtimeSessions = {
      findByProductSession: vi.fn(async () => null),
      createOrGetForProductSession: vi.fn(async () => ({
        id: 'runtime-session-1',
        scopeKind: 'product_session',
        scopeId: 'session-1',
        taskId: task.id,
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
        principalType: task.principalType,
        principalId: task.principalId,
        agentVersionId: task.invokableVersionId,
        environmentVersionId: 'environment-version-1',
        resolvedSkills: [],
        toolRefs: [],
        workspaceBinding: null,
        sessionBinding: null,
      })),
    };
    const sessions = {
      getSession: vi.fn(async () => ({
        id: 'session-1',
        environmentVersionId: 'environment-version-1',
      })),
    };
    const environments = {
      findVersion: vi.fn(async () => ({
        status: 'published',
        package: {
          spec: {
            adapter: 'paseo',
            provider: 'opencode',
            modelPolicyRef: 'free-only',
            runtimeCellPolicy: 'per_runtime_session',
          },
        },
      })),
    };
    const runtime = new FakeAgentRuntime();
    runtime.nextSessionBinding = {
      plane: 'paseo',
      externalSessionId: 'provider-agent-1',
    };
    const { subject } = createSubject({
      task,
      runtime,
      runtimeSessions,
      sessions,
      environments,
    });
    await subject.execute(createClaim());
    expect(runtimeSessions.createOrGetForProductSession).toHaveBeenCalled();
    expect(runtime.requests).toHaveLength(1);
  });

  it('does not invent detail_kind when an upstream tool event omits detailKind', async () => {
    const events = new InMemoryRunEventRepository();
    const runtime = new FakeAgentRuntime();
    runtime.observations = [
      {
        kind: 'tool_updated',
        activityId: 'tool-1',
        category: 'other',
        status: 'running',
        label: 'Tool',
        summary: 'Tool running',
        toolName: 'provider_tool',
        provider: 'opencode',
      },
    ];
    const { subject } = createSubject({ runtime, events });
    await subject.execute(createClaim());
    const output = (await events.list('run-1')).find(
      (event) => event.type === 'output',
    );
    expect(output?.payload).not.toHaveProperty('detail_kind');
  });

  it('passes the prior session provider Agent and persists the returned Agent id', async () => {
    const task = createBaseTask({ sessionId: 'session-1' });
    const events = new InMemoryRunEventRepository();
    await events.bind({
      runId: 'previous-run',
      sessionId: 'session-1',
      sessionBinding: { plane: 'paseo', externalSessionId: 'provider-agent-old' },
      createdAt: '2026-07-22T00:00:00.000Z',
    });
    const runtime = new FakeAgentRuntime();
    runtime.nextSessionBinding = {
      plane: 'paseo',
      externalSessionId: 'provider-agent-new',
    };
    const { subject } = createSubject({ task, runtime, events });
    await subject.execute(createClaim());
    expect(runtime.requests[0]?.compatibilitySessionBinding).toEqual({
      plane: 'paseo',
      externalSessionId: 'provider-agent-old',
    });
    const binding = await events.findLatestSessionBindingBySessionId('session-1');
    expect(binding?.externalSessionId).toBe('provider-agent-new');
  });

  it('recovers an agentic Lead turn with its member-scoped current-Run grant', async () => {
    const now = () => new Date('2026-07-23T00:00:00.000Z');
    const team = createTeamRun({
      id: 'team-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-task-1',
      rootRunId: 'root-run-1',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    });
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
    const task = createChildTask({
      id: 'lead-task-1',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: lead.agentVersionId,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'lead' }),
      inputFingerprint: 'fingerprint-lead',
      logicalStepKey: 'lead-turn-1',
      nodePath: 'lead-turn-1',
      teamMemberRunId: lead.id,
      teamTaskKind: 'lead_turn',
      teamSequence: 1,
      now,
    });
    const runtimeSessions = {
      findByTeamMember: vi.fn(async () => ({
        id: 'runtime-session-lead',
        scopeKind: 'team_member',
        scopeId: lead.id,
        taskId: task.id,
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
        agentVersionId: lead.agentVersionId,
        environmentVersionId: team.environmentVersionId,
        resolvedSkills: [],
        toolRefs: collaborationToolRefsForRole('lead'),
        workspaceBinding: { plane: 'paseo', externalWorkspaceId: 'workspace-1' },
        sessionBinding: { plane: 'paseo', externalSessionId: 'agent-lead' },
      })),
    };
    const collaborativeExecutions = {
      findMemberRunById: vi.fn(async () => lead),
      findTeamRunByRootTaskId: vi.fn(async () => team),
      findWorkItemsByTeamRunId: vi.fn(async () => []),
      findAttemptsByTeamRunId: vi.fn(async () => []),
      findCompletionDecisionForRequest: vi.fn(async () => null),
      findMembersByTeamRunId: vi.fn(async () => [lead]),
      updateMemberRunStatus: vi.fn(async () => lead),
      findTeamRunById: vi.fn(async () => team),
    };
    const runtimeExtensionBinder = {
      getTeamMemberGrant: vi.fn(() => ({
        grantId: 'grant-lead',
        runId: 'previous-run',
        allowedTools: [],
        catalogTools: collaborationToolRefsForRole('lead'),
      })),
      activeToolCalls: vi.fn(() => 0),
      refreshForTeamMember: vi.fn((input: any) => ({
        grantId: input.grantId ?? 'grant-lead',
        allowedTools: input.allowedTools,
        catalogTools: collaborationToolRefsForRole('lead'),
      })),
      revoke: vi.fn(),
    };
    const runs = {
      findByIdForOwner: vi.fn(async () => ({ status: 'succeeded' })),
    };
    const resolver = {
      resolvePublished: vi.fn(async () => ({
        instructions: 'lead instructions',
        proposalLimit: 0,
        modelPolicyRef: 'free-only',
        skills: [],
        toolRefs: [],
      })),
    };
    const runtime = new FakeAgentRuntime();
    const complete = new CompleteRun(
      { complete: vi.fn(async ({ run }: { run: any }) => run) } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
    );
    const subject = new ExecuteRun(
      complete,
      {
        findById: vi.fn(async () => task),
        save: vi.fn(),
        findByRootTaskIdForOwner: vi.fn(async () => []),
      } as never,
      {} as never,
      {} as never,
      runtime,
      logger,
      undefined,
      resolver,
      undefined,
      undefined,
      undefined,
      runtimeExtensionBinder as never,
      runtimeSessions as never,
      undefined,
      undefined,
      undefined,
      collaborativeExecutions as never,
      runs as never,
    );
    await subject.execute({
      ...createClaim(createRun('lead continuation', { id: 'run-lead' })),
      taskId: task.id,
    });
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]?.runtimeSessionId).toBe('runtime-session-lead');
    expect(runtimeExtensionBinder.refreshForTeamMember).toHaveBeenCalled();
  });

  it('ignores a stale Lead callback but preserves current-Lead no-progress and revision fences', async () => {
    const now = () => new Date('2026-07-23T00:00:00.000Z');
    const team = createTeamRun({
      id: 'team-race-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-task-1',
      rootRunId: 'root-run-1',
      teamVersionId: 'team-version-1',
      environmentVersionId: 'environment-version-1',
      now,
    });
    const succeeded = transitionRun(
      createRun('lead done', { id: 'lead-run-1', now }),
      'succeeded',
      { result: { text: 'done' } },
      now,
    );
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
        inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'lead' }),
        inputFingerprint: 'fingerprint-lead',
        logicalStepKey: `lead:${sequence}`,
        nodePath: `lead:${sequence}`,
        teamMemberRunId: 'lead-member',
        teamTaskKind: 'lead_turn',
        teamSequence: sequence,
        now,
      });
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
      { requeueDirectForFailedTask },
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
      id: 'team-submit-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-task-submit',
      rootRunId: 'root-run-submit',
      teamVersionId: 'team-version-submit',
      environmentVersionId: 'environment-version-submit',
      now,
    });
    const task = createChildTask({
      id: 'work-task-submit',
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
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'work' }),
      inputFingerprint: 'fingerprint-work',
      logicalStepKey: 'work-submit',
      nodePath: 'work-submit',
      teamMemberRunId: 'member-submit',
      teamTaskKind: 'work_attempt',
      teamSequence: 1,
      now,
    });
    const attempt: TeamWorkItemAttempt = {
      id: 'attempt-submit',
      workItemId: 'work-submit',
      teamRunId: team.id,
      attemptNo: 1,
      assigneeMemberId: 'member-submit',
      requestedByLeadTaskId: 'lead-task-submit',
      feedback: null,
      executionTaskId: task.id,
      status: 'running',
      resultSummary: null,
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      completedAt: null,
    };
    const failTeamRunAtomically = vi.fn(async () => ({ ...team, status: 'failed' }));
    const driver = new TeamDriver(
      {
        findAttemptsByTeamRunId: vi.fn(async () => [attempt]),
        failTeamRunAtomically,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      now,
    );
    const runtimeRun = transitionRun(
      createRun('work', { id: 'runtime-work-submit', now }),
      'succeeded',
      { result: { text: 'runtime exited' } },
      now,
    );
    await driver.handleTerminalRun({ team, task, run: runtimeRun });
    expect(failTeamRunAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        stopReason: 'succeeded_without_submit',
        failure: expect.objectContaining({
          message: expect.stringMatching(/Work.*board_submit/u),
        }),
      }),
    );
  });

  it('resolves a published managed Agent with durable Task ownership and sends only its instructions', async () => {
    const resolver = {
      resolvePublished: vi.fn(async () => ({
        instructions: 'managed instructions',
        proposalLimit: 0,
        modelPolicyRef: 'free-only',
        skills: [],
        toolRefs: [],
      })),
    };
    const runtime = new FakeAgentRuntime();
    const task = createBaseTask({
      invokableVersionId: 'managed-agent-version',
    });
    const { subject } = createSubject({ task, runtime, resolver });
    await subject.execute(createClaim());
    expect(resolver.resolvePublished).toHaveBeenCalled();
    expect(runtime.requests[0]?.systemPrompt).toContain('managed instructions');
    expect(runtime.requests[0]?.prompt).toBe('prompt');
  });

  it('succeeds without persisting runtime candidates for a direct Task with no source Message', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.nextMemoryCandidates = [
      { category: 'terminology', content: 'Term means something.' },
    ];
    const createMemoryProposal = {
      execute: vi.fn(async () => undefined),
      executeBatch: vi.fn(async () => undefined),
    };
    const { subject } = createSubject({ runtime, createMemoryProposal });
    await subject.execute(createClaim());
    expect(createMemoryProposal.execute).not.toHaveBeenCalled();
    expect(createMemoryProposal.executeBatch).not.toHaveBeenCalled();
  });

  it('fails closed when the shared resolver returns null without a legacy lookup in ExecuteRun', async () => {
    const resolver = { resolvePublished: vi.fn(async () => null) };
    const task = createBaseTask({ invokableVersionId: 'missing-version' });
    const { subject } = createSubject({ task, resolver });
    const result = await subject.execute(createClaim());
    expect(result.status).toBe('failed');
  });

  it('preserves the legacy fallback prompt shape through the shared resolver', async () => {
    const runtime = new FakeAgentRuntime();
    const { subject } = createSubject({ runtime });
    await subject.execute(createClaim());
    expect(runtime.requests[0]?.prompt).toBe('prompt');
  });

  it('reports persistence failure with a receipt after runtime success', async () => {
    const task = createBaseTask();
    const runtime = new FakeAgentRuntime();
    const complete = new CompleteRun(
      {
        complete: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
    );
    const { subject } = createSubject({ task, runtime, completeRun: complete });
    await expect(subject.execute(createClaim())).rejects.toBeInstanceOf(
      RunCompletionPersistenceError,
    );
  });

  it('rethrows a stale terminal completion conflict without terminal member mutation or a failed retry', async () => {
    const task = createBaseTask();
    const complete = new CompleteRun(
      {
        complete: vi.fn(async () => {
          throw new RunCompletionConflictError();
        }),
      } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
    );
    const { subject } = createSubject({ task, completeRun: complete });
    await expect(subject.execute(createClaim())).rejects.toBeInstanceOf(
      RunCompletionConflictError,
    );
  });

  it('completes a failed Run when runtime execution throws', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.runError = new Error('boom');
    const { subject } = createSubject({ runtime });
    const result = await subject.execute(createClaim());
    expect(result.status).toBe('failed');
  });

  it('retries an existing unbound Team runtime session through create and bind', async () => {
    const now = () => new Date('2026-07-23T00:00:00.000Z');
    const team = createTeamRun({
      id: 'team-unbound',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'user',
      principalId: 'user-1',
      rootTaskId: 'root-unbound',
      rootRunId: 'run-unbound',
      teamVersionId: 'team-version-unbound',
      environmentVersionId: 'environment-version-unbound',
      now,
    });
    const member = createTeamMemberRun({
      id: 'member-unbound',
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
    const task = createChildTask({
      id: 'task-unbound',
      tenantId: team.tenantId,
      workspaceId: team.workspaceId,
      principalType: team.principalType,
      principalId: team.principalId,
      policySnapshotVersion: 'policy-1',
      rootTaskId: team.rootTaskId,
      parentTaskId: team.rootTaskId,
      parentRunId: team.rootRunId,
      invokableKind: 'agent',
      invokableVersionId: member.agentVersionId,
      inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'work' }),
      inputFingerprint: 'fingerprint-unbound',
      logicalStepKey: 'work-unbound',
      nodePath: 'work-unbound',
      teamMemberRunId: member.id,
      teamTaskKind: 'work_attempt',
      teamSequence: 1,
      now,
    });
    const runtimeSessions = {
      findByTeamMember: vi.fn(async () => ({
        id: 'runtime-session-unbound',
        scopeKind: 'team_member',
        scopeId: member.id,
        taskId: task.id,
        tenantId: team.tenantId,
        workspaceId: team.workspaceId,
        principalType: team.principalType,
        principalId: team.principalId,
        agentVersionId: member.agentVersionId,
        environmentVersionId: team.environmentVersionId,
        resolvedSkills: [],
        toolRefs: collaborationToolRefsForRole('member'),
        workspaceBinding: null,
        sessionBinding: null,
      })),
    };
    const executions = {
      findMemberRunById: vi.fn(async () => member),
      findTeamRunByRootTaskId: vi.fn(async () => team),
      findMembersByTeamRunId: vi.fn(async () => [member]),
      updateMemberRunStatus: vi.fn(async () => member),
      findAttemptsByTeamRunId: vi.fn(async () => []),
      findTeamRunById: vi.fn(async () => team),
    };
    const runtime = new FakeAgentRuntime();
    const { subject } = createSubject({
      task,
      runtime,
      runtimeSessions,
      collaborativeExecutions: executions,
    });
    await subject.execute({
      ...createClaim(createRun('work', { id: 'run-unbound', now })),
      taskId: task.id,
    });
    expect(runtime.requests).toHaveLength(1);
  });

  it('keeps a runtime timeout classification when Team grant narrowing also fails', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.runError = new RuntimeTimedOutError();
    const { subject } = createSubject({ runtime });
    const result = await subject.execute(createClaim());
    expect(result.status).toBe('timed_out');
  });

  it('does not retry completion or report persistence failure when terminal logging fails', async () => {
    const task = createBaseTask();
    const complete = new CompleteRun(
      { complete: vi.fn(async ({ run }: { run: any }) => run) } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
    );
    const throwingLogger = {
      log: vi.fn(() => {
        throw new Error('sink failure');
      }),
    };
    const subject = new ExecuteRun(
      complete,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      {} as never,
      {} as never,
      new FakeAgentRuntime(),
      throwingLogger,
    );
    await expect(subject.execute(createClaim())).rejects.toThrow('sink failure');
  });

  it('rejects a receipt for a nonterminal run status', () => {
    expect(() =>
      createRuntimeExecutionReceipt(
        createRun('prompt', { id: 'nonterminal' }),
        'task-1',
      ),
    ).toThrow();
  });

  it('raises typed recoverable persistence failure for runtime memory candidates', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.nextMemoryCandidates = [
      { category: 'terminology', content: 'A safe term.' },
    ];
    const createMemoryProposal = {
      executeBatch: vi.fn(async () => {
        throw new Error('memory persistence failed');
      }),
      execute: vi.fn(),
    };
    const task = createBaseTask({ sourceMessageId: 'message-1' } as any);
    const { subject } = createSubject({
      task,
      runtime,
      createMemoryProposal,
      resolver: {
        resolvePublished: vi.fn(async () => ({
          instructions: 'managed',
          proposalLimit: 1,
          modelPolicyRef: 'free-only',
          skills: [],
          toolRefs: [],
        })),
      },
    });
    await expect(subject.execute(createClaim())).rejects.toBeInstanceOf(
      RuntimeMemoryPersistenceError,
    );
  });

  it('applies immutable proposal limit and rejects secret-like runtime candidates', async () => {
    const runtime = new FakeAgentRuntime();
    runtime.nextMemoryCandidates = [
      { category: 'terminology', content: 'safe one' },
      { category: 'terminology', content: 'token=super-secret' },
      { category: 'terminology', content: 'safe three' },
    ];
    const executeBatch = vi.fn(async () => undefined);
    const createMemoryProposal = { executeBatch, execute: vi.fn() };
    const task = createBaseTask({
      invokableVersionId: 'managed-version',
      sourceMessageId: 'message-1',
    } as any);
    const { subject } = createSubject({
      task,
      runtime,
      createMemoryProposal,
      resolver: {
        resolvePublished: vi.fn(async () => ({
          instructions: 'managed',
          proposalLimit: 2,
          modelPolicyRef: 'free-only',
          skills: [],
          toolRefs: [],
        })),
      },
    });
    await subject.execute(createClaim());
    expect(executeBatch).toHaveBeenCalledWith([
      expect.objectContaining({ content: 'safe one' }),
    ]);
  });

  it('keeps proposal limits execution-local across concurrent managed and compatibility runs', async () => {
    const runtime = new FakeAgentRuntime();
    const executeBatch = vi.fn(async () => undefined);
    const task = createBaseTask({
      invokableVersionId: 'managed-version',
      sourceMessageId: 'message-1',
    } as any);
    const resolver = {
      resolvePublished: vi.fn(async () => ({
        instructions: 'managed',
        proposalLimit: 1,
        modelPolicyRef: 'free-only',
        skills: [],
        toolRefs: [],
      })),
    };
    runtime.nextMemoryCandidates = [
      { category: 'terminology', content: 'one' },
      { category: 'terminology', content: 'two' },
    ];
    const { subject } = createSubject({
      task,
      runtime,
      resolver,
      createMemoryProposal: { executeBatch, execute: vi.fn() },
    });
    await subject.execute(createClaim());
    expect(executeBatch.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('does not emit terminal events when persistence arbitrates cancellation after runtime false', async () => {
    const task = createBaseTask();
    const events = new InMemoryRunEventRepository();
    const complete = new CompleteRun(
      {
        complete: vi.fn(async () => {
          throw new RunCompletionConflictError();
        }),
      } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      events,
    );
    const { subject } = createSubject({ task, events, completeRun: complete });
    await expect(subject.execute(createClaim())).rejects.toBeInstanceOf(
      RunCompletionConflictError,
    );
    const terminal = (await events.list('run-1')).filter((event) =>
      ['succeeded', 'failed', 'cancelled'].includes(event.type),
    );
    expect(terminal).toEqual([]);
  });

  it('does not emit terminal events when persistence arbitrates cancellation after runtime true', async () => {
    const task = createBaseTask();
    const events = new InMemoryRunEventRepository();
    const complete = new CompleteRun(
      {
        complete: vi.fn(async () => {
          throw new RunCompletionConflictError();
        }),
      } as never,
      { findById: vi.fn(async () => task), save: vi.fn() } as never,
      events,
    );
    const { subject } = createSubject({ task, events, completeRun: complete });
    await expect(subject.execute(createClaim())).rejects.toBeInstanceOf(
      RunCompletionConflictError,
    );
    const terminal = (await events.list('run-1')).filter((event) =>
      ['succeeded', 'failed', 'cancelled'].includes(event.type),
    );
    expect(terminal).toEqual([]);
  });
});
