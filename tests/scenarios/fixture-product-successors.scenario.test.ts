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

  it('covers team registry and Product Work creation/projection through the composed application', async () => {
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
    });
  });

  it('records the strongest honest agent-team fixture successor: team admission reaches a terminal failed state', async () => {
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
      expect(await teamRun.json()).toMatchObject({
        status: 'failed',
        stop_reason: 'lead_run_failed',
      });
    });
  });
});
