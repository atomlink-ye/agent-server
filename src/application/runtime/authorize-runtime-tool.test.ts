import { describe, expect, it } from 'vitest';

import { AuthorizeRuntimeTool } from './authorize-runtime-tool.js';
import type {
  RuntimeGrantReader,
  RuntimeGrantRecord,
} from '../ports/runtime-grant-reader.js';
import type { RuntimeSessionStore } from '../ports/runtime-session-store.js';
import type { RuntimeGenerationStore } from '../ports/runtime-generation-store.js';
import type { RuntimeTurnStore } from '../ports/runtime-turn-store.js';
import type { RuntimeSession } from '../../domain/runtime/runtime-session.js';
import type { RuntimeSessionGeneration } from '../../domain/runtime/runtime-session-generation.js';

const now = new Date('2026-08-24T00:05:00.000Z');
const catalogDigest = 'sha256:catalog';
const bearerToken = 'bearer-token';
const hashBearer = (token: string) => `hashed:${token}`;
const notUsedInThisTest = async () => {
  throw new Error('not used in this test');
};

function grant(
  overrides: Partial<RuntimeGrantRecord> = {},
): RuntimeGrantRecord {
  return {
    id: 'grant-1',
    runtimeSessionId: 'session-1',
    generationId: 'generation-1',
    runtimeTurnId: null,
    tokenHash: hashBearer(bearerToken),
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

function grantReaderWith(
  record: RuntimeGrantRecord | null,
): RuntimeGrantReader {
  return {
    findByTokenHash: async () => record,
    findById: async () => record,
  };
}

function sessionStoreWith(value: RuntimeSession | null): RuntimeSessionStore {
  return {
    findById: async () => value,
    findByScope: notUsedInThisTest,
    createWithInitialSpec: notUsedInThisTest,
    bindCurrentGeneration: notUsedInThisTest,
    markStatus: notUsedInThisTest,
    close: notUsedInThisTest,
  };
}

function generationStoreWith(
  value: RuntimeSessionGeneration | null,
): RuntimeGenerationStore {
  return {
    findById: async () => value,
    findCurrent: notUsedInThisTest,
    insert: notUsedInThisTest,
    updateAppliedSpec: notUsedInThisTest,
    supersede: notUsedInThisTest,
    failProvisioning: notUsedInThisTest,
    close: notUsedInThisTest,
  };
}

/**
 * The discovery predicate never touches the turn store at all, and the
 * invocation predicate only touches it once a grant is already turn-bound.
 * Every scenario below deliberately never reaches that point, so a store
 * that fails loudly if called is the correct fixture, not a shortcut.
 */
function turnStoreNeverCalled(): RuntimeTurnStore {
  return {
    createPending: notUsedInThisTest,
    findById: notUsedInThisTest,
    bindGenerationAndPrepare: notUsedInThisTest,
    start: notUsedInThisTest,
    succeed: notUsedInThisTest,
    fail: notUsedInThisTest,
    cancelBeforeRun: notUsedInThisTest,
    cancelRunning: notUsedInThisTest,
  };
}

const runningTurn = {
  id: 'turn-1',
  runtimeSessionId: 'session-1',
  source: { kind: 'run', runId: 'run-1' },
  generationId: 'generation-1',
  status: 'running',
  promptDigest: null,
  failureCode: null,
  createdAt: '2026-08-24T00:00:00.000Z',
  startedAt: '2026-08-24T00:00:00.000Z',
  completedAt: null,
} as const;

function turnStoreWith(value: typeof runningTurn | null): RuntimeTurnStore {
  return {
    createPending: notUsedInThisTest,
    findById: async () => value as never,
    bindGenerationAndPrepare: notUsedInThisTest,
    start: notUsedInThisTest,
    succeed: notUsedInThisTest,
    fail: notUsedInThisTest,
    cancelBeforeRun: notUsedInThisTest,
    cancelRunning: notUsedInThisTest,
  };
}

function authorizer(input: {
  readonly grants: RuntimeGrantReader;
  readonly sessions?: RuntimeSessionStore;
  readonly generations?: RuntimeGenerationStore;
  readonly turns?: RuntimeTurnStore;
}): AuthorizeRuntimeTool {
  return new AuthorizeRuntimeTool(
    input.grants,
    input.sessions ?? sessionStoreWith(session()),
    input.generations ?? generationStoreWith(generation()),
    input.turns ?? turnStoreNeverCalled(),
    hashBearer,
    () => now,
  );
}

describe('AuthorizeRuntimeTool.executeDiscovery', () => {
  it('allows an unbound-but-valid grant and carries the tenant/workspace/scope/catalog the MCP handshake needs', async () => {
    const authorize = authorizer({ grants: grantReaderWith(grant()) });

    const result = await authorize.executeDiscovery({
      bearerToken,
      currentCatalogDigest: catalogDigest,
    });

    expect(result.kind).toBe('authorized');
    if (result.kind !== 'authorized') return;
    expect(result.context).toEqual(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        principalType: 'service_account',
        principalId: 'principal-1',
        scopeId: 'scope-1',
        catalogTools: ['agent-server/list-agent-workflows'],
        allowedTools: ['agent-server/list-agent-workflows'],
      }),
    );
    // No turn exists yet at handshake time -- the whole point of this fix.
    expect(result.context.turn).toBeUndefined();
  });

  it('allows an unbound grant whose generation is still provisioning (the handshake happens before activateReplacement)', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(grant()),
      generations: generationStoreWith(generation({ status: 'provisioning' })),
    });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toMatchObject({ kind: 'authorized' });
  });

  it('denies an unrecognized bearer', async () => {
    const authorize = authorizer({ grants: grantReaderWith(null) });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_revoked' });
  });

  it('denies a revoked grant', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(grant({ revokedAt: '2026-08-24T00:01:00.000Z' })),
    });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_revoked' });
  });

  it('denies an expired grant', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(grant({ expiresAt: '2026-08-24T00:00:00.000Z' })),
    });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_expired' });
  });

  it('denies a grant whose session does not resolve', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(grant()),
      sessions: sessionStoreWith(null),
    });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_session_mismatch' });
  });

  it('denies a grant whose generation does not resolve', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(grant()),
      generations: generationStoreWith(null),
    });

    await expect(
      authorize.executeDiscovery({
        bearerToken,
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_generation_mismatch' });
  });
});

