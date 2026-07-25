import { describe, expect, it } from 'vitest';
import { InMemoryRunEventRepository } from './in-memory-run-event-repository.js';

describe('InMemoryRunEventRepository', () => {
  it('requires exact Run and Session for provider continuation', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run',
      sessionId: 'session',
      providerAgentId: 'agent',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      repository.getProviderBindingForRunInSession('run', 'session'),
    ).resolves.toEqual({
      runId: 'run',
      sessionId: 'session',
      providerAgentId: 'agent',
    });
    await expect(
      repository.getProviderBindingForRunInSession('run', 'wrong'),
    ).resolves.toBeNull();
  });
  it('preserves a provider Agent when rebinding without a new provider ID', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run-1',
      sessionId: 'session-1',
      providerAgentId: 'agent-original',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.bind({
      runId: 'run-1',
      sessionId: 'session-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    await expect(repository.getBinding('run-1')).resolves.toMatchObject({
      providerAgentId: 'agent-original',
    });
    await expect(
      repository.findLatestProviderAgentBySessionId('session-1'),
    ).resolves.toBe('agent-original');
  });

  it('finds the latest non-null provider Agent for a Product Session', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.bind({
      runId: 'run-old',
      sessionId: 'session-1',
      providerAgentId: 'agent-old',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await repository.bind({
      runId: 'run-current',
      sessionId: 'session-1',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    await expect(
      repository.findLatestProviderAgentBySessionId('session-1'),
    ).resolves.toBe('agent-old');
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
