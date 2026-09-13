import { PostgresRuntimeSessionStore } from './runtime/postgres-runtime-session-store.js';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPgliteTestDatabase } from '../../../tests/harness/database.js';
import { seedWorkspace } from '../../../tests/harness/seed/workspace.js';
import { PostgresWorkChatRepository } from './postgres-work-chat-repository.js';
import { WorkChatService } from '../../application/work-chat/work-chat-service.js';

it('pages backward beyond the latest 200 messages without gaps or duplicates', async () => {
  const { db, dispose } = await createPgliteTestDatabase();
  try {
    const owner = await seedWorkspace(db);
    const workId = randomUUID();
    const now = '2026-09-10T00:00:00.000Z';
    await db.query(
      `INSERT INTO works (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$4,'Long chat',$5,$5)`,
      [workId, owner.tenantId, owner.workspaceId, randomUUID(), now],
    );
    await db.query(
      `INSERT INTO work_chat_messages
        (id,tenant_id,workspace_id,work_id,sequence,kind,body,status,created_at,updated_at)
       SELECT (lpad(to_hex(i),32,'0'))::uuid,$1,$2,$3,i,'system','message '||i,'replied',$4,$4
         FROM generate_series(1,205) AS i`,
      [owner.tenantId, owner.workspaceId, workId, now],
    );
    const repository = new PostgresWorkChatRepository({
      query: async <R extends Record<string, unknown>>(
        sql: string,
        values?: readonly unknown[],
      ) => db.query<R>(sql, values ? [...values] : undefined),
    });
    const service = new WorkChatService(repository);
    const latest = await service.listPage({ owner, workId, limit: 200 });
    expect(latest.messages).toHaveLength(200);
    expect(latest.messages[0]?.sequence).toBe(6);
    expect(latest.messages.at(-1)?.sequence).toBe(205);
    expect(latest.nextBeforeSequence).toBe(6);

    const older = await service.listPage({
      owner,
      workId,
      limit: 200,
      beforeSequence: latest.nextBeforeSequence!,
    });
    expect(older.messages.map((message) => message.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(older.nextBeforeSequence).toBeNull();
  } finally {
    await dispose();
  }
}, 60_000);

it('isolates preparation, two Runs, replies and retries under the real schema', async () => {
  const { db, dispose } = await createPgliteTestDatabase();
  try {
    const owner = await seedWorkspace(db);
    const workId = randomUUID();
    const runs = [randomUUID(), randomUUID()];
    const now = '2026-09-10T00:00:00.000Z';
    await db.query(
      `INSERT INTO works (id,tenant_id,workspace_id,definition_id,current_definition_version_id,title,created_at,updated_at) VALUES ($1,$2,$3,$4,$4,'Chat',$5,$5)`,
      [workId, owner.tenantId, owner.workspaceId, randomUUID(), now],
    );
    const query = async <R extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ) => db.query<R>(sql, values ? [...values] : undefined);
    const repository = new PostgresWorkChatRepository({
      query,
      async connect() {
        return { query, release() {} };
      },
    });
    const service = new WorkChatService(repository);
    for (const [index, workRunId] of [undefined, ...runs].entries()) {
      if (index === 1) {
        for (const run of runs)
          await db.query(
            `INSERT INTO work_runs (id,tenant_id,workspace_id,work_id,definition_version_id,trigger_kind,trigger_ref,idempotency_key,expires_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'manual',$7,$7,$6,$6,$6)`,
            [
              run,
              owner.tenantId,
              owner.workspaceId,
              workId,
              randomUUID(),
              now,
              run,
            ],
          );
      }
      const input = {
        owner,
        workId,
        workRunId,
        body: `bucket ${index}`,
        clientRequestId: `key-${index}`,
        now,
      };
      const posted = await service.post(input);
      expect(posted.message.workRunId).toBe(workRunId ?? null);
      expect((await service.post(input)).replayed).toBe(true);
      const claim = await repository.claimNext({
        workerId: 'test',
        leaseMs: 60000,
        now,
      });
      expect(claim?.workRunId).toBe(workRunId ?? null);
      await repository.complete({
        id: claim!.id,
        workerId: 'test',
        leaseFence: claim!.leaseFence,
        updatedAt: now,
        reply: {
          id: randomUUID(),
          body: `reply ${index}`,
          sourceRuntimeTurnId: null,
          createdAt: now,
        },
      });
      const messages = await service.list({ owner, workId, workRunId });
      expect(messages.map((m) => m.body)).toEqual([
        `bucket ${index}`,
        `reply ${index}`,
      ]);
      expect(messages.every((m) => m.workRunId === (workRunId ?? null))).toBe(
        true,
      );
    }
    const failed = await service.post({
      owner,
      workId,
      workRunId: runs[0],
      body: 'retry',
      clientRequestId: 'retry',
      now,
    });
    const claim = await repository.claimNext({
      workerId: 'test',
      leaseMs: 60000,
      now,
    });
    await repository.fail({
      id: failed.message.id,
      workerId: 'test',
      leaseFence: claim!.leaseFence,
      failureCode: 'test',
      updatedAt: now,
    });
    expect(
      await service.retry({
        owner,
        workId,
        messageId: failed.message.id,
        workRunId: runs[1],
        now,
      }),
    ).toBe(false);
    expect(
      await service.retry({ owner, workId, messageId: failed.message.id, now }),
    ).toBe(false);
    expect(
      await service.retry({
        owner,
        workId,
        messageId: failed.message.id,
        workRunId: runs[0],
        now,
      }),
    ).toMatchObject({ status: 'queued' });
    await expect(
      service.post({
        owner,
        workId,
        workRunId: runs[1],
        body: 'bucket 1',
        clientRequestId: 'key-1',
        now,
      }),
    ).rejects.toMatchObject({ name: 'WorkChatRequestConflictError' });
    await expect(
      service.post({
        owner,
        workId,
        workRunId: runs[0],
        body: 'changed',
        clientRequestId: 'key-1',
        now,
      }),
    ).rejects.toMatchObject({ name: 'WorkChatRequestConflictError' });
    expect(
      await service.list({
        owner: { ...owner, tenantId: 'foreign' },
        workId,
        workRunId: runs[0],
      }),
    ).toEqual([]);
    await expect(
      service.post({
        owner,
        workId,
        workRunId: randomUUID(),
        body: 'missing Run',
        clientRequestId: 'missing',
        now,
      }),
    ).rejects.toThrow();
    const revoke = async () => {
      throw new Error('read-only test');
    };
    const sessions = new PostgresRuntimeSessionStore(
      { query },
      {
        revokeForSession: revoke,
        revokeForTurn: revoke,
        revokeForGeneration: revoke,
      },
    );
    const sessionIds: string[] = [];
    for (const scope of [
      { kind: 'work_chat' as const, id: workId },
      ...runs.map((id) => ({ kind: 'work_run_chat' as const, id })),
    ]) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO runtime_sessions (id,tenant_id,workspace_id,principal_type,principal_id,scope_kind,scope_id,desired_spec_revision,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,'ready',$8,$8)`,
        [
          id,
          owner.tenantId,
          owner.workspaceId,
          owner.principalType,
          owner.principalId,
          scope.kind,
          scope.id,
          now,
        ],
      );
      const session = await sessions.findByScope(owner, scope);
      expect(session).toMatchObject({ id, scope });
      sessionIds.push(session!.id);
    }
    expect(new Set(sessionIds).size).toBe(3);
    await expect(
      service.post({
        owner,
        workId,
        body: 'later preparation',
        clientRequestId: 'late-preparation',
        now,
      }),
    ).rejects.toMatchObject({ name: 'WorkChatRunRequiredError' });
    expect(
      (
        await service.post({
          owner,
          workId,
          body: 'bucket 0',
          clientRequestId: 'key-0',
          now,
        })
      ).replayed,
    ).toBe(true);
    expect((await service.list({ owner, workId })).map((m) => m.body)).toEqual([
      'bucket 0',
      'reply 0',
    ]);
  } finally {
    await dispose();
  }
}, 120_000);
