import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  evaluateCompletionFacts,
  formatSmokeOutcome,
} from '../../scripts/smoke/agent-team-completion-line.mjs';
import { createTeamModule } from '../../src/modules/team/team-module.js';
import { createRootTask, createChildTask } from '../../src/domain/tasks/task.js';
import { createRun } from '../../src/domain/runs/run.js';
import { createTeamRun } from '../../src/domain/teams/team-run.js';
import {
  activateMemberRun,
  createTeamMemberRun,
} from '../../src/domain/teams/team-member-run.js';
import {
  AGENT_SERVER_COLLABORATION_MCP_NAMES,
  AGENT_SERVER_COLLABORATION_TOOL_REFS,
} from '../../src/domain/collaboration/canonical-collaboration-tools.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresRunEventRepository } from '../../src/infrastructure/postgres/postgres-run-event-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { RuntimeMcpServer } from '../../src/infrastructure/extensions/runtime-mcp-server.js';
import { createCollaborationRuntimeContributor } from '../../src/entrypoints/mcp/runtime-tool-contributors.js';
import { RuntimeToolRegistry } from '../../src/platform/runtime-tool-registry.js';
import { createLogger } from '../../src/shared/observability/logger.js';
import { deriveTeamContextEpoch } from '../../src/application/teams/team-tool-context.js';
import { ProjectAgenticTeam } from '../../src/application/teams/project-agentic-team.js';
import { encodeRootTaskRunRequestSnapshotRef } from '../../src/application/tasks/root-task-input.js';

const owner = {
  tenantId: 'smoke_gate_mcp_tenant',
  workspaceId: 'smoke_gate_mcp_workspace',
  principalType: 'service_account',
  principalId: 'smoke_gate_mcp_service',
} as const;

const now = () => new Date('2026-08-16T03:30:00.000Z');
const servers: RuntimeMcpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