describe('AuthorizeRuntimeTool.execute (invocation predicate, unchanged by discovery)', () => {
  it('still denies an otherwise-valid but unbound grant -- discovery must not widen invocation authority', async () => {
    const authorize = authorizer({ grants: grantReaderWith(grant()) });

    await expect(
      authorize.execute({
        bearerToken,
        requestedTool: 'agent-server/list-agent-workflows',
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'grant_turn_mismatch' });
  });

  /**
   * Security-relevant: the MCP handler's outer gate is authentication-only
   * (see runtime-mcp-http-handler.ts) and never checks per-tool allowance.
   * Every real `tools/call` re-authorizes here with the tool's own REF, so
   * this is the only place a tool absent from `allowedTools` is actually
   * rejected. It must keep denying even for a grant that is otherwise fully
   * valid, turn-bound, and active.
   */
  it('still denies a tool ref that is not in allowedTools, for an otherwise fully valid, turn-bound, active grant', async () => {
    const authorize = authorizer({
      grants: grantReaderWith(
        grant({
          runtimeTurnId: 'turn-1' as never,
          allowedTools: ['agent-server/list-agent-workflows'],
        }),
      ),
      generations: generationStoreWith(generation({ status: 'active' })),
      turns: turnStoreWith(runningTurn),
    });

    await expect(
      authorize.execute({
        bearerToken,
        requestedTool: 'agent-server/product-work-create',
        currentCatalogDigest: catalogDigest,
      }),
    ).resolves.toEqual({ kind: 'denied', reason: 'tool_not_allowed' });
  });
});
