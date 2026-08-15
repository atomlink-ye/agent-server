import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createPostgresPool } from '../../src/infrastructure/postgres/postgres.js';
import { createMemoryReviewActionTokenDeriver } from '../../src/application/channels/memory-review-action-token.js';
import {
  createLarkTestService,
  larkE2eConfig,
} from '../fixtures/create-lark-test-service.js';

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString)
  throw new Error(
    'real PostgreSQL integration requires DATABASE_URL or POSTGRES_URL',
  );

describe('real PostgreSQL Lark memory Card/Doc E2E', () => {
  let pool: ReturnType<typeof createPostgresPool> | undefined;
  let service: Awaited<ReturnType<typeof createLarkTestService>> | undefined;

  afterEach(async () => {
    await service?.close();
    await pool?.end();
    service = undefined;
    pool = undefined;
  });

  it('completes the normal Card/Doc review path and pins the accepted snapshot', async () => {
    const workspaceId = randomUUID();
    const connectionKey = `lark/task12/${randomUUID()}`;
    const rootOne = `task12-root-${randomUUID()}`;
    const rootTwo = `task12-root-${randomUUID()}`;
    const sourceMarker = `TASK12_SOURCE_${randomUUID()}`;
    const editedMarker = `TASK12_EDITED_${randomUUID()}`;
    const synthesizedMarker = `TASK12_SYNTHESIZED_${randomUUID()}`;
    const lateMarker = `TASK12_LATE_${randomUUID()}`;
    const comment = `TASK12_COMMENT_${randomUUID()}`;
    const reply = `TASK12_REPLY_${randomUUID()}`;
    const recallMarker = 'RECALL_FROM_MEMORY';
    pool = createPostgresPool({
      connectionString: connectionString!,
      maxConnections: 8,
    });
    service = await createLarkTestService({
      database: pool,
      config: {
        ...larkE2eConfig,
        workspaceId,
        connectionKey,
      },
      runtime: {
        canaryPrompt: 'SOURCE_REQUEST',
        canaryResponseText: Array.from(
          { length: 21 },
          (_, i) => `${sourceMarker} line ${i + 1}`,
        ).join('\n'),
        canaryMemoryCandidates: [
          {
            content: Array.from(
              { length: 21 },
              (_, i) => `${sourceMarker} line ${i + 1}`,
            ).join('\n'),
            category: 'project_constraint',
          },
        ],
        responseText: synthesizedMarker,
        deriveMemoryResponse: true,
      },
    });

    await service.dispatch(
      messageEvent(service.config, rootOne, rootOne, 'bot SOURCE_REQUEST'),
    );
    await waitFor(
      service,
      async () =>
        (await count(
          service!,
          'workspace_memory_proposals',
          `workspace_id = '${workspaceId}'`,
        )) === 1,
    );
    const proposal = (
      await service.database.query<{ id: string }>(
        `SELECT id FROM workspace_memory_proposals WHERE workspace_id = $1 AND status = 'pending'`,
        [workspaceId],
      )
    ).rows[0]!;
    await waitFor(
      service,
      async () =>
        (await count(
          service!,
          'lark_memory_review_surfaces',
          `workspace_id = '${workspaceId}' AND status = 'active_card_with_doc'`,
        )) === 1,
    );
    const initial = (
      await service.database.query<{
        id: string;
        version: number;
        card_message_id: string;
        doc_token: string;
        doc_revision: string;
        status: string;
      }>(
        `SELECT id, version, card_message_id, doc_token, doc_revision, status FROM lark_memory_review_surfaces WHERE proposal_id = $1 AND status = 'active_card_with_doc'`,
        [proposal.id],
      )
    ).rows[0]!;
    expect(initial.status).toBe('active_card_with_doc');
    expect(initial.card_message_id).toBeTruthy();
    expect(initial.doc_token).toBeTruthy();
    expect(initial.doc_revision).toBeTruthy();
    expect(service.documentProvider.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining([
        'document.create',
        'documentBlockChildren.create',
        'permissionMember.create',
      ]),
    );
    service.documentProvider.setBody(initial.doc_token, [
      {
        block_type: 2,
        text: { elements: [{ text_run: { content: editedMarker } }] },
      },
    ]);
    service.documentProvider.addComment(
      initial.doc_token,
      'comment-1',
      comment,
    );
    service.documentProvider.addReply(initial.doc_token, 'comment-1', reply);

    const deriver = createMemoryReviewActionTokenDeriver(
      service.config.appSecret,
    );
    await service.dispatch(
      cardEvent(
        service.config,
        initial.card_message_id,
        'preview_doc',
        deriver.derive({ surfaceId: initial.id, version: initial.version }),
      ),
    );
    await waitFor(
      service,
      async () =>
        (await count(
          service!,
          'lark_memory_review_surfaces',
          'preview_content IS NOT NULL',
        )) === 1,
    );
    expect(service.runtime.prompts.at(-1)).toEqual(
      expect.stringContaining(editedMarker),
    );
    expect(service.runtime.prompts.at(-1)).toEqual(
      expect.stringContaining(comment),
    );
    expect(service.runtime.prompts.at(-1)).toEqual(
      expect.stringContaining(reply),
    );
    const preview = (
      await service.database.query<{
        id: string;
        version: number;
        preview_content: string;
        preview_sha256: string;
        card_message_id: string;
      }>(
        `SELECT id, version, preview_content, preview_sha256, card_message_id FROM lark_memory_review_surfaces WHERE proposal_id = $1 AND preview_content IS NOT NULL`,
        [proposal.id],
      )
    ).rows[0]!;
    expect(preview.preview_content).toBe(synthesizedMarker);
    expect(preview.preview_sha256).toMatch(/^[a-f0-9]{64}$/);
    await waitFor(service, async () =>
      service!.deliveries.some((delivery) => delivery.kind === 'card_patch'),
    );
    expect(
      service.deliveries.some((delivery) => delivery.kind === 'card_patch'),
    ).toBe(true);
    service.documentProvider.setBody(initial.doc_token, [
      {
        block_type: 2,
        text: { elements: [{ text_run: { content: lateMarker } }] },
      },
    ]);

    const acceptToken = deriver.derive({
      surfaceId: preview.id,
      version: preview.version,
    });
    await service.dispatch(
      cardEvent(
        service.config,
        initial.card_message_id,
        'accept_preview',
        acceptToken,
      ),
    );
    await waitFor(
      service,
      async () =>
        (await count(service!, 'workspace_memory_entries')) === 1 &&
        (await count(
          service!,
          'workspace_memory_snapshots',
          "projection_status = 'ready'",
        )) === 1,
    );
    await expect(
      service.database.query<{ content: string }>(
        `SELECT content FROM workspace_memory_entries`,
      ),
    ).resolves.toMatchObject({ rows: [{ content: synthesizedMarker }] });
    await expect(
      service.database.query<{ content_hash: string }>(
        `SELECT content_hash FROM workspace_memory_snapshots WHERE projection_status = 'ready'`,
      ),
    ).resolves.toMatchObject({ rows: [{ content_hash: expect.any(String) }] });
    await expect(
      service.database.query<{ status: string; review_outcome: string }>(
        `SELECT status, review_outcome FROM workspace_memory_proposals WHERE id = $1`,
        [proposal.id],
      ),
    ).resolves.toMatchObject({
      rows: [{ status: 'accepted', review_outcome: 'edit_and_accept' }],
    });
    await waitFor(
      service,
      async () =>
        (
          await service!.database.query<{ status: string }>(
            `SELECT status FROM lark_memory_review_surfaces WHERE id = $1`,
            [preview.id],
          )
        ).rows[0]?.status === 'resolved',
    );
    await waitFor(service, async () =>
      service!.deliveries.some(
        (delivery) =>
          delivery.kind === 'text' && delivery.text.includes('Memory accepted'),
      ),
    );

    await service.dispatch(
      messageEvent(
        service.config,
        rootTwo,
        rootTwo,
        `bot recall ${recallMarker}`,
      ),
    );
    await waitFor(
      service,
      async () => (await count(service!, 'runs', "status = 'succeeded'")) === 2,
    );
    const pinned = await service.database.query<{
      memory_snapshot_id: string;
      memory_snapshot_hash: string;
    }>(
      `SELECT memory_snapshot_id, memory_snapshot_hash FROM tasks WHERE session_id = (SELECT session_id FROM channel_conversation_bindings WHERE root_message_id = $1)`,
      [rootTwo],
    );
    const ready = await service.database.query<{
      snapshot_id: string;
      content_hash: string;
    }>(
      `SELECT snapshot_id, content_hash FROM workspace_memory_snapshots WHERE projection_status = 'ready'`,
    );
    expect(pinned.rows).toEqual([
      {
        memory_snapshot_id: ready.rows[0]!.snapshot_id,
        memory_snapshot_hash: ready.rows[0]!.content_hash,
      },
    ]);
    expect(service.runtime.prompts.at(-1)).toContain(
      'Pinned verified MEMORY.md',
    );
    expect(service.runtime.prompts.at(-1)).toContain(synthesizedMarker);
    await waitFor(service, async () =>
      service!.deliveries.some(
        (delivery) =>
          delivery.kind === 'text' && delivery.text.includes(recallMarker),
      ),
    );
    expect(
      service.deliveries.some(
        (delivery) =>
          delivery.kind === 'text' && delivery.text.includes(recallMarker),
      ),
    ).toBe(true);
    expect(service.runtime.executeCalls).toBe(3);
    expect(await count(service, 'product_sessions')).toBe(2);
  });
});

