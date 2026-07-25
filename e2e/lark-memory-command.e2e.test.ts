import { afterEach, describe, expect, it } from 'vitest';

import {
  createLarkTestService,
  larkE2eConfig,
} from '../tests/fixtures/create-lark-test-service.js';

const workspaceId = larkE2eConfig.workspaceId;
const marker = 'SOURCE_MARKER';
const acceptedMarker = 'ACCEPTED_MARKER';

function messageEvent(
  messageId: string,
  rootId: string,
  text: string,
  eventId = messageId,
) {
  return {
    schema: '2.0',
    header: { event_id: eventId, event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: larkE2eConfig.allowedOpenId } },
      message: {
        message_id: messageId,
        root_id: rootId,
        chat_id: larkE2eConfig.allowedChatId,
        message_type: 'text',
        content: JSON.stringify({ text }),
        mentions: [{ id: { open_id: larkE2eConfig.botOpenId }, name: 'bot' }],
      },
    },
  };
}

describe('Lark memory command full path', () => {
  let service: Awaited<ReturnType<typeof createLarkTestService>> | undefined;

  afterEach(async () => {
    await service?.close();
    service = undefined;
  });

  it('converges proposal review, command delivery, and pinned recall across roots', async () => {
    service = await createLarkTestService({
      runtime: {
        canaryPrompt: 'SOURCE_REQUEST',
        canaryResponseText: 'SOURCE_RESULT',
        canaryMemoryCandidates: [
          { content: marker, category: 'project_constraint' },
        ],
        deriveMemoryResponse: true,
      },
    });

    const root = messageEvent('root-1', 'root-1', 'bot SOURCE_REQUEST');
    await service.dispatch(root);
    await waitFor(service, async () => {
      const result = await service!.database.query<{ status: string }>(
        `SELECT status FROM runs WHERE status = 'succeeded'`,
      );
      return result.rows.length === 1;
    });

    const source = await service.database.query<{
      run_id: string;
      task_id: string;
      session_id: string;
      message_id: string;
      agent_version_id: string;
    }>(
      `SELECT r.id AS run_id, t.id AS task_id, t.session_id,
              m.id AS message_id, t.invokable_version_id AS agent_version_id
       FROM runs r JOIN tasks t ON t.id = r.task_id
       JOIN messages m ON m.task_id = t.id
       WHERE r.status = 'succeeded' AND m.role = 'user'`,
    );
    expect(source.rows).toHaveLength(1);
    const sourceRun = source.rows[0]!;

    await waitFor(
      service,
      async () => (await count(service!, 'workspace_memory_proposals')) === 1,
    );

    const proposal = await service.database.query<{
      id: string;
      content: string;
      source_run_id: string;
      source_task_id: string;
      source_session_id: string;
      source_message_id: string;
      source_agent_version_id: string;
    }>(
      `SELECT id, original_content AS content, source_run_id, source_task_id, source_session_id,
              source_message_id, source_agent_version_id
       FROM workspace_memory_proposals WHERE status = 'pending'`,
    );
    expect(proposal.rows).toEqual([
      expect.objectContaining({
        content: marker,
        source_run_id: sourceRun.run_id,
        source_task_id: sourceRun.task_id,
        source_session_id: sourceRun.session_id,
        source_message_id: sourceRun.message_id,
        source_agent_version_id: sourceRun.agent_version_id,
      }),
    ]);
    const proposalId = proposal.rows[0]!.id;
    await waitFor(
      service,
      async () =>
        (await count(service!, 'channel_delivery_attempts')) === 2 &&
        service!.deliveries.length === 2,
    );
    expect(await count(service, 'channel_outbox')).toBe(2);
    expect(await count(service, 'channel_delivery_attempts')).toBe(2);
    expect(service.deliveries).toHaveLength(2);
    expect(
      service.deliveries
        .filter((item) => item.kind === 'text')
        .map((item) => item.text),
    ).toEqual([expect.stringContaining('Agent final answer:')]);
    expect(service.deliveries.some((item) => item.kind === 'card_reply')).toBe(
      true,
    );

    await service.dispatch(root);
    await waitFor(
      service,
      async () =>
        (await count(service!, 'channel_delivery_attempts')) === 2 &&
        service!.deliveries.length === 2,
    );
    expect(await count(service, 'runs')).toBe(1);
    expect(await count(service, 'channel_outbox')).toBe(2);
    expect(await count(service, 'channel_delivery_attempts')).toBe(2);

    const command = messageEvent(
      'command-1',
      'root-1',
      `bot /memory edit-and-accept ${proposalId} ${acceptedMarker}`,
    );
    await service.dispatch(command);
    await waitFor(service, async () => {
      const result = await service!.database.query<{ status: string }>(
        `SELECT status FROM workspace_memory_proposals WHERE id = $1`,
        [proposalId],
      );
      return result.rows[0]?.status === 'accepted';
    });
    expect(await count(service, 'workspace_memory_entries')).toBe(1);
    expect(await count(service, 'workspace_memory_snapshots')).toBe(1);
    await expect(
      service.database.query(
        `SELECT content FROM workspace_memory_entries WHERE content = $1`,
        [acceptedMarker],
      ),
    ).resolves.toMatchObject({ rows: [{ content: acceptedMarker }] });
    expect(
      await count(
        service,
        'channel_ingress_events',
        "kind = 'command' AND status = 'processed'",
      ),
    ).toBe(1);
    await waitFor(
      service,
      async () =>
        (await count(service!, 'channel_delivery_attempts')) === 3 &&
        service!.deliveries.length === 3,
    );
    expect(await count(service, 'channel_outbox')).toBe(3);
    expect(await count(service, 'channel_delivery_attempts')).toBe(3);
    expect(service.deliveries.at(-1)?.text).toContain(
      'Memory review accepted and published.',
    );

    await service.dispatch(command);
    await waitFor(
      service,
      async () =>
        (await count(service!, 'channel_delivery_attempts')) === 3 &&
        service!.deliveries.length === 3,
    );
    expect(await count(service, 'workspace_memory_entries')).toBe(1);
    expect(await count(service, 'workspace_memory_snapshots')).toBe(1);
    expect(await count(service, 'channel_outbox')).toBe(3);
    expect(await count(service, 'channel_delivery_attempts')).toBe(3);

    await service.dispatch(
      messageEvent('root-2', 'root-2', 'bot recall the accepted memory'),
    );
    await waitFor(service, async () => {
      const result = await service!.database.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM runs WHERE status = 'succeeded'`,
      );
      return result.rows[0]?.count === 2;
    });
    const pinned = await service.database.query<{
      memory_snapshot_id: string;
      memory_snapshot_hash: string;
    }>(
      `SELECT memory_snapshot_id, memory_snapshot_hash FROM tasks
       WHERE session_id = (SELECT session_id FROM channel_conversation_bindings WHERE root_message_id = 'root-2')`,
    );
    const ready = await service.database.query<{
      id: string;
      content_hash: string;
    }>(
      `SELECT snapshot_id AS id, content_hash FROM workspace_memory_snapshots WHERE projection_status = 'ready'`,
    );
    expect(pinned.rows).toEqual([
      {
        memory_snapshot_id: ready.rows[0]!.id,
        memory_snapshot_hash: ready.rows[0]!.content_hash,
      },
    ]);
    expect(service.runtime.prompts.at(-1)).toContain(
      'Pinned verified MEMORY.md',
    );
    expect(service.runtime.prompts.at(-1)).toContain(acceptedMarker);
    expect(service.runtime.prompts.join('\n')).not.toContain(
      '/memory edit-and-accept',
    );
    await waitFor(
      service,
      async () =>
        (await count(service!, 'channel_delivery_attempts')) === 4 &&
        service!.deliveries.length === 4,
    );
    expect(service.deliveries.at(-1)?.text).toContain('RECALL_FROM_MEMORY');
    expect(await count(service, 'product_sessions')).toBe(2);
    expect(await count(service, 'channel_conversation_bindings')).toBe(2);
    expect(await count(service, 'runs')).toBe(2);
    expect(await count(service, 'channel_outbox')).toBe(4);
    expect(await count(service, 'channel_delivery_attempts')).toBe(4);
  });
});

async function count(
  service: Awaited<ReturnType<typeof createLarkTestService>>,
  table: string,
  where = 'TRUE',
): Promise<number> {
  const result = await service.database.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`,
  );
  return result.rows[0]!.count;
}

async function waitFor(
  service: Awaited<ReturnType<typeof createLarkTestService>>,
  check: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `timed out waiting for Lark memory E2E: ${service.runtime.executeCalls}`,
  );
}
