import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { RuntimeTurn } from '../../domain/runtime/runtime-turn.js';
import type { RuntimeGrantRecord } from '../ports/runtime-grant-reader.js';

export type RuntimeGrantDenialReason =
  | 'grant_revoked'
  | 'grant_expired'
  | 'grant_session_mismatch'
  | 'grant_generation_mismatch'
  | 'generation_not_active'
  | 'grant_turn_mismatch'
  | 'turn_not_active'
  | 'catalog_digest_mismatch'
  | 'tool_not_allowed';

export type RuntimeGrantPolicyResult =
  | Readonly<{ readonly kind: 'allowed' }>
  | Readonly<{
      readonly kind: 'denied';
      readonly reason: RuntimeGrantDenialReason;
    }>;

export function evaluateRuntimeGrantPolicy(input: {
  readonly grant: RuntimeGrantRecord;
  readonly session: RuntimeSession;
  readonly generation: RuntimeSessionGeneration;
  readonly turn: RuntimeTurn | null;
  readonly requestedTool: string;
  readonly currentCatalogDigest: string;
  readonly now: Date;
}): RuntimeGrantPolicyResult {
  const { grant, session, generation, turn } = input;
  if (grant.revokedAt !== null) return denied('grant_revoked');
  if (Date.parse(grant.expiresAt) <= input.now.getTime())
    return denied('grant_expired');
  if (grant.runtimeSessionId !== session.id)
    return denied('grant_session_mismatch');
  if (
    generation.runtimeSessionId !== session.id ||
    grant.generationId !== generation.id
  )
    return denied('grant_generation_mismatch');
  if (generation.status !== 'active') return denied('generation_not_active');
  if (grant.runtimeTurnId !== null && grant.runtimeTurnId !== turn?.id)
    return denied('grant_turn_mismatch');
  if (
    !turn ||
    turn.runtimeSessionId !== session.id ||
    turn.generationId !== generation.id
  )
    return denied('grant_turn_mismatch');
  if (!['preparing', 'running'].includes(turn.status))
    return denied('turn_not_active');
  if (grant.catalogDigest !== input.currentCatalogDigest)
    return denied('catalog_digest_mismatch');
  if (!grant.allowedTools.includes(input.requestedTool))
    return denied('tool_not_allowed');
  return { kind: 'allowed' };
}

/**
 * The MCP handshake (`initialize`/`tools/list`) always precedes turn binding
 * -- `ensure-runtime-session.ts` provisions the provider session (and with
 * it, the handshake) strictly before `execute-runtime-turn.ts` rotates the
 * grant onto a turn. At handshake time the generation itself may still be
 * `provisioning` (the provider receives its MCP URL + bearer inside
 * `provider.create`, which runs before `activateReplacement`), so this
 * predicate accepts `provisioning` as well as `active`. It deliberately
 * never inspects `runtimeTurnId`, turn status, or per-tool allowance: it
 * proves the grant is a live, correctly-scoped credential for the current
 * catalog shape, not that any particular tool call is authorized.
 */
export function evaluateRuntimeGrantDiscoveryPolicy(input: {
  readonly grant: RuntimeGrantRecord;
  readonly session: RuntimeSession;
  readonly generation: RuntimeSessionGeneration;
  readonly currentCatalogDigest: string;
  readonly now: Date;
}): RuntimeGrantPolicyResult {
  const { grant, session, generation } = input;
  if (grant.revokedAt !== null) return denied('grant_revoked');
  if (Date.parse(grant.expiresAt) <= input.now.getTime())
    return denied('grant_expired');
  if (grant.runtimeSessionId !== session.id)
    return denied('grant_session_mismatch');
  if (
    generation.runtimeSessionId !== session.id ||
    grant.generationId !== generation.id
  )
    return denied('grant_generation_mismatch');
  if (!['provisioning', 'active'].includes(generation.status))
    return denied('generation_not_active');
  if (grant.catalogDigest !== input.currentCatalogDigest)
    return denied('catalog_digest_mismatch');
  return { kind: 'allowed' };
}

function denied(reason: RuntimeGrantDenialReason): RuntimeGrantPolicyResult {
  return { kind: 'denied', reason };
}