function messageEvent(
  config: typeof larkE2eConfig,
  id: string,
  rootId: string,
  text: string,
) {
  return {
    schema: '2.0',
    header: { event_id: id, event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: config.allowedOpenId } },
      message: {
        message_id: id,
        root_id: rootId,
        chat_id: config.allowedChatId,
        message_type: 'text',
        content: JSON.stringify({ text }),
        mentions: [{ id: { open_id: config.botOpenId }, name: 'bot' }],
      },
    },
  };
}

function cardEvent(
  config: typeof larkE2eConfig,
  cardMessageId: string,
  action: string,
  token: string,
) {
  return {
    schema: '2.0',
    header: {
      event_id: `${action}-${randomUUID()}`,
      event_type: 'card.action.trigger',
    },
    event: {
      operator: { operator_id: { open_id: config.allowedOpenId } },
      context: {
        open_chat_id: config.allowedChatId,
        open_message_id: cardMessageId,
      },
      action: {
        tag: 'button',
        value: JSON.stringify({ action, token }),
      },
    },
  };
}

async function count(
  service: Awaited<ReturnType<typeof createLarkTestService>>,
  table: string,
  where = 'TRUE',
) {
  const result = await service.database.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`,
  );
  return result.rows[0]!.count;
}

async function waitFor(
  service: Awaited<ReturnType<typeof createLarkTestService>>,
  check: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `timed out waiting for Task 12 E2E: ${service.runtime.executeCalls}`,
  );
}
