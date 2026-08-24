import type { RuntimeGrantReader } from '../ports/runtime-grant-reader.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import {
  evaluateRuntimeGrantPolicy,
  type RuntimeGrantDenialReason,
} from './grant-policy.js';
import type { RuntimeTurn } from '../../domain/runtime/runtime-turn.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import { createHash } from 'node:crypto';

export type AuthorizedRuntimeToolContext = Readonly<{
  readonly grantId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly scopeId: string;
  readonly teamMemberRunId?: string;
  readonly activeTurn?: Readonly<{
    readonly taskId: string;
    readonly runId: string;
    readonly contextEpoch: string;
  }>;
  readonly chatContext?: Readonly<{
    readonly conversationId: string;
    readonly triggerMessageId: string;
  }>;
  readonly allowedTools: readonly string[];
  readonly catalogTools: readonly string[];
  readonly runtimeSession: RuntimeSession;
  readonly generation: RuntimeSessionGeneration;
  readonly turn: RuntimeTurn;
  readonly requestedTool: string;
  readonly catalogDigest: string;
}>;

export type AuthorizeRuntimeToolResult =
  | Readonly<{
      readonly kind: 'authorized';
      readonly context: AuthorizedRuntimeToolContext;
    }>
  | Readonly<{
      readonly kind: 'denied';
      readonly reason: RuntimeGrantDenialReason;
    }>;

/** Reads and policy-checks one bearer without retaining authorization state. */
export class AuthorizeRuntimeTool {
  public constructor(
    private readonly grants: RuntimeGrantReader,
    private readonly sessions: RuntimeSessionStore,
    private readonly generations: RuntimeGenerationStore,
    private readonly turns: RuntimeTurnStore,
    private readonly hashBearer: (token: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async execute(input: {
    readonly bearerToken: string;
    readonly requestedTool: string;
    readonly currentCatalogDigest: string;
  }): Promise<AuthorizeRuntimeToolResult> {
    const grant = await this.grants.findByTokenHash(
      this.hashBearer(input.bearerToken),
    );
    if (!grant) return { kind: 'denied', reason: 'grant_revoked' };
    const session = await this.sessions.findById(grant.runtimeSessionId);
    if (!session) return { kind: 'denied', reason: 'grant_session_mismatch' };
    const generation = await this.generations.findById(grant.generationId);
    if (!generation)
      return { kind: 'denied', reason: 'grant_generation_mismatch' };
    if (!grant.runtimeTurnId)
      return { kind: 'denied', reason: 'grant_turn_mismatch' };
    const turn = await this.turns.findById(grant.runtimeTurnId);
    if (!turn) return { kind: 'denied', reason: 'grant_turn_mismatch' };
    const policy = evaluateRuntimeGrantPolicy({
      grant,
      session,
      generation,
      turn,
      requestedTool: input.requestedTool,
      currentCatalogDigest: input.currentCatalogDigest,
      now: this.now(),
    });
    if (policy.kind === 'denied') return policy;
    return {
      kind: 'authorized',
      context: Object.freeze({
        grantId: grant.id,
        tenantId: session.owner.tenantId,
        workspaceId: session.owner.workspaceId,
        principalType: session.owner.principalType,
        principalId: session.owner.principalId,
        scopeId: session.scope.id,
        ...(session.scope.kind === 'team_member'
          ? { teamMemberRunId: session.scope.id }
          : {}),
        ...(turn.source.kind === 'team_member'
          ? {
              activeTurn: {
                taskId: turn.source.taskId,
                runId: turn.source.runId,
                contextEpoch: createHash('sha256')
                  .update(`${turn.source.taskId}:${turn.source.runId}`)
                  .digest('hex')
                  .slice(0, 24),
              },
            }
          : {}),
        ...(turn.source.kind === 'conversation'
          ? {
              chatContext: {
                conversationId: turn.source.conversationId,
                triggerMessageId: turn.source.triggerMessageId,
              },
            }
          : {}),
        allowedTools: grant.allowedTools,
        catalogTools: grant.allowedTools,
        runtimeSession: session,
        generation,
        turn,
        requestedTool: input.requestedTool,
        catalogDigest: input.currentCatalogDigest,
      }),
    };
  }
}
