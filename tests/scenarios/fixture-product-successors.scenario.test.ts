import { describe, expect, it } from 'vitest';

import {
  CreateRunResponseSchema,
  GetRunResponseSchema,
} from '../../src/contracts/runs.js';
import { InvokeTaskResponseSchema } from '../../src/contracts/tasks.js';
import {
  defaultWorkspaceId,
  primaryServiceAccountToken,
} from '../fixtures/create-test-app.js';
import { loadProviderFixture } from '../fixtures/provider/load-provider-fixture.js';
import { withAgentServerHarness } from '../harness/scenario.js';

const authorization = `Bearer ${primaryServiceAccountToken}`;
const jsonHeaders = {
  authorization,
  'content-type': 'application/json',
} as const;
const fixtureId = 'baseline-completion';
const fixtureText = loadProviderFixture(fixtureId).completion.text;

describe('fixture-backed successors for live runtime lanes', () => {
  it('covers the runtime-browser successor as a fixture-backed runtime journey', async () => {
    await withAgentServerHarness(async (harness) => {
      const admitted = await harness.app.request('/api/v1/runs', {
        method: 'POST',
        headers: {
          ...jsonHeaders,
          'idempotency-key': 'fixture-browser-runtime',
        },
        body: JSON.stringify({
          prompt: 'Reply with the captured fixture result.',
        }),
      });
      expect(admitted.status).toBe(202);
      const created = CreateRunResponseSchema.parse(await admitted.json());
      expect((await harness.dispatcher.step()).kind).toBe('processed');

      const completed = GetRunResponseSchema.parse(
        await (
          await harness.app.request(created.links.self, {
            headers: { authorization },
          })
        ).json(),
      );
      expect(completed.status).toBe('succeeded');
      expect(completed.result?.text).toBe(fixtureText);
      expect(harness.replayReport).toMatchObject({
        mode: 'fixture_replay',
        live_provider: false,
        fixture_id: fixtureId,
      });
    });
  });

  it('covers the team-product successor: registry, Work projection, and a WorkRun executed through the fixture provider', async () => {
    await withAgentServerHarness(async (harness) => {
      const owner = await harness.seed.workspace({
        tenantId: 'tenant_alpha',
        workspaceId: defaultWorkspaceId,
        principalId: 'svc_enabled',
        name: 'Fixture Product Workspace',
      });
      const environment = await harness.seed.environmentVersion(owner);
      const worker = await harness.seed.workerVersion(owner);
      const team = await harness.seed.teamVersion(owner, {
        environmentVersionId: environment.versionId,
        workerVersionId: worker.versionId,
      });
      const definition = await harness.seed.workDefinition(owner, {
        workerVersionId: worker.versionId,
        environmentVersionId: environment.versionId,
        name: 'Fixture Product Work',
      });

      const teamResponse = await harness.app.request(
        `/api/v1/teams/${team.definitionId}`,
        {
          headers: { authorization },
        },
      );
      expect(teamResponse.status).toBe(200);
      expect((await teamResponse.json()).id).toBe(team.definitionId);

      const created = await harness.app.request('/api/v1/works', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          definition_id: definition.definitionId,
          definition_version_id: definition.versionId,
          title: 'Fixture Product Work',
        }),
      });
      expect(created.status).toBe(201);
      const work = (await created.json()).work as { id: string };

      const projection = await harness.app.request(`/api/v1/works/${work.id}`, {
        headers: { authorization },
      });
      expect(projection.status).toBe(200);
      expect((await projection.json()).work).toMatchObject({
        id: work.id,
        definition_id: definition.definitionId,
        definition_version_id: definition.versionId,
        title: 'Fixture Product Work',
      });

      // The paid team-product lane has two halves: registry/projection
      // reachability (above) and a user-defined Team Work execution lifecycle.
      // Creating and reading a Work does not exercise the second half at all,
      // so the rest of this test runs the WorkRun through the dispatcher and
      // the fixture provider.
      const started = await harness.app.request(
        `/api/v1/works/${work.id}/runs`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ trigger_kind: 'manual' }),
        },
      );
      expect(started.status).toBe(202);
      const startedBody = (await started.json()) as {
        work_run: { id: string };
        execution_receipt: { reused: boolean };
      };
      // A fresh admission, not a reused root task: otherwise the step below
      // could pass without this journey having admitted anything.
      expect(startedBody.execution_receipt.reused).toBe(false);
      const workRunId = startedBody.work_run.id;

      expect((await harness.dispatcher.step()).kind).toBe('processed');

      const ran = await harness.app.request(
        `/api/v1/works/${work.id}/runs/${workRunId}`,
        { headers: { authorization } },
      );
      expect(ran.status).toBe(200);
      expect((await ran.json()).work_run).toMatchObject({
        id: workRunId,
        product_state: 'complete',
        problem_kind: null,
      });

      const traced = await harness.app.request(
        `/api/v1/works/${work.id}/runs/${workRunId}/trace`,
        { headers: { authorization } },
      );
      expect(traced.status).toBe(200);
      const runs = (await traced.json()).runs as readonly {
        status: string;
        provider: string | null;
        error_code: string | null;
      }[];
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: 'succeeded',
        error_code: null,
        // The fixture's own normalized provider label reaches the product
        // projection, so this asserts real execution metadata rather than a
        // default. It is deliberately not a real provider name.
        provider: 'normalized-provider',
      });

      // The WorkRun must actually reach the provider seam. Asserting the
      // terminal product state alone would still pass if a future change
      // completed the run without executing it.
      expect(harness.trace.map((entry) => entry.module)).toEqual(
        expect.arrayContaining([
          'ExecuteRuntimeTurn',
          'FixtureRuntimeProvider',
          'ExecutionSession.run',
        ]),
      );
      expect(harness.replayReport).toMatchObject({
        mode: 'fixture_replay',
        live_provider: false,
        fixture_id: fixtureId,
      });

      // The run must leave something a user can open. Before this producer
      // existed every canonical scope stayed empty after a successful run, so
      // the Files surface truthfully showed nothing at all.
      const resultPath = `runs/${workRunId}/result.md`;
      const files = await harness.app.request(
        `/api/v1/context/files?scope=work&work_id=${work.id}`,
        { headers: { authorization } },
      );
      expect(files.status).toBe(200);
      const listing = (await files.json()) as {
        entries: readonly { path: string }[];
      };
      expect(listing.entries.map((entry) => entry.path)).toEqual([resultPath]);

      // ...and it holds this run's actual result, read back through the same
      // route the browser calls. Asserting only that a file exists would pass
      // for an empty placeholder.
      const detail = await harness.app.request(
        `/api/v1/context/file?scope=work&work_id=${work.id}&path=${encodeURIComponent(
          resultPath,
        )}`,
        { headers: { authorization } },
      );
      expect(detail.status).toBe(200);
      expect((await detail.json()).entry).toMatchObject({
        path: resultPath,
        content: fixtureText,
      });
    });
  });

  it('records the strongest honest agent-team fixture successor: the lead run executes and the Team reaches a terminal no-progress state', async () => {
    await withAgentServerHarness(async (harness) => {
      const owner = await harness.seed.workspace({
        tenantId: 'tenant_alpha',
        workspaceId: defaultWorkspaceId,
        principalId: 'svc_enabled',
        name: 'Fixture Agent Team Workspace',
      });
      const environment = await harness.seed.environmentVersion(owner);
      const worker = await harness.seed.workerVersion(owner);
      const team = await harness.seed.teamVersion(owner, {
        environmentVersionId: environment.versionId,
        workerVersionId: worker.versionId,
        name: 'Fixture Agent Team',
      });

      const admitted = InvokeTaskResponseSchema.parse(
        await (
          await harness.app.request('/api/v1/tasks:invoke', {
            method: 'POST',
            headers: {
              ...jsonHeaders,
              'idempotency-key': 'fixture-agent-team',
            },
            body: JSON.stringify({
              invokable: { kind: 'team', version_id: team.versionId },
              input: { text: 'Run the deterministic team fixture.' },
            }),
          })
        ).json(),
      );
      expect((await harness.dispatcher.step()).kind).toBe('processed');
      expect((await harness.dispatcher.step()).kind).toBe('processed');

      const teamRun = await harness.app.request(
        `/api/v1/tasks/${admitted.task_id}/team-run`,
        { headers: { authorization } },
      );
      expect(teamRun.status).toBe(200);
      // The lead run now executes through the fixture provider and the Team
      // stops because that lead made no protocol progress. The earlier
      // expectation here was `lead_run_failed`, which the Team only reported
      // because the seeded Environment was an empty package the runtime
      // rejected before execution — a seed defect, not Team behaviour. This
      // asserts a terminal state the Team actually decided.
      expect(await teamRun.json()).toMatchObject({
        status: 'failed',
        phase: 'done',
        control_state: 'terminal',
        stop_reason: 'lead_no_progress',
        lead_turn_count: 1,
      });
      // ...and the lead genuinely reached the provider seam to get there.
      expect(harness.trace.map((entry) => entry.module)).toEqual(
        expect.arrayContaining([
          'ExecuteRuntimeTurn',
          'FixtureRuntimeProvider',
          'ExecutionSession.run',
        ]),
      );
    });
  });
});
