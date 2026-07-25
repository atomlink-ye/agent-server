import { afterEach, describe, expect, it } from 'vitest';

import { createLarkTestService } from '../tests/fixtures/create-lark-test-service.js';

const rawMessage = {
  schema: '2.0',
  header: {
    event_id: 'lark-ingress-e2e-event',
    event_type: 'im.message.receive_v1',
  },
  event: {
    sender: { sender_id: { open_id: 'ou_lark_ingress_e2e_user' } },
    message: {
      message_id: 'om_lark_ingress_e2e_unique',
      root_id: 'om_lark_ingress_e2e_unique',
      chat_id: 'oc_lark_ingress_e2e_chat',
      message_type: 'text',
      content: JSON.stringify({
        text: 'Please run the LARK_INGRESS_E2E_OK task.',
      }),
      mentions: [{ id: { open_id: 'ou_lark_ingress_e2e_bot' } }],
    },
  },
};

describe('Lark ingress vertical path', () => {
  let service: Awaited<ReturnType<typeof createLarkTestService>> | undefined;

  afterEach(async () => {
    await service?.close();
    service = undefined;
  });

  it('delivers one Lark message to AgentRuntimePort exactly once, including replay convergence', async () => {
    service = await createLarkTestService();
    await service.dispatch(rawMessage);

    await waitFor(async () => {
      const result = await service!.database.query<{
        run_status: string | null;
      }>(
        `SELECT ci.status, ci.admitted_session_id, ci.admitted_task_id,
                t.id AS task_id, r.id AS run_id, r.status AS run_status,
                r.result
         FROM channel_ingress_events ci
         LEFT JOIN tasks t ON t.id = ci.admitted_task_id
         LEFT JOIN runs r ON r.task_id = t.id
         WHERE ci.external_message_id = $1`,
        ['om_lark_ingress_e2e_unique'],
      );
      return result.rows[0]?.run_status === 'succeeded';
    });

    const first = await service.database.query(
      `SELECT ci.status, ci.admitted_session_id, ci.admitted_task_id,
              ps.id AS session_id, t.id AS task_id, r.id AS run_id,
              r.status AS run_status, r.result
       FROM channel_ingress_events ci
       JOIN product_sessions ps ON ps.id = ci.admitted_session_id
       JOIN tasks t ON t.id = ci.admitted_task_id
       JOIN runs r ON r.task_id = t.id
       WHERE ci.external_message_id = $1`,
      ['om_lark_ingress_e2e_unique'],
    );
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({
      status: 'processed',
      run_status: 'succeeded',
      result: { text: 'LARK_INGRESS_E2E_OK' },
    });

    const counts = await service.database.query(
      `SELECT
         (SELECT COUNT(*)::int FROM product_sessions) AS sessions,
         (SELECT COUNT(*)::int FROM channel_conversation_bindings) AS bindings,
         (SELECT COUNT(*)::int FROM messages WHERE role = 'user') AS messages,
         (SELECT COUNT(*)::int FROM tasks) AS tasks,
         (SELECT COUNT(*)::int FROM runs) AS runs,
         (SELECT COUNT(*)::int FROM admissions WHERE ingress = 'lark') AS admissions,
         (SELECT COUNT(*)::int FROM run_dispatches WHERE event_type = 'run.enqueue') AS enqueues,
         (SELECT COUNT(*)::int FROM run_events WHERE type = 'succeeded') AS terminal_events`,
    );
    expect(counts.rows[0]).toEqual({
      sessions: 1,
      bindings: 1,
      messages: 1,
      tasks: 1,
      runs: 1,
      admissions: 1,
      enqueues: 1,
      terminal_events: 1,
    });
    expect(service.runtime.executeCalls).toBe(1);

    await service.dispatch(rawMessage);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(service.runtime.executeCalls).toBe(1);
    await expect(
      service.database.query(
        `SELECT COUNT(*)::int AS count FROM messages WHERE role = 'user'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      service.database.query('SELECT COUNT(*)::int AS count FROM tasks'),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      service.database.query('SELECT COUNT(*)::int AS count FROM runs'),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for Lark run completion');
}
