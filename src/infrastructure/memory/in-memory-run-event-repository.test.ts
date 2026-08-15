import { describe, expect, it } from 'vitest';
import { InMemoryRunEventRepository } from './in-memory-run-event-repository.js';

describe('InMemoryRunEventRepository', () => {
  it('requires exact Run and Session for execution continuation', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run',
      sessionId: 'session',
      sessionBinding: { plane: 'paseo', externalSessionId: 'agent' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      repository.getSessionBindingForRunInSession('run', 'session'),
    ).resolves.toEqual({
      plane: 'paseo',
      externalSessionId: 'agent',
    });
    await expect(
      repository.getSessionBindingForRunInSession('run', 'wrong'),
    ).resolves.toBeNull();
  });
  it('preserves an execution session when rebinding without a new binding', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run-1',
      sessionId: 'session-1',
      sessionBinding: { plane: 'paseo', externalSessionId: 'agent-original' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.bind({
      runId: 'run-1',
      sessionId: 'session-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    await expect(repository.getBinding('run-1')).resolves.toMatchObject({
      sessionBinding: {
        plane: 'paseo',
        externalSessionId: 'agent-original',
      },
    });
    await expect(
      repository.findLatestSessionBindingBySessionId('session-1'),
    ).resolves.toEqual({
      plane: 'paseo',
      externalSessionId: 'agent-original',
    });
  });

  it('finds the latest non-null execution session for a Product Session', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run-old',
      sessionId: 'session-1',
      sessionBinding: { plane: 'paseo', externalSessionId: 'agent-old' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.bind({
      runId: 'run-current',
      sessionId: 'session-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    await expect(
      repository.findLatestSessionBindingBySessionId('session-1'),
    ).resolves.toEqual({ plane: 'paseo', externalSessionId: 'agent-old' });
  });

  it('keeps a monotonic timeline and makes terminal events idempotent', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.append(
      '00000000-0000-0000-0000-000000000001',
      'started',
      {},
    );
    await repository.append('00000000-0000-0000-0000-000000000001', 'output', {
      text: 'safe',
    });
    const first = await repository.append(
      '00000000-0000-0000-0000-000000000001',
      'succeeded',
      {},
    );
    const second = await repository.append(
      '00000000-0000-0000-0000-000000000001',
      'succeeded',
      {},
    );
    expect(second).toEqual(first);
    expect(
      (await repository.list(first.runId, 0)).events.map(
        (event) => event.sequence,
      ),
    ).toEqual([1, 2, 3]);
  });
});