async function createMessageWakeFixture(
  options: {
    memberIdle?: boolean;
    allowedTools?: readonly string[];
  } = {},
) {
  const database = new PGlite();
  await applyDurableKernelMigrations(database);
  const tasks = new PostgresTaskRepository(database);
  const runs = new PostgresRunRepository(database);
  const admissions = new PostgresAdmissionRepository(database);
  const events = new PostgresRunEventRepository(database);
  // This is the service's documented debug boundary for retaining a durable
  // wake before a test explicitly resumes reconciliation. The message itself
  // is still created through the public runtime MCP `message_send` tool.
  const team = createTeamModule({
    database: database as unknown as Pool,
    tasks,
    runs,
    admissions,
    events,
    logger: createLogger({
      service: 'smoke-gate-mcp-test',
      minimumLevel: 'error',
      write: () => undefined,
    }),
    deferActivationKick: true,
  });
  const root = createRootTask({
    ...owner,
    policySnapshotVersion: 'smoke-gate-mcp-policy',
    invokableKind: 'team',
    invokableVersionId: randomUUID(),
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({
      prompt: 'smoke gate MCP',
    }),
    inputFingerprint: 'smoke-gate-mcp',
    ingress: 'api',
    originRef: null,
    now,
  });
  const rootRun = createRun('smoke gate MCP', { now });
  await tasks.save(root);
  await runs.save(rootRun, { taskId: root.id, attempt: 1 });
  const claim = (runId: string) =>
    runs.claimQueuedById({
      runId,
      workerId: 'smoke-gate-mcp',
      activationId: randomUUID(),
      claimedAt: now().toISOString(),
      leaseExpiresAt: new Date(now().getTime() + 60_000).toISOString(),
    });
  const rootClaim = await claim(rootRun.id);
  if (!rootClaim) throw new Error('smoke gate MCP root run was not claimable');

  const teamRun = createTeamRun({
    ...owner,
    rootTaskId: root.id,
    rootRunId: rootClaim.run.id,
    teamVersionId: randomUUID(),
    environmentVersionId: randomUUID(),
    initialLeadTurn: true,
    now,
  });
  const lead = activateMemberRun(
    createTeamMemberRun({
      ...owner,
      teamRunId: teamRun.id,
      name: 'lead',
      role: 'lead',
      agentVersionId: randomUUID(),
      now,
    }),
    now,
  );
  const createdMember = createTeamMemberRun({
    ...owner,
    teamRunId: teamRun.id,
    name: 'member',
    role: 'member',
    agentVersionId: randomUUID(),
    now,
  });
  const member = options.memberIdle
    ? { ...createdMember, status: 'idle' as const }
    : createdMember;
  const leadTask = createChildTask({
    ...owner,
    policySnapshotVersion: 'smoke-gate-mcp-policy',
    rootTaskId: root.id,
    parentTaskId: root.id,
    parentRunId: rootClaim.run.id,
    invokableKind: 'agent',
    invokableVersionId: lead.agentVersionId,
    inputSnapshotRef: encodeRootTaskRunRequestSnapshotRef({ prompt: 'lead' }),
    inputFingerprint: 'smoke-gate-lead',
    logicalStepKey: 'lead:turn:1',
    nodePath: 'lead',
    teamMemberRunId: lead.id,
    teamSequence: 1,
    teamTaskKind: 'lead_turn',
    now,
  });
  const leadRun = createRun('lead', { now });
  await team.executions.createTeamRun(teamRun);
  await team.executions.createMemberRun(lead);
  await team.executions.createMemberRun(member);
  await tasks.save(leadTask);
  await runs.save(leadRun, { taskId: leadTask.id, attempt: 1 });
  const leadClaim = await claim(leadRun.id);
  if (!leadClaim) throw new Error('smoke gate MCP lead run was not claimable');

  const server = new RuntimeMcpServer(
    new RuntimeToolRegistry([
      createCollaborationRuntimeContributor({
        contextResolver: team.contextResolver,
        kernel: team.collaboration,
      }),
    ]),
  );
  servers.push(server);
  const grant = server.grants.issue({
    ...owner,
    productSessionId: randomUUID(),
    taskId: leadTask.id,
    runId: leadClaim.run.id,
    teamMemberRunId: lead.id,
    teamRunId: teamRun.id,
    contextEpoch: deriveTeamContextEpoch(leadTask.id, leadClaim.run.id),
    allowedTools: options.allowedTools ?? [AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend],
    catalogTools: options.allowedTools ?? [AGENT_SERVER_COLLABORATION_TOOL_REFS.messageSend],
  });
  const client = new Client({ name: 'smoke-gate-mcp-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(await server.start()), {
      requestInit: { headers: { authorization: `Bearer ${grant.token}` } },
    }) as never,
  );

  return {
    client,
    database,
    root,
    team,
    teamRun,
    tasks,
    runs,
    grant: server.grants.resolve(grant.token)!,
    leadTask,
    leadClaim,
  };
}

