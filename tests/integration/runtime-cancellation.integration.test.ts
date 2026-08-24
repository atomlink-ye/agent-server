import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { AdmitRootTask } from '../../src/application/tasks/admit-root-task.js';
import { CancelTask } from '../../src/application/tasks/cancel-task.js';
import { CompleteRun } from '../../src/application/runs/complete-run.js';
import { transitionRun } from '../../src/domain/runs/run.js';
import { PostgresAdmissionRepository } from '../../src/infrastructure/postgres/postgres-admission-repository.js';
import { PostgresRunRepository } from '../../src/infrastructure/postgres/postgres-run-repository.js';
import { PostgresTaskRepository } from '../../src/infrastructure/postgres/postgres-task-repository.js';
import { applyDurableKernelMigrations } from '../../src/infrastructure/postgres/postgres.js';
import { PostgresRuntimeGenerationStore } from '../../src/infrastructure/postgres/runtime/postgres-runtime-generation-store.js';
import { PostgresRuntimeSpecStore } from '../../src/infrastructure/postgres/runtime/postgres-runtime-spec-store.js';
import { PostgresRuntimeTurnProvenanceQuery } from '../../src/infrastructure/postgres/runtime/postgres-runtime-turn-provenance-query.js';
import { PostgresRuntimeTurnStore } from '../../src/infrastructure/postgres/runtime/postgres-runtime-turn-store.js';
import { CancelRuntimeRun } from '../../src/application/runtime/cancel-runtime-run.js';
import { CancelRuntimeTurn } from '../../src/application/runtime/cancel-runtime-turn.js';
import { createRuntimeSessionSpec } from '../../src/domain/runtime/runtime-session-spec.js';

const owner = {
  tenantId: 'cancel-runtime-tenant',
  workspaceId: 'cancel-runtime-workspace',
  principalType: 'service_account' as const,
  principalId: 'cancel-runtime-principal',
  policySnapshotVersion: 'cancel-runtime-policy',
};

describe('durable runtime cancellation', () => {
  let database: PGlite | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('cancels the provider turn through its durable generation and is idempotent', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    const tasks = new PostgresTaskRepository(database);
    const runs = new PostgresRunRepository(database);
    const admitted = await new AdmitRootTask(
      tasks,
      runs,
      new PostgresAdmissionRepository(database),
      () => new Date('2026-08-24T00:00:00.000Z'),
    ).execute({
      prompt: 'cancel me',
      idempotencyKey: 'cancel-runtime-1',
      accessContext: owner,
    });
    const claim = await runs.claimQueuedById({
      runId: admitted.runId,
      workerId: 'cancel-runtime-worker',
      activationId: '00000000-0000-4000-8000-000000009901',
      claimedAt: '2026-08-24T00:00:01.000Z',
      leaseExpiresAt: '2026-08-24T00:01:00.000Z',
    });
    expect(claim).not.toBeNull();
    await database.query(`UPDATE tasks SET status='active' WHERE id=$1`, [
      admitted.taskId,
    ]);

    const runtimeSessionId = '00000000-0000-4000-8000-000000009902';
    const generationId = '00000000-0000-4000-8000-000000009903';
    const turnId = '00000000-0000-4000-8000-000000009904';
    await seedRuntime(database, {
      runtimeSessionId,
      generationId,
      turnId,
      runId: admitted.runId,
    });

    const cancelledTurnIds: string[] = [];
    const cancelledProviderSessionIds: string[] = [];
    const cancelRuntimeTurn = new CancelRuntimeTurn(
      new PostgresRuntimeTurnStore(database),
      new PostgresRuntimeGenerationStore(database),
      new PostgresRuntimeSpecStore(database),
      {
        cancelTurn: async (binding, cancelledTurnId) => {
          cancelledTurnIds.push(cancelledTurnId);
          expect(binding.generation.providerSessionId).toBe(
            'provider-session-old',
          );
          cancelledProviderSessionIds.push(
            binding.generation.providerSessionId!,
          );
        },
      },
      { releaseForTurn: async () => undefined },
    );
    const cancel = new CancelTask(
      tasks,
      runs,
      new CancelRuntimeRun(
        new PostgresRuntimeTurnProvenanceQuery(database),
        cancelRuntimeTurn,
      ),
    );

    await expect(cancel.execute(admitted.taskId, owner)).resolves.toMatchObject(
      {
        status: 'cancellation_requested',
      },
    );
    expect(cancelledTurnIds).toEqual([turnId]);
    expect(cancelledProviderSessionIds).toEqual(['provider-session-old']);
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM runtime_turns WHERE id=$1',
          [turnId],
        )
      ).rows[0]?.status,
    ).toBe('cancelled');

    const completed = await new CompleteRun(runs, tasks).execute({
      claim: claim!,
      run: transitionRun(
        claim!.run,
        'succeeded',
        { result: { text: 'late result' } },
        () => new Date('2026-08-24T00:00:02.000Z'),
      ),
    });
    expect(completed.status).toBe('cancelled');
    expect((await tasks.findById(admitted.taskId))?.status).toBe('cancelled');

    await expect(cancel.execute(admitted.taskId, owner)).resolves.toMatchObject(
      {
        status: 'terminal',
      },
    );
    expect(cancelledTurnIds).toEqual([turnId]);
  });

  it('terminalizes queued cancellation without touching the runtime', async () => {
    database = new PGlite();
    await applyDurableKernelMigrations(database);
    const tasks = new PostgresTaskRepository(database);
    const runs = new PostgresRunRepository(database);
    const admitted = await new AdmitRootTask(
      tasks,
      runs,
      new PostgresAdmissionRepository(database),
    ).execute({
      prompt: 'queued cancel',
      idempotencyKey: 'cancel-runtime-queued',
      accessContext: owner,
    });
    let runtimeCalls = 0;
    const cancel = new CancelTask(tasks, runs, {
      cancelRun: async () => {
        runtimeCalls += 1;
      },
    });

    await expect(cancel.execute(admitted.taskId, owner)).resolves.toMatchObject(
      {
        status: 'cancelled',
      },
    );
    expect(runtimeCalls).toBe(0);
    expect((await runs.findById(admitted.runId))?.status).toBe('cancelled');
    expect((await tasks.findById(admitted.taskId))?.status).toBe('cancelled');
  });
});

