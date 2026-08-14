import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/runs/execute-run.ts';
let source = await readFile(path, 'utf8');

function replaceExact(before, after, label) {
  if (!source.includes(before)) throw new Error(`codemod anchor missing: ${label}`);
  source = source.replace(before, after);
}

replaceExact(
`import {
  AGENT_SERVER_RUNTIME_MCP_SERVER_NAME,
  type AgentRuntimePort,
  type RuntimeEvent,
  RuntimeTimedOutError,
} from '../ports/agent-runtime.js';`,
`import { RuntimeTimedOutError } from '../ports/agent-runtime.js';
import type { ExecutionObservation } from '../ports/execution-plane.js';
import type {
  ExecutionRuntimeService,
  ExecutionTurnOutcome,
} from '../runtime/execution-plane-runtime-facade.js';`,
'import runtime contract',
);

replaceExact(
`import type {
  RunEventRepository,
  RunEventPayload,
} from '../ports/run-events.js';`,
`import type { RunEventRepository } from '../ports/run-events.js';`,
'run event imports',
);

replaceExact(
`import {
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,
  canonicalTeamMcpName,
  canonicalTeamMcpRefForName,
} from '../agents/built-in-skills.js';`,
`import { AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS } from '../agents/built-in-skills.js';`,
'built-in tool imports',
);

replaceExact(
`import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RuntimeMemoryPersistenceError,
  RunPostPersistenceError,
} from './runtime-execution-receipt.js';`,
`import {
  createRuntimeExecutionReceipt,
  RunCompletionPersistenceError,
  RuntimeMemoryPersistenceError,
  RunPostPersistenceError,
} from './runtime-execution-receipt.js';
import { executionObservationPayload } from './execution-observation-payload.js';`,
'observation projector import',
);

replaceExact(
`    private readonly runtime: AgentRuntimePort,`,
`    private readonly runtime: ExecutionRuntimeService,`,
'constructor runtime type',
);

replaceExact(
`  public async ensureRuntimeReady(): Promise<boolean> {
    try {
      const health = await this.runtime.health();
      if (health.ready) {
        return true;
      }

      await this.runtime.initialize();
      return (await this.runtime.health()).ready;
    } catch (error) {
      this.logger.log('warn', 'run.runtime.unavailable', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    }
  }`,
`  public async ensureRuntimeReady(): Promise<boolean> {
    try {
      return await this.runtime.ensureReady();
    } catch (error) {
      this.logger.log('warn', 'run.runtime.unavailable', {
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    }
  }`,
'ensure ready',
);

const runtimeBlockStart = `    const runtimeEventSink = this.events
      ? {`;
