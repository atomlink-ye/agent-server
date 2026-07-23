import { describe, expect, it } from 'vitest';
import { InMemoryRunEventRepository } from './in-memory-run-event-repository.js';

describe('InMemoryRunEventRepository', () => {
  it('keeps a monotonic timeline and makes terminal events idempotent', async () => {
    const repository = new InMemoryRunEventRepository();
    await repository.append('00000000-0000-0000-0000-000000000001', 'started', {});
    await repository.append('00000000-0000-0000-0000-000000000001', 'output', { text: 'safe' });
    const first = await repository.append('00000000-0000-0000-0000-000000000001', 'succeeded', {});
    const second = await repository.append('00000000-0000-0000-0000-000000000001', 'succeeded', {});
    expect(second).toEqual(first);
    expect((await repository.list(first.runId, 0)).events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});
