import { describe, expect, it } from 'vitest';

import { ensureDevelopmentDatabase } from '../../tooling/dev/host-native.js';

const UNREACHABLE_DATABASE_URL =
  'postgresql://postgres@127.0.0.1:1/agent_server_test_unreachable';

describe('ensureDevelopmentDatabase CANARY_REQUIRE_NATIVE_POSTGRES', () => {
  it('rejects with a CANARY_REQUIRE_NATIVE_POSTGRES-specific message when the default-guess Postgres is unreachable', async () => {
    // No DATABASE_URL/POSTGRES_URL set: ensureDevelopmentDatabase falls
    // back to its default-guess connection string
    // (postgresql://<user>@127.0.0.1:5432/agent_server_dev), which is the
    // exact case this flag is meant to fail closed on instead of silently
    // downgrading to the PGlite dev fallback. Nothing listens on 5432 in
    // this test lane (see .github/workflows/ci.yml `deterministic` job),
    // so this resolves quickly without depending on connectionTimeoutMillis.
    const environment: NodeJS.ProcessEnv = {
      CANARY_REQUIRE_NATIVE_POSTGRES: '1',
    };

    await expect(ensureDevelopmentDatabase(environment)).rejects.toThrow(
      /CANARY_REQUIRE_NATIVE_POSTGRES/u,
    );
  }, 5_000);

  it('stays opt-in: without the flag, an unreachable explicit DATABASE_URL still fails closed via the pre-existing message', async () => {
    const environment: NodeJS.ProcessEnv = {
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
    };

    let caught: unknown;
    try {
      await ensureDevelopmentDatabase(environment);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Postgres is not reachable at/u);
    expect((caught as Error).message).not.toContain(
      'CANARY_REQUIRE_NATIVE_POSTGRES',
    );
  }, 5_000);
});