async function seedRuntime(
  database: PGlite,
  input: {
    readonly runtimeSessionId: string;
    readonly generationId: string;
    readonly turnId: string;
    readonly runId: string;
  },
): Promise<void> {
  const createdAt = '2026-08-24T00:00:00.000Z';
  const spec = createRuntimeSessionSpec({
    runtimeSessionId: input.runtimeSessionId as never,
    revision: 1 as never,
    workspaceId: owner.workspaceId,
    agentVersionId: '00000000-0000-4000-8000-000000009905',
    environmentVersionId: null,
    resolvedSkills: [],
    toolRefs: [],
    provider: 'opencode',
    model: 'free/model',
    cwd: '/tmp/cancel-runtime',
    systemPromptDigest: 'system-prompt-digest',
    skillSetDigest: 'skills-digest',
    toolCatalogDigest: 'tools-digest',
    extensionSetDigest: 'extensions-digest',
    contextEpoch: 0,
    createdAt,
  });
  await database.query(
    `INSERT INTO runtime_sessions
      (id,tenant_id,workspace_id,principal_type,principal_id,scope_kind,
       scope_id,scope_epoch,desired_spec_revision,current_generation_id,status,
       created_at,updated_at,closed_at)
     VALUES($1,$2,$3,$4,$5,'run',$6,NULL,1,NULL,'provisioning',$7,$7,NULL)`,
    [
      input.runtimeSessionId,
      owner.tenantId,
      owner.workspaceId,
      owner.principalType,
      owner.principalId,
      input.runId,
      createdAt,
    ],
  );
  await database.query(
    `INSERT INTO runtime_session_specs
      (runtime_session_id,revision,workspace_id,agent_version_id,
       environment_version_id,resolved_skills,tool_refs,provider,model,cwd,
       system_prompt_digest,skill_set_digest,tool_catalog_digest,
       extension_set_digest,context_epoch,bootstrap_digest,created_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      spec.runtimeSessionId,
      spec.revision,
      spec.workspaceId,
      spec.agentVersionId,
      spec.environmentVersionId,
      JSON.stringify(spec.resolvedSkills),
      JSON.stringify(spec.toolRefs),
      spec.provider,
      spec.model,
      spec.cwd,
      spec.systemPromptDigest,
      spec.skillSetDigest,
      spec.toolCatalogDigest,
      spec.extensionSetDigest,
      spec.contextEpoch,
      spec.bootstrapDigest,
      spec.createdAt,
    ],
  );
  const currentGenerationId = '00000000-0000-4000-8000-000000009906';
  await database.query(
    `INSERT INTO runtime_session_generations
      (id,runtime_session_id,generation,provider,provider_workspace_id,
       provider_session_id,applied_spec_revision,applied_bootstrap_digest,
       endpoint_epoch,status,created_at,active_at,superseded_at,closed_at)
     VALUES($1,$2,1,$3,$4,$5,1,$6,$7,'superseded',$8,$8,$8,NULL)`,
    [
      input.generationId,
      input.runtimeSessionId,
      spec.provider,
      'provider-workspace-old',
      'provider-session-old',
      spec.bootstrapDigest,
      spec.extensionSetDigest,
      createdAt,
    ],
  );
  await database.query(
    `INSERT INTO runtime_session_generations
      (id,runtime_session_id,generation,provider,provider_workspace_id,
       provider_session_id,applied_spec_revision,applied_bootstrap_digest,
       endpoint_epoch,status,created_at,active_at,superseded_at,closed_at)
     VALUES($1,$2,2,$3,$4,$5,1,$6,$7,'active',$8,$8,NULL,NULL)`,
    [
      currentGenerationId,
      input.runtimeSessionId,
      spec.provider,
      'provider-workspace-current',
      'provider-session-current',
      spec.bootstrapDigest,
      spec.extensionSetDigest,
      createdAt,
    ],
  );
  await database.query(
    `UPDATE runtime_sessions
        SET current_generation_id=$2,status='ready',updated_at=$3
      WHERE id=$1`,
    [input.runtimeSessionId, currentGenerationId, createdAt],
  );
  await database.query(
    `INSERT INTO runtime_turns
      (id,runtime_session_id,generation_id,source_kind,source_id,
       source_context,status,prompt_digest,failure_code,created_at,started_at,
       completed_at)
     VALUES($1,$2,$3,'run',$4,'{}'::jsonb,'running',NULL,NULL,$5,$5,NULL)`,
    [
      input.turnId,
      input.runtimeSessionId,
      input.generationId,
      input.runId,
      createdAt,
    ],
  );
}
