import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('emits one structured record with stable fields', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'agent-server-test',
      minimumLevel: 'info',
      write: (line) => lines.push(line),
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });

    logger.log('info', 'test.completed', { task_id: 'task-1' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-07-22T00:00:00.000Z',
      level: 'info',
      service: 'agent-server-test',
      event: 'test.completed',
      task_id: 'task-1',
    });
  });

  it('filters records below the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'agent-server-test',
      minimumLevel: 'warn',
      write: (line) => lines.push(line),
    });

    logger.log('info', 'ignored');

    expect(lines).toEqual([]);
  });
});
