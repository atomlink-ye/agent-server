import { describe, expect, it } from 'vitest';

import {
  evaluateRuntimeGrantDiscoveryPolicy,
  evaluateRuntimeGrantPolicy,
} from './grant-policy.js';
import type { RuntimeGrantRecord } from '../ports/runtime-grant-reader.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';

const now = new Date('2026-08-24T00:05:00.000Z');
const catalogDigest = 'sha256:catalog';

function grant(
  overrides: Partial<RuntimeGrantRecord> = {},
): RuntimeGrantRecord {
  return {
    id: 'grant-1',
    runtimeSessionId: 'session-1',
    generationId: 'generation-1',
    runtimeTurnId: null,
    tokenHash: 'hash-1',
    catalogDigest,
    allowedTools: ['agent-server/list-agent-workflows'],
    expiresAt: '2026-08-24T00:10:00.000Z',
    revokedAt: null,
    ...overrides,
  } as RuntimeGrantRecord;
}

function session(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: 'session-1',
    owner: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      principalType: 'service_account',
      principalId: 'principal-1',
    },
    scope: { kind: 'product_session', id: 'scope-1' },
    desiredSpecRevision: 1,
    currentGenerationId: 'generation-1',
    status: 'ready',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    closedAt: null,
    ...overrides,
  } as RuntimeSession;
}

function generation(
  overrides: Partial<RuntimeSessionGeneration> = {},
): RuntimeSessionGeneration {
  return {
    id: 'generation-1',
    runtimeSessionId: 'session-1',
    generation: 1,
    provider: 'paseo',
    providerWorkspaceId: 'provider-workspace-1',
    providerSessionId: 'provider-session-1',
    appliedSpecRevision: 1,
    appliedBootstrapDigest: 'sha256:bootstrap',
    endpointEpoch: 'epoch-1',
    status: 'provisioning',
    createdAt: '2026-08-24T00:00:00.000Z',
    activeAt: null,
    supersededAt: null,
    closedAt: null,
    ...overrides,
  } as RuntimeSessionGeneration;
}

describe('evaluateRuntimeGrantDiscoveryPolicy', () => {
  it('allows a valid grant while its generation is still provisioning and unbound to any turn', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant(),
        session: session(),
        generation: generation({ status: 'provisioning' }),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'allowed' });
  });

  it('allows a valid grant once its generation is active', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant(),
        session: session(),
        generation: generation({ status: 'active' }),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'allowed' });
  });

  it('ignores turn binding entirely: a grant bound to some other turn is still discovery-authorized', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant({ runtimeTurnId: 'stale-turn' as never }),
        session: session(),
        generation: generation(),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'allowed' });
  });

  it('denies a revoked grant', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant({ revokedAt: '2026-08-24T00:01:00.000Z' }),
        session: session(),
        generation: generation(),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'grant_revoked' });
  });

  it('denies an expired grant', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant({ expiresAt: '2026-08-24T00:00:00.000Z' }),
        session: session(),
        generation: generation(),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'grant_expired' });
  });

  it('denies a session lineage mismatch', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant({ runtimeSessionId: 'session-other' as never }),
        session: session(),
        generation: generation(),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'grant_session_mismatch' });
  });

  it('denies a generation lineage mismatch', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant(),
        session: session(),
        generation: generation({ runtimeSessionId: 'session-other' as never }),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'grant_generation_mismatch' });
  });

  it('denies a generation that is neither provisioning nor active', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant(),
        session: session(),
        generation: generation({ status: 'superseded' }),
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'generation_not_active' });
  });

  it('denies a catalog digest mismatch', () => {
    expect(
      evaluateRuntimeGrantDiscoveryPolicy({
        grant: grant(),
        session: session(),
        generation: generation(),
        currentCatalogDigest: 'sha256:different',
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'catalog_digest_mismatch' });
  });
});

describe('evaluateRuntimeGrantPolicy (unchanged invocation predicate)', () => {
  it('still denies a generation that is only provisioning, not active', () => {
    const turn = {
      id: 'turn-1',
      runtimeSessionId: 'session-1',
      generationId: 'generation-1',
      status: 'running',
    } as const;
    expect(
      evaluateRuntimeGrantPolicy({
        grant: grant({ runtimeTurnId: 'turn-1' as never }),
        session: session(),
        generation: generation({ status: 'provisioning' }),
        turn: turn as never,
        requestedTool: 'agent-server/list-agent-workflows',
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'generation_not_active' });
  });

  /**
   * Security-relevant: with the outer MCP handler gate now authentication-
   * only (it never checks per-tool allowance), this per-tool check is the
   * only thing standing between a bound/active grant and a tool it was
   * never granted. It must keep denying even though everything else about
   * the grant -- session, generation, turn binding, turn activity, catalog
   * digest -- is otherwise valid.
   */
  it('still denies a tool ref that is not in allowedTools, even for an otherwise fully valid, turn-bound, active grant', () => {
    const turn = {
      id: 'turn-1',
      runtimeSessionId: 'session-1',
      generationId: 'generation-1',
      status: 'running',
    } as const;
    expect(
      evaluateRuntimeGrantPolicy({
        grant: grant({ runtimeTurnId: 'turn-1' as never }),
        session: session(),
        generation: generation({ status: 'active' }),
        turn: turn as never,
        requestedTool: 'agent-server/product-work-create',
        currentCatalogDigest: catalogDigest,
        now,
      }),
    ).toEqual({ kind: 'denied', reason: 'tool_not_allowed' });
  });
});
