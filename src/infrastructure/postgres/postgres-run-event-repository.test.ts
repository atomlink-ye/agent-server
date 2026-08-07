import { describe, expect, it, vi } from 'vitest';

import { InMemoryRunEventRepository } from '../memory/in-memory-run-event-repository.js';
import { PostgresRunEventRepository } from './postgres-run-event-repository.js';

describe('PostgresRunEventRepository payload boundary', () => {
  it('applies the same bounded nested payload on append and readback as memory', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const db = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        if (sql.startsWith('INSERT INTO run_events')) {
          const payload = JSON.parse(String(values?.[3]));
          const row = {
            id: 'event-1',
            run_id: values?.[1],
            sequence: 1,
            type: values?.[2],
            payload,
            created_at: '2026-08-07T00:00:00.000Z',
          };
          rows.set('run-1', row);
          return { rows: [row] };
        }
        if (sql.startsWith('SELECT id,run_id'))
          return { rows: rows.has('run-1') ? [rows.get('run-1')!] : [] };
        return { rows: [] };
      }),
    };
    const postgres = new PostgresRunEventRepository(
      db as unknown as ConstructorParameters<
        typeof PostgresRunEventRepository
      >[0],
    );
    const memory = new InMemoryRunEventRepository();
    const payload = {
      kind: 'tool_status',
      provider: 'codex',
      detail_kind: 'shell',
      detail_text: 'nested output',
      exit_code: 0,
      detail: {
        kind: 'shell',
        command: 'echo ok',
        output: 'nested output'.repeat(10_000),
        exitCode: 0,
        invalid: new Date(),
      },
      oversized: 'x'.repeat(100_000),
    } as unknown as Parameters<PostgresRunEventRepository['append']>[2];
    const pgEvent = await postgres.append('run-1', 'output', payload);
    const memEvent = await memory.append('run-1', 'output', payload);
    expect(pgEvent.payload).toEqual(memEvent.payload);
    expect(pgEvent.payload).toMatchObject({
      detail: { kind: 'shell', command: 'echo ok', exitCode: 0 },
      detail_kind: 'shell',
      detail_text: (pgEvent.payload.detail as { output?: string }).output,
      exit_code: 0,
    });
    expect(pgEvent.payload.detail).not.toHaveProperty('invalid');
    expect(
      (pgEvent.payload.detail as { output?: string }).output,
    ).toBeDefined();
    expect(JSON.stringify(pgEvent.payload)).not.toContain('x'.repeat(100_000));
    const listed = await postgres.list('run-1', 0);
    expect(listed.events[0]?.payload).toEqual(pgEvent.payload);
    expect(db.query).toHaveBeenCalled();
  });
});
