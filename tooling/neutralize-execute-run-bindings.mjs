import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/runs/execute-run.ts';
let source = await readFile(path, 'utf8');

function exact(before, after, label) {
  if (!source.includes(before)) throw new Error(`missing anchor: ${label}`);
  source = source.replace(before, after);
}

exact(
`import type { ExecutionObservation } from '../ports/execution-plane.js';`,
`import type {
  ExecutionObservation,
  ExecutionSessionBinding,
} from '../ports/execution-plane.js';`,
'execution plane import',
);

exact(
`import { executionObservationPayload } from './execution-observation-payload.js';`,
`import { executionObservationPayload } from './execution-observation-payload.js';
import { compatibilityRuntimeSessionPolicy } from '../runtime/runtime-session-policy.js';`,
'session policy import',
);

exact(
`    if (
      member &&
      runtimeSession &&
      (runtimeSession.providerAgentId === null) !==
        (runtimeSession.paseoWorkspaceId === null)
    )
      throw new Error('Runtime session provider binding is partial.');
    const legacyProviderAgentId =
      task.sessionId &&
      productSession &&
      productSession.environmentVersionId == null &&
      !runtimeSession &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null;`,
`    if (
      runtimeSession &&
      (runtimeSession.sessionBinding === null) !==
        (runtimeSession.workspaceBinding === null)
    )
      throw new Error('Runtime session execution binding is partial.');
    const legacyExternalSessionId =
      task.sessionId &&
      productSession &&
      productSession.environmentVersionId == null &&
      !runtimeSession &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null;
    const legacySessionBinding: ExecutionSessionBinding | null =
      legacyExternalSessionId
        ? { plane: 'paseo', externalSessionId: legacyExternalSessionId }
        : null;`,
'partial and legacy binding',
);

exact(
`    const priorProviderAgentId = member
      ? (runtimeSession?.providerAgentId ?? null)
      : (runtimeSession?.providerAgentId ??
        legacyProviderAgentId ??
        (!this.runtimeSessions &&
        task.sessionId &&
        this.events?.findLatestProviderAgentBySessionId
          ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
          : null));
    if (priorProviderAgentId && member?.role === 'lead' && collaborativeTeam) {`,
`    const fallbackLegacyExternalSessionId =
      !this.runtimeSessions &&
      task.sessionId &&
      this.events?.findLatestProviderAgentBySessionId
        ? await this.events.findLatestProviderAgentBySessionId(task.sessionId)
        : null;
    const priorSessionBinding: ExecutionSessionBinding | null = member
      ? (runtimeSession?.sessionBinding ?? null)
      : (runtimeSession?.sessionBinding ??
        legacySessionBinding ??
        (fallbackLegacyExternalSessionId
          ? {
              plane: 'paseo',
              externalSessionId: fallbackLegacyExternalSessionId,
            }
          : null));
    const sessionPolicy = compatibilityRuntimeSessionPolicy(
      task.sessionId ? 'product_session' : member ? 'team_member' : 'task',
    );
    if (priorSessionBinding && member?.role === 'lead' && collaborativeTeam) {`,
'prior binding',
);

source = source.replaceAll('priorProviderAgentId', 'priorSessionBinding');

exact(
`    if (
      !priorSessionBinding &&
      member &&
      collaborativeTeam &&
      this.runtimeSessions?.createOrGetForTeamMember
    ) {`,
`    if (
      sessionPolicy === 'sticky' &&
      !priorSessionBinding &&
      member &&
      collaborativeTeam &&
      this.runtimeSessions?.createOrGetForTeamMember
    ) {`,
'member policy',
);

exact(
`    } else if (
      !priorSessionBinding &&
      productSession?.environmentVersionId &&
      this.runtimeSessions
    ) {`,
`    } else if (
      sessionPolicy === 'sticky' &&
      !priorSessionBinding &&
      productSession?.environmentVersionId &&
      this.runtimeSessions
    ) {`,
'product policy',
);

const teamWorkspaceStart = source.indexOf(
`    let teamPaseoWorkspaceId: string | null = null;`,
);
const teamWorkspaceEnd = source.indexOf(
`    const runtimeObservationSink = this.events`,
  teamWorkspaceStart,
);
if (teamWorkspaceStart < 0 || teamWorkspaceEnd < 0)
  throw new Error('missing team workspace block');
source =
  source.slice(0, teamWorkspaceStart) +
  source.slice(teamWorkspaceEnd);

exact(
`          ...(teamPaseoWorkspaceId
            ? {
                workspaceBinding: {
                  plane: 'paseo',
                  externalWorkspaceId: teamPaseoWorkspaceId,
                },
              }
            : {}),
          ...(priorSessionBinding && !sessionRuntime
            ? {
                compatibilitySessionBinding: {
                  plane: 'paseo',
                  externalSessionId: priorSessionBinding,
                },
              }
            : {}),`,
`          ...(collaborativeTeam
            ? {
                workspaceOwner: {
                  kind: 'team_run',
                  id: collaborativeTeam.id,
                  tenantId: task.tenantId,
                  productWorkspaceId: task.workspaceId,
                  principalType: task.principalType,
                  principalId: task.principalId,
                },
                ...(member?.role === 'member' && !priorSessionBinding
                  ? { requireExistingWorkspaceBinding: true }
                  : {}),
              }
            : task.sessionId
              ? {
                  workspaceOwner: {
                    kind: 'product_session',
                    id: task.sessionId,
                    tenantId: task.tenantId,
                    productWorkspaceId: task.workspaceId,
                    principalType: task.principalType,
                    principalId: task.principalId,
                  },
                }
              : {}),
          ...(priorSessionBinding && !sessionRuntime
            ? { compatibilitySessionBinding: priorSessionBinding }
            : {}),`,
'execution workspace request',
);

await writeFile(path, source);