describe('canonical smoke direct-message wake mutation', () => {
  it('reports Work that has not been accepted after MCP board creation', async () => {
    const fixture = await createMessageWakeFixture({
      allowedTools: [AGENT_SERVER_COLLABORATION_TOOL_REFS.boardCreate],
    });
    try {
      for (const subject of ['first smoke Work', 'second smoke Work']) {
        const created = await fixture.client.callTool({
          name: AGENT_SERVER_COLLABORATION_MCP_NAMES.boardCreate,
          arguments: { subject },
        });
        expect(created.isError).not.toBe(true);
      }
      const projection = await new ProjectAgenticTeam(
        fixture.team.executions,
        fixture.team.messages,
        new PostgresTaskRepository(fixture.database),
      ).project(fixture.teamRun.id, owner);
      expect(projection?.workItems).toHaveLength(2);
      expect(projection?.workItems.every((work) => work.status !== 'accepted')).toBe(true);
      expect(projection?.workItems.map((work) => work.status)).toEqual(['open', 'open']);

      // A root task with open Work is correctly non-terminal, so the real smoke
      // loop keeps polling rather than emitting a terminal diagnostic. Feed the
      // real MCP-created Work facts into the terminal completion predicate to
      // verify the diagnostic it will emit once a terminal task is evaluated.
      const diagnostic = formatSmokeOutcome({
        kind: 'collaboration_not_achieved',
        taskStatus: 'completed',
        failures: evaluateCompletionFacts({
          project: { status: 'succeeded' },
          gates: {
            finish_ready: true,
            all_work_accepted: true,
            no_active_attempts: true,
            all_members_idle: true,
          },
          work_items: projection?.workItems.map((work) => ({
            work_ref: work.workRef,
            status: work.status,
            assignee_name: work.assigneeName,
            attempts: work.attempts.map((attempt) => ({
              attempt_no: attempt.attemptNo,
              status: attempt.status,
              feedback_summary: attempt.feedbackSummary,
              result_summary: attempt.resultSummary,
            })),
          })),
        }).failures,
      });
      expect(diagnostic).toContain('work_2_accepted');
      expect(diagnostic).toContain('"status":"open"');
    } finally {
      await fixture.client.close();
      await fixture.database.close();
    }
  });

  it('reports a direct message that does not require acknowledgement', async () => {
    const fixture = await createMessageWakeFixture();
    try {
      const sent = await fixture.client.callTool({
        name: AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
        arguments: {
          recipient: 'member',
          body: 'SMOKE_GATE_PENDING_WAKE',
          requires_ack: false,
        },
      });
      expect(sent.isError).not.toBe(true);
      const projection = await new ProjectAgenticTeam(
        fixture.team.executions,
        fixture.team.messages,
        new PostgresTaskRepository(fixture.database),
      ).project(fixture.teamRun.id, owner);
      const message = projection?.directMessages.find(
        (candidate) => candidate.summary === 'SMOKE_GATE_PENDING_WAKE',
      );
      expect(message).toMatchObject({ requiresAck: false, status: 'pending' });

      const diagnostic = formatSmokeOutcome({
        kind: 'collaboration_not_achieved',
        taskStatus: 'completed',
        failures: evaluateCompletionFacts({
          direct_messages: [
            {
              sequence: message?.sequence,
              requires_ack: message?.requiresAck,
              status: message?.status,
            },
          ],
        }).failures,
      });
      expect(diagnostic).toContain('requires_ack_direct_message');
    } finally {
      await fixture.client.close();
      await fixture.database.close();
    }
  });

  it('reports an unacknowledged message after the recipient is materialized', async () => {
    const fixture = await createMessageWakeFixture({ memberIdle: true });
    try {
      const sent = await fixture.client.callTool({
        name: AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
        arguments: {
          recipient: 'member',
          body: 'SMOKE_GATE_UNACKNOWLEDGED',
          requires_ack: true,
        },
      });
      expect(sent.isError).not.toBe(true);
      expect(
        await fixture.team.activationReconciler.reconcileForRootTask(
          fixture.root.id,
          owner,
        ),
      ).toBeGreaterThan(0);

      const projection = await new ProjectAgenticTeam(
        fixture.team.executions,
        fixture.team.messages,
        new PostgresTaskRepository(fixture.database),
      ).project(fixture.teamRun.id, owner);
      const message = projection?.directMessages.find(
        (candidate) => candidate.summary === 'SMOKE_GATE_UNACKNOWLEDGED',
      );
      expect(message).toMatchObject({ requiresAck: true, status: 'presented' });
      expect(
        projection?.sessions.flatMap((session) => session.turns).some((turn) =>
          turn.activation?.causes.some(
            (cause) =>
              cause.type === 'message' &&
              cause.messageRef === `M-${message?.sequence}`,
          ),
        ),
      ).toBe(true);

      const diagnostic = formatSmokeOutcome({
        kind: 'collaboration_not_achieved',
        taskStatus: 'completed',
        failures: evaluateCompletionFacts({
          direct_messages: [
            {
              sequence: message?.sequence,
              requires_ack: message?.requiresAck,
              status: message?.status,
            },
          ],
        }).failures,
      });
      expect(diagnostic).toContain('acknowledged_direct_message');
    } finally {
      await fixture.client.close();
      await fixture.database.close();
    }
  });

  it('creates a durable pending requires-ack message through MCP before wake materialization', async () => {
    const fixture = await createMessageWakeFixture();
    try {
      await fixture.team.contextResolver.resolve(fixture.grant);
      const sent = await fixture.client.callTool({
        name: AGENT_SERVER_COLLABORATION_MCP_NAMES.messageSend,
        arguments: {
          recipient: 'member',
          body: 'SMOKE_GATE_PENDING_WAKE',
          requires_ack: true,
        },
      });
      expect(sent.isError).not.toBe(true);

      const projector = new ProjectAgenticTeam(
        fixture.team.executions,
        fixture.team.messages,
        new PostgresTaskRepository(fixture.database),
      );
      const projection = await projector.project(fixture.teamRun.id, owner);
      const message = projection?.directMessages.find(
        (candidate) => candidate.summary === 'SMOKE_GATE_PENDING_WAKE',
      );

      if (!message)
        throw new Error(
          `MCP message_send did not produce the expected durable projection: ${JSON.stringify({
            sent,
            direct_messages: projection?.directMessages ?? [],
          })}`,
        );

      expect(message).toMatchObject({
        sequence: expect.any(Number),
        requiresAck: true,
        status: 'pending',
      });
      expect(
        projection?.sessions.flatMap((session) => session.turns).some((turn) =>
          turn.activation?.causes.some(
            (cause) =>
              cause.type === 'message' &&
              cause.messageRef === `M-${message?.sequence}`,
          ),
        ),
      ).toBe(false);

      const failures = evaluateCompletionFacts({
        project: { status: 'succeeded' },
        gates: {
          finish_ready: true,
          all_work_accepted: true,
          no_active_attempts: true,
          all_members_idle: true,
        },
        work_items: [
          {
            work_ref: 'work-1',
            status: 'accepted',
            assignee_name: 'builder',
            attempts: [
              {
                attempt_no: 1,
                status: 'completed',
                result_summary: 'AGENT_TEAM_SMOKE_BUILDER_OK',
              },
            ],
          },
          {
            work_ref: 'work-2',
            status: 'accepted',
            assignee_name: 'analyst',
            attempts: [
              {
                attempt_no: 1,
                status: 'completed',
                result_summary: 'AGENT_TEAM_SMOKE_ATTEMPT_1',
              },
              {
                attempt_no: 2,
                status: 'completed',
                feedback_summary: 'AGENT_TEAM_SMOKE_REWORK_REQUIRED',
                result_summary: 'AGENT_TEAM_SMOKE_MEMBER_OK',
              },
            ],
          },
        ],
        direct_messages: [
          {
            sequence: message?.sequence,
            requires_ack: message?.requiresAck,
            status: message?.status,
          },
        ],
        sessions: [
          {
            name: 'analyst',
            role: 'member',
            turns: [
              {
                kind: 'direct_message',
                activation: {
                  materializer: 'task_run_collaboration_activation_adapter',
                  causes: [{ type: 'work_available', work_ref: 'W-2' }],
                },
              },
            ],
          },
          {
            name: 'lead',
            role: 'lead',
            turns: [
              {
                kind: 'lead_turn',
                activation: {
                  materializer: 'task_run_collaboration_activation_adapter',
                  causes: [{ type: 'final_review' }],
                },
              },
            ],
          },
        ],
      });
      const diagnostic = formatSmokeOutcome({
        kind: 'collaboration_not_achieved',
        taskStatus: 'completed',
        failures: failures.failures,
      });
      expect(diagnostic).toContain('pending_message_activation');
    } finally {
      await fixture.client.close();
      await fixture.database.close();
    }
  });
});
