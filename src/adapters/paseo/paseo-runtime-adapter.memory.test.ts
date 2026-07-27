import { access, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaseoRuntimeAdapter } from './paseo-runtime-adapter.js';
import type { PaseoClientPort } from './paseo-client-port.js';
import {
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../application/ports/agent-runtime.js';

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
    sendAgentMessage: async () => undefined,
    waitForFinish: async () => {
      await onFinish?.();
      return { status: 'idle', error: null, lastMessage: 'done' };
    },
    close: async () => undefined,
  };
}

describe('Paseo runtime same-agent continuation', () => {
  it('sends a follow-up to the supplied provider Agent and returns its id', async () => {
    const sent: string[] = [];
    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd: join(tmpdir(), `agent-server-${randomUUID()}`),
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      {
        ...client(),
        sendAgentMessage: async (agentId, text) => {
          sent.push(`${agentId}:${text}`);
        },
        waitForFinish: async (agentId) => ({
          status: 'idle',
          error: null,
          lastMessage: `continued:${agentId}`,
        }),
      },
    );

    const result = await runtime.execute({
      operation: 'continue',
      runId: 'run-follow-up',
      prompt: 'continue',
      providerAgentId: 'agent-existing',
    });

    expect(sent).toEqual(['agent-existing:continue']);
    expect(result.providerAgentId).toBe('agent-existing');
  });

  it('does not create a replacement Agent when continuation fails', async () => {
    const create = async () => ({
      id: 'replacement',
      provider: 'opencode',
      model: 'free/model',
    });
    const runtime = new PaseoRuntimeAdapter(
      {
        wsUrl: 'ws://test',
        cwd: join(tmpdir(), `agent-server-${randomUUID()}`),
        workspaceTitle: 'test',
        connectTimeoutMs: 1,
        executionTimeoutMs: 1,
      },
      logger,
      {
        ...client(),
        createOpenCodeAgent: create,
        sendAgentMessage: async () => {
          throw new Error('closed');
        },
      },
    );
    await expect(
      runtime.execute({
        operation: 'continue',
        runId: 'run-follow-up',
        prompt: 'continue',
        providerAgentId: 'agent-closed',
      }),
    ).rejects.toThrow('closed');
  });

  it.each([
    [
      'send rejection',
      async (client: PaseoClientPort) => {
        client.sendAgentMessage = async () => {
          throw new Error('send failed');
        };
      },
    ],
    [
      'wait rejection',
      async (client: PaseoClientPort) => {
        client.waitForFinish = async () => {
          throw new Error('wait failed');
        };
      },
    ],
    [
      'wait error status',
      async (client: PaseoClientPort) => {
        client.waitForFinish = async () => ({
          status: 'error',
          error: 'provider failed',
          lastMessage: null,
        });
      },
    ],
    [
      'wait timeout status',
      async (client: PaseoClientPort) => {
        client.waitForFinish = async () => ({
          status: 'timeout',
          error: null,
          lastMessage: null,
        });
      },
    ],
  ])(
    'fails closed on continuation %s without creating a replacement Agent',
    async (_label, configure) => {
      let creates = 0;
      const continuationClient = client();
      continuationClient.createOpenCodeAgent = async () => {
        creates += 1;
        return { id: 'replacement', provider: 'opencode', model: 'free/model' };
      };
      await configure(continuationClient);
      const runtime = new PaseoRuntimeAdapter(
        {
          wsUrl: 'ws://test',
          cwd: join(tmpdir(), `agent-server-${randomUUID()}`),
          workspaceTitle: 'test',
          connectTimeoutMs: 1,
          executionTimeoutMs: 1,
        },
        logger,
        continuationClient,
      );

      const failure = runtime.execute({
        operation: 'continue',
        runId: 'run-failure',
        prompt: 'continue',
        providerAgentId: 'agent-existing',
      });
      if (_label === 'wait timeout status') {
        await expect(failure).rejects.toBeInstanceOf(RuntimeTimedOutError);
      } else if (_label === 'wait error status') {
        await expect(failure).rejects.toBeInstanceOf(RuntimeExecutionError);
      } else {
        await expect(failure).rejects.toThrow();
      }
      expect(creates).toBe(0);
    },
  );
});

const logger = { log: () => undefined };

describe('Paseo runtime memory proposal artifact', () => {
  it.each([
    ['absent', undefined],
    ['zero maxCandidates', { maxCandidates: 0 }],
    ['zero proposalLimit', { proposalLimit: 0 }],
  ])(
    'sends the original prompt unchanged and skips artifacts when memory is %s',
    async (_label, memoryCandidates) => {
      const cwd = join(tmpdir(), `agent-server-${randomUUID()}`);
      const artifact = join(
        cwd,
        'scratchpad',
        'runs',
        'run-disabled',
        'memory-proposals.json',
      );
      await mkdir(join(cwd, 'scratchpad', 'runs', 'run-disabled'), {
        recursive: true,
      });
      await writeFile(artifact, '{malformed');
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
            requestPrompt = input.initialPrompt;
            return { id: 'agent-1', provider: 'opencode', model: 'free/model' };
          },
        },
      );

      const prompt =
        'Return exactly: memory artifact instructions are not part of this prompt.';
      await runtime.execute({
        operation: 'create',
        runId: 'run-disabled',
        prompt,
        systemPrompt: '',
        ...(memoryCandidates ? { memoryCandidates } : {}),
      });
      await runtime.execute({
        operation: 'create',
        runId: 'run-fresh',
        prompt,
        systemPrompt: '',
        ...(memoryCandidates ? { memoryCandidates } : {}),
      });

      expect(requestPrompt).toBe(prompt);
      await expect(access(artifact)).resolves.toBeUndefined();
      await expect(
        access(join(cwd, 'scratchpad', 'runs', 'run-fresh')),
      ).rejects.toThrow();
    },
  );

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
          requestPrompt = input.initialPrompt;
          return { id: 'agent-1', provider: 'opencode', model: 'free/model' };
        },
      },
    );
    await runtime.execute({
      operation: 'create',
      runId: 'run-contract',
      prompt: 'test',
      systemPrompt: '',
      memoryCandidates: { proposalLimit: 1 },
    });
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
    const result = await runtime.execute({
      operation: 'create',
      runId,
      prompt: 'test',
      systemPrompt: '',
      memoryCandidates: { maxCandidates: 1 },
    });

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
      runtime.execute({
        operation: 'create',
        runId: 'run-1',
        prompt: 'test',
        systemPrompt: '',
        memoryCandidates: { proposalLimit: 1 },
      }),
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
      symlinkRuntime.execute({
        operation: 'create',
        runId: 'run-3',
        prompt: 'test',
        systemPrompt: '',
        memoryCandidates: { proposalLimit: 1 },
      }),
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
      ).execute({
        operation: 'create',
        runId: 'run-parent',
        prompt: 'test',
        systemPrompt: '',
        memoryCandidates: { proposalLimit: 1 },
      }),
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
        runtime.execute({
          operation: 'create',
          runId: 'run-1',
          prompt: 'test',
          systemPrompt: '',
          memoryCandidates: { proposalLimit: 1 },
        }),
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
      runtime.execute({
        operation: 'create',
        runId: 'run-1',
        prompt: 'test',
        systemPrompt: '',
        memoryCandidates: { proposalLimit: 1 },
      }),
    ).rejects.toThrow('symbolic link');
  });
});
