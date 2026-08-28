import { describe, expect, it } from 'vitest';

import {
  CreateRunResponseSchema,
  GetRunResponseSchema,
} from '../../src/contracts/runs.js';
import { primaryServiceAccountToken } from '../fixtures/create-test-app.js';
import { withAgentServerHarness } from '../harness/scenario.js';

/**
 * PROVIDER_FIXTURE_ID selects which canonical fixture the replay uses. It exists
 * so the missing-fixture behaviour can be probed through the canonical command
 * without editing source or deleting a committed fixture.
 */
const fixtureId = process.env.PROVIDER_FIXTURE_ID ?? 'baseline-completion';

describe('fixture-backed runtime replay', () => {
  it('admits and completes a run through the composed application', async () => {
    await withAgentServerHarness(
      async (harness) => {
        const response = await harness.app.request('/api/v1/runs', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${primaryServiceAccountToken}`,
            'content-type': 'application/json',
            'idempotency-key': 'fixture-replay-admission',
          },
          body: JSON.stringify({
            prompt: 'Complete the deterministic fixture turn.',
          }),
        });
        expect(response.status).toBe(202);
        const admitted = CreateRunResponseSchema.parse(await response.json());

        const stepped = await harness.dispatcher.step();
        expect(stepped.kind).toBe('processed');

        const terminal = await harness.app.request(admitted.links.self, {
          headers: { authorization: `Bearer ${primaryServiceAccountToken}` },
        });
        const run = GetRunResponseSchema.parse(await terminal.json());
        expect(run.status).toBe('succeeded');
        expect(run.result?.text).toBe('FIXTURE_REPLAY_OK');
        expect(harness.trace.map((entry) => entry.module)).toEqual([
          'createApplication',
          'SubmitRun',
          'ClaimNextRun',
          'ExecuteRun',
          'AgentRunExecutor',
          'ExecuteRuntimeTurn',
          'FixtureRuntimeProvider',
          'ExecutionSession.run',
        ]);
        // The product chain must bind one and the same Run identity end to end.
        // Naming the modules that carry it is stronger than counting them: a
        // count still passes if the wrong module binds the id.
        const runScoped = harness.trace.filter(
          (entry) => entry.runId !== undefined,
        );
        expect(runScoped.map((entry) => entry.module)).toEqual([
          'SubmitRun',
          'ClaimNextRun',
          'ExecuteRun',
          'AgentRunExecutor',
          'ExecuteRuntimeTurn',
        ]);
        expect(new Set(runScoped.map((entry) => entry.runId))).toEqual(
          new Set([admitted.run_id]),
        );
        // The provider boundary never sees a product Run id — it is tied to this
        // journey by trace ordering and by the fixture it replayed.
        expect(
          harness.trace
            .filter((entry) => entry.module === 'ExecutionSession.run')
            .map((entry) => entry.fixtureId),
        ).toEqual([fixtureId]);
        expect(harness.replayReport).toMatchObject({
          mode: 'fixture_replay',
          live_provider: false,
        });
      },
      { fixtureId },
    );
  });
});
