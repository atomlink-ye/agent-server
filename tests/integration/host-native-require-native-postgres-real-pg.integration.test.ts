import { describe, expect, it } from 'vitest';

import { ensureDevelopmentDatabase } from '../../tooling/dev/host-native.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

describe('ensureDevelopmentDatabase CANARY_REQUIRE_NATIVE_POSTGRES against real Postgres', () => {
  it('resolves with the reachable connection string and does not fall back or throw', async () => {
    const environment = {
      ...process.env,
      CANARY_REQUIRE_NATIVE_POSTGRES: '1',
    };

    const resolved = await ensureDevelopmentDatabase(environment);

    expect(resolved).toBe(process.env.DATABASE_URL);
    expect(() => new URL(resolved)).not.toThrow();
  });
});