const runtimeBlockEnd = `    const candidateInputs = (`;
const start = source.indexOf(runtimeBlockStart);
const end = source.indexOf(runtimeBlockEnd, start);
if (start < 0 || end < 0) throw new Error('codemod runtime block anchors missing');
const replacement = `    const runtimeObservationSink = this.events
      ? {
          emit: async (observation: ExecutionObservation) => {
            const payload = executionObservationPayload(observation, {
              isTeamMember: member != null,
              runtimeToolRefs,
              catalogTools:
                member?.role === 'lead' ? leadCatalogToolRefs : runtimeToolRefs,
            });
            if (payload) await this.events!.append(claim.run.id, 'output', payload);
          },
        }
      : undefined;
    let execution: ExecutionTurnOutcome | undefined;
    let executionFailed = false;
    let executionError: unknown;
    try {
      execution = await this.runtime.executeTurn(
        {
          runId: claim.run.id,
          prompt: deliveredTurnPrompt,
          ...(sessionRuntime ? { runtimeSessionId: sessionRuntime.id } : {}),
          ...(cellCwd ? { cwd: cellCwd } : {}),
          ...(teamPaseoWorkspaceId
            ? {
                workspaceBinding: {
                  plane: 'paseo',
                  externalWorkspaceId: teamPaseoWorkspaceId,
                },
              }
            : {}),
          ...(priorProviderAgentId && !sessionRuntime
            ? {
                compatibilitySessionBinding: {
                  plane: 'paseo',
                  externalSessionId: priorProviderAgentId,
                },
              }
            : {}),
          ...(!priorProviderAgentId && runtimeModelPolicy
            ? {
                provider: runtimeModelPolicy.provider,
                model: runtimeModelPolicy.model,
              }
            : {}),
          ...(!priorProviderAgentId
            ? {
                systemPrompt,
                ...(collaborativeTeam
                  ? { workspaceTitle: \`Team \${collaborativeTeam.id.slice(0, 8)}\` }
                  : {}),
                ...(member
                  ? {
                      sessionTitle: \`\${member.name} (\${member.role})\`,
                      labels: {
                        team_run_id: member.teamRunId,
                        member_name: member.name,
                        role: member.role,
                      },
                    }
                  : {}),
                ...(extensions ? { extensions } : {}),
              }
            : {}),
          ...(resolved.proposalLimit > 0
            ? { proposalLimit: resolved.proposalLimit }
            : {}),
        },
        runtimeObservationSink,
      );
    } catch (error) {
      executionFailed = true;
      executionError = error;
    }
    let narrowingError: unknown;
    try {
      if (member?.role === 'lead') {
        if (!exactLeadGrantId || !refreshableBinder?.refreshForTeamMember)
          throw new Error('Lead runtime grant could not be narrowed.');
        try {
          const narrowed = refreshableBinder.refreshForTeamMember({
            grantId: exactLeadGrantId,
            teamMemberRunId: member.id,
            scopeId: turnGrantScopeId,
            taskId: task.id,
            runId: claim.run.id,
            allowedTools: [],
            contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
          });
          if (narrowed.allowedTools.length !== 0)
            throw new Error('Lead runtime grant did not narrow to zero.');
        } catch (error) {
          this.revokeGrantSafely(refreshableBinder, exactLeadGrantId);
          throw error;
        }
      } else if (
        member &&
        refreshableBinder?.getTeamMemberGrant &&
        refreshableBinder.refreshForTeamMember
      ) {
        const grant = refreshableBinder.getTeamMemberGrant({
          teamMemberRunId: member.id,
          scopeId: turnGrantScopeId,
        });
        if (grant) {
          try {
            refreshableBinder.refreshForTeamMember({
              grantId: grant.grantId,
              teamMemberRunId: member.id,
              scopeId: turnGrantScopeId,
              taskId: task.id,
              runId: claim.run.id,
              allowedTools: [],
              contextEpoch: deriveTeamContextEpoch(task.id, claim.run.id),
            });
          } catch (error) {
            this.revokeGrantSafely(refreshableBinder, grant.grantId);
            throw error;
          }
        }
      }
    } catch (error) {
      narrowingError = error;
    }
    if (executionFailed) throw executionError;
    if (narrowingError) throw narrowingError;
    if (!execution) throw new Error('Runtime execution returned no result.');
    await this.events?.bind({
      runId: claim.run.id,
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      providerAgentId: execution.sessionBinding.externalSessionId,
      createdAt: claim.run.updatedAt,
    });
`;
source = source.slice(0, start) + replacement + source.slice(end);

const oldProjectionStart = `export function runtimeEventPayload(`;
const oldProjectionEnd = `function sameToolRefs(`;
const projectionStart = source.indexOf(oldProjectionStart);
const projectionEnd = source.indexOf(oldProjectionEnd, projectionStart);
if (projectionStart < 0 || projectionEnd < 0)
  throw new Error('codemod runtime projection anchors missing');
source = source.slice(0, projectionStart) + source.slice(projectionEnd);

const tailStart = source.indexOf(`function safeRuntimeToolNamePayload(`);
if (tailStart >= 0) source = source.slice(0, tailStart).trimEnd() + '\n';

await writeFile(path, source);
