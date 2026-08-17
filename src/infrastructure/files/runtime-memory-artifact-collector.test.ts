import { access, mkdir, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  LocalRuntimeMemoryCandidateCollector,
  RuntimeMemoryArtifactError,
} from './runtime-memory-artifact-collector.js';

function cwd() {
  return join(tmpdir(), `agent-server-memory-${randomUUID()}`);
}

describe('LocalRuntimeMemoryCandidateCollector', () => {
  it('is a no-op when proposals are disabled', async () => {
    const root = cwd();
    const session = await new LocalRuntimeMemoryCandidateCollector().prepare({
      runId: 'run-disabled',
      cwd: root,
      proposalLimit: 0,
    });

    expect(session.decoratePrompt('original')).toBe('original');
    expect(await session.collect()).toEqual([]);
    await expect(access(join(root, 'scratchpad'))).rejects.toThrow();
  });

  it('prepares a relative contract, clears stale data, and reads valid proposals', async () => {
    const root = cwd();
    const runId = 'run-1';
    const artifact = join(
      root,
      'scratchpad',
      'runs',
      runId,
      'memory-proposals.json',
    );
    await mkdir(join(root, 'scratchpad', 'runs', runId), { recursive: true });
    await writeFile(artifact, '{stale');

    const session = await new LocalRuntimeMemoryCandidateCollector().prepare({
      runId,
      cwd: root,
      proposalLimit: 1,
    });
    const decorated = session.decoratePrompt('task');
    expect(decorated).toContain('scratchpad/runs/run-1/memory-proposals.json');
    expect(decorated).toContain('Allowed category values');
    expect(decorated).not.toContain(root);
    await expect(access(artifact)).rejects.toThrow();

    await writeFile(
      artifact,
      JSON.stringify({
        proposals: [{ category: 'project_constraint', content: 'keep logs' }],
      }),
    );
    await expect(session.collect()).resolves.toEqual([
      { category: 'project_constraint', content: 'keep logs' },
    ]);
  });

  it.each([
    { proposals: [], extra: true },
    {
      proposals: Array.from({ length: 65 }, () => ({
        category: 'project_constraint',
        content: 'x',
      })),
    },
    { proposals: [], padding: 'x'.repeat(64 * 1024) },
  ])('rejects malformed or oversized artifacts', async (value) => {
    const root = cwd();
    const session = await new LocalRuntimeMemoryCandidateCollector().prepare({
      runId: 'run-invalid',
      cwd: root,
      proposalLimit: 1,
    });
    await writeFile(
      join(root, 'scratchpad', 'runs', 'run-invalid', 'memory-proposals.json'),
      JSON.stringify(value),
    );
    await expect(session.collect()).rejects.toBeInstanceOf(
      RuntimeMemoryArtifactError,
    );
  });

  it('rejects symlink scratch roots and artifacts', async () => {
    const root = cwd();
    const target = join(root, 'target');
    await mkdir(root, { recursive: true });
    await mkdir(target, { recursive: true });
    await symlink(target, join(root, 'scratchpad'));

    await expect(
      new LocalRuntimeMemoryCandidateCollector().prepare({
        runId: 'run-symlink-root',
        cwd: root,
        proposalLimit: 1,
      }),
    ).rejects.toBeInstanceOf(RuntimeMemoryArtifactError);

    const rootTwo = cwd();
    const session = await new LocalRuntimeMemoryCandidateCollector().prepare({
      runId: 'run-symlink-file',
      cwd: rootTwo,
      proposalLimit: 1,
    });
    const external = join(rootTwo, 'external.json');
    await writeFile(external, JSON.stringify({ proposals: [] }));
    await symlink(
      external,
      join(
        rootTwo,
        'scratchpad',
        'runs',
        'run-symlink-file',
        'memory-proposals.json',
      ),
    );
    await expect(session.collect()).rejects.toBeInstanceOf(
      RuntimeMemoryArtifactError,
    );
  });
});
