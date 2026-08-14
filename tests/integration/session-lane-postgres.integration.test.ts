import { afterAll } from 'vitest';

import { startDirectRealPostgresIfNeeded } from '../support/environment/direct-real-postgres.js';

const ownedEnvironment = await startDirectRealPostgresIfNeeded(import.meta.url);
await import('./session-lane-postgres.integration.impl.js');

afterAll(async () => {
  await ownedEnvironment?.stop('passed');
});
