import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaseoRuntimeAdapter } from './paseo-runtime-adapter.js';
import type { PaseoClientPort } from './paseo-client-port.js';

function client(onFinish?: () => Promise<void>): PaseoClientPort {
  return {
    connect: async () => undefined,
    connectionStatus: () => 'connected',
    openWorkspace: async () => 'workspace-1',
    setWorkspaceTitle: async () => undefined,
    listOpenCodeModels: async () => [{ id: 'free/model', label: 'free' }],
    createOpenCodeAgent: async () => ({
      id: 'agent-1',
      provider: 'opencode',
      model: 'free/model',
    }),
    waitForFinish: async () => {
      await onFinish?.();
      return { status: 'idle', error: null, lastMessage: 'done' };
    },
    close: async () => undefined,
  };
}

const logger = { log: () => undefined };

describe('Paseo runtime memory proposal artifact', () => {
  it('creates the run directory and sends the usable relative artifact contract', async () => {
    const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
    let requestPrompt = '';
    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd,
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      {
        ...client(),
        createOpenCodeAgent: async (input) => {
          requestPrompt = input.prompt;
          return { id: 'agent-1', provider: 'opencode', model: 'free/model' };
        },
      },
    );
    await runtime.execute({ runId: 'run-contract', prompt: 'test' });
    expect(requestPrompt).toContain(
      'scratchpad/runs/run-contract/memory-proposals.json',
    );
    expect(requestPrompt).toContain('Allowed category values');
    expect(requestPrompt).toContain('Maximum proposals: 64');
  });

  it('reads valid run-scoped proposals and clears stale artifacts before execution', async () => {
    const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
    const runId = 'run-1';
    const runDir = join(cwd, 'scratchpad', 'runs', runId);
    await mkdir(runDir, { recursive: true });
    const artifact = join(runDir, 'memory-proposals.json');
    await writeFile(
      artifact,
      JSON.stringify({
        proposals: [{ category: 'project_constraint', content: 'keep logs' }],
      }),
    );

    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd,
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      client(async () =>
        writeFile(
          artifact,
          JSON.stringify({
            proposals: [
              { category: 'project_constraint', content: 'keep logs' },
            ],
          }),
        ),
      ),
    );
    const result = await runtime.execute({ runId, prompt: 'test' });

    expect(result.memoryCandidates).toEqual([
      { category: 'project_constraint', content: 'keep logs' },
    ]);
  });

  it('ignores malformed artifacts and rejects symlink artifacts', async () => {
    const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
    const runDir = join(cwd, 'scratchpad', 'runs', 'run-1');
    await mkdir(runDir, { recursive: true });
    const artifact = join(runDir, 'memory-proposals.json');
    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd,
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      client(async () => writeFile(artifact, '{bad')),
    );
    await expect(
      runtime.execute({ runId: 'run-1', prompt: 'test' }),
    ).rejects.toThrow('memory proposal artifact');
    await symlink(
      join(cwd, 'missing'),
      join(cwd, 'scratchpad', 'runs', 'run-2'),
    );
    const runThreeDir = join(cwd, 'scratchpad', 'runs', 'run-3');
    await mkdir(runThreeDir, { recursive: true });
    const target = join(cwd, 'target.json');
    await writeFile(target, JSON.stringify({ proposals: [] }));
    const symlinkRuntime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd,
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      client(async () =>
        symlink(target, join(runThreeDir, 'memory-proposals.json')),
      ),
    );
    await expect(
      symlinkRuntime.execute({ runId: 'run-3', prompt: 'test' }),
    ).rejects.toThrow('memory proposal artifact');

    const outside = join(cwd, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(cwd, 'scratchpad', 'runs', 'run-parent'));
    await expect(
      new PaseoRuntimeAdapter(
        {
          wsUrl: 'ws://test',
          cwd,
          workspaceTitle: 'test',
          connectTimeoutMs: 1,
          executionTimeoutMs: 1,
        },
        logger,
        client(),
      ).execute({ runId: 'run-parent', prompt: 'test' }),
    ).rejects.toThrow('symbolic-link ancestor');
  });

  it('rejects extra top-level properties, 65 proposals, and oversized artifacts', async () => {
    const cases = [
      { proposals: [], extra: true },
      {
        proposals: Array.from({ length: 65 }, () => ({
          category: 'project_constraint',
          content: 'x',
        })),
      },
      { proposals: [], padding: 'x'.repeat(64 * 1024) },
    ];
    for (const value of cases) {
      const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
      const artifact = join(
        cwd,
        'scratchpad',
        'runs',
        'run-1',
        'memory-proposals.json',
      );
      const runtime = new PaseoRuntimeAdapter(
        {
          wsUrl: 'ws://test',
          cwd,
          workspaceTitle: 'test',
          connectTimeoutMs: 1,
          executionTimeoutMs: 1,
        },
        logger,
        client(async () => {
          await mkdir(join(cwd, 'scratchpad', 'runs', 'run-1'), {
            recursive: true,
          });
          await writeFile(artifact, JSON.stringify(value));
        }),
      );
      await expect(
        runtime.execute({ runId: 'run-1', prompt: 'test' }),
      ).rejects.toThrow('memory proposal artifact');
    }
  });

  it('rejects a configured scratch root symlink before creating descendants', async () => {
    const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
    const target = join(cwd, 'real-scratchpad');
    await mkdir(target, { recursive: true });
    await symlink(target, join(cwd, 'scratchpad'));
    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd,
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      client(),
    );
    await expect(
      runtime.execute({ runId: 'run-1', prompt: 'test' }),
    ).rejects.toThrow('symbolic link');
  });
});
