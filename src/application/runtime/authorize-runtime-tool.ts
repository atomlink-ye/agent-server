import type {
  RuntimeGrantReader,
  RuntimeGrantRecord,
} from '../ports/runtime-grant-reader.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import {
  evaluateRuntimeGrantDiscoveryPolicy,
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
  /**
   * Absent for a discovery-grade authorization: the MCP handshake
   * (`initialize`/`tools/list`) happens before the grant is ever bound to a
   * turn, so there is no turn to carry yet. No consumer of this context
   * reads `turn` outside a real tool invocation, where it is always set.
   */
  readonly turn?: RuntimeTurn;
  readonly requestedTool?: string;
  readonly catalogDigest?: string;
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
      context: this.buildContext({
        grant,
        session,
        generation,
        turn,
        requestedTool: input.requestedTool,
        catalogDigest: input.currentCatalogDigest,
      }),
    };
  }

  /**
   * Discovery-grade authorization for the MCP handshake (`initialize`,
   * `tools/list`, `notifications/initialized`, `ping`, `resources/list`,
   * `prompts/list`). The provider performs this handshake once per process,
   * and `execute-runtime-turn.ts` always runs `ensureRuntimeSession` --
   * which triggers the handshake -- strictly before `rotateRuntimeGrant`
   * binds the grant to a turn. Requiring a bound, active turn here (the
   * invocation predicate) therefore always denies the handshake, and the
   * provider then caches an empty tool list for the life of the process.
   *
   * Delegates to `evaluateRuntimeGrantDiscoveryPolicy`, the sibling of the
   * unchanged invocation predicate: it never checks turn binding, turn
   * activity, or per-tool allowance, so it authorizes discovery of the
   * catalog, not invocation of any tool. Every actual `tools/call` still
   * goes through `execute()` and `evaluateRuntimeGrantPolicy`.
   */
  public async executeDiscovery(input: {
    readonly bearerToken: string;
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
    const policy = evaluateRuntimeGrantDiscoveryPolicy({
      grant,
      session,
      generation,
      currentCatalogDigest: input.currentCatalogDigest,
      now: this.now(),
    });
    if (policy.kind === 'denied') return policy;
    return {
      kind: 'authorized',
      context: this.buildContext({
        grant,
        session,
        generation,
        catalogDigest: input.currentCatalogDigest,
      }),
    };
  }

  /** Shared context construction so discovery cannot drift from invocation. */
  private buildContext(input: {
    readonly grant: RuntimeGrantRecord;
    readonly session: RuntimeSession;
    readonly generation: RuntimeSessionGeneration;
    readonly turn?: RuntimeTurn;
    readonly requestedTool?: string;
    readonly catalogDigest?: string;
  }): AuthorizedRuntimeToolContext {
    const { grant, session, generation, turn } = input;
    return Object.freeze({
      grantId: grant.id,
      tenantId: session.owner.tenantId,
      workspaceId: session.owner.workspaceId,
      principalType: session.owner.principalType,
      principalId: session.owner.principalId,
      scopeId: session.scope.id,
      ...(session.scope.kind === 'team_member'
        ? { teamMemberRunId: session.scope.id }
        : {}),
      ...(turn?.source.kind === 'team_member'
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
      ...(turn?.source.kind === 'conversation'
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
      ...(turn ? { turn } : {}),
      ...(input.requestedTool !== undefined
        ? { requestedTool: input.requestedTool }
        : {}),
      ...(input.catalogDigest !== undefined
        ? { catalogDigest: input.catalogDigest }
        : {}),
    });
  }
}
