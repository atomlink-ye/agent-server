import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No changes produced for ${path}`);
  await writeFile(path, next);
}

function exact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`missing anchor: ${label}`);
  return source.replace(before, after);
}

await edit('src/bootstrap.ts', (source) => {
  source = exact(
    source,
`  const {
    runtime,
    sessions: runtimeSessions,`,
`  const {
    runtime,
    executionRuns,
    sessions: runtimeSessions,`,
    'bootstrap runtime destructure',
  );
  source = exact(
    source,
`  const cancelTask = new CancelTask(
    taskRepository,
    runRepository,
    runtime,
    events,
  );`,
`  const cancelTask = new CancelTask(
    taskRepository,
    runRepository,
    executionRuns,
    events,
  );`,
    'bootstrap cancel task',
  );
  return source;
});

await edit('src/application/runs/runtime-event-detail.test.ts', (source) =>
  exact(
    source,
    `import { runtimeEventPayload } from './execute-run.js';`,
    `import { runtimeEventPayload } from './runtime-event-compatibility.js';`,
    'runtime event compatibility import',
  ),
);

await edit('src/application/runs/execute-run.test.ts', (source) => {
  source = exact(
    source,
`import {
  RuntimeTimedOutError,
  type AgentRuntimePort,
} from '../ports/agent-runtime.js';`,
`import {
  RuntimeTimedOutError,
  type AgentRuntimeExecuteInput,
  type AgentRuntimePort,
} from '../ports/agent-runtime.js';
import type { ExecutionRuntimeService } from '../runtime/execution-plane-runtime-facade.js';`,
    'execute-run test imports',
  );
  source = exact(
    source,
`describe('ExecuteRun', () => {`,
`type TestExecutionRuntime = AgentRuntimePort & ExecutionRuntimeService;

describe('ExecuteRun', () => {`,
    'test runtime alias',
  );
  source = source.replaceAll(
    `readonly runtime: AgentRuntimePort;`,
    `readonly runtime: TestExecutionRuntime;`,
  );
  source = exact(
    source,
`function createRuntimeWithCandidates(
  providerAgentId = 'agent-test',
): AgentRuntimePort {
  return {
    ...createRuntime(),
    execute: vi.fn(async () => ({
      provider: 'test-provider',
      model: 'test-model',
      text: 'safe result',
      providerAgentId,
      memoryCandidates: [
        { category: 'project_constraint', content: 'keep logs' },
      ],
    })),
  };
}

function createRuntime(error?: Error): AgentRuntimePort {
  return {
    initialize: vi.fn(async () => undefined),
    health: vi.fn(async () => ({
      ready: true,
      provider: 'test-provider',
      model: 'test-model',
      checks: [],
    })),
    execute: vi.fn(async () => {
      if (error) throw error;
      return {
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        providerAgentId: 'agent-test',
      };
    }),
    close: vi.fn(async () => undefined),
  };
}`,
`function createRuntimeWithCandidates(
  providerAgentId = 'agent-test',
): TestExecutionRuntime {
  const runtime = createRuntime();
  runtime.execute = vi.fn(async () => ({
    provider: 'test-provider',
    model: 'test-model',
    text: 'safe result',
    providerAgentId,
    runtimeWorkspaceId: 'workspace-test',
    memoryCandidates: [
      { category: 'project_constraint', content: 'keep logs' },
    ],
  }));
  return runtime;
}

function createRuntime(error?: Error): TestExecutionRuntime {
  const runtime = {
    initialize: vi.fn(async () => undefined),
    health: vi.fn(async () => ({
      ready: true,
      provider: 'test-provider',
      model: 'test-model',
      checks: [],
    })),
    execute: vi.fn(async () => {
      if (error) throw error;
      return {
        provider: 'test-provider',
        model: 'test-model',
        text: 'safe result',
        providerAgentId: 'agent-test',
        runtimeWorkspaceId: 'workspace-test',
      };
    }),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as TestExecutionRuntime;
  runtime.ensureReady = vi.fn(async () => (await runtime.health()).ready);
  runtime.executeTurn = vi.fn(async (input) => {
    const legacyInput = (input.systemPrompt !== undefined
      ? {
          operation: 'create',
          runId: input.runId,
          prompt: input.prompt,
          systemPrompt: input.systemPrompt,
          ...(input.provider
            ? { provider: input.provider, model: input.model ?? 'test-model' }
            : {}),
          ...(input.runtimeSessionId
            ? { runtimeSessionId: input.runtimeSessionId }
            : {}),
          ...(input.workspaceBinding
            ? { runtimeWorkspaceId: input.workspaceBinding.externalWorkspaceId }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.workspaceTitle ? { workspaceTitle: input.workspaceTitle } : {}),
          ...(input.sessionTitle ? { agentTitle: input.sessionTitle } : {}),
          ...(input.labels ? { agentLabels: input.labels } : {}),
          ...(input.extensions ? { extensions: input.extensions } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }
      : {
          operation: 'continue',
          runId: input.runId,
          prompt: input.prompt,
          providerAgentId:
            input.compatibilitySessionBinding?.externalSessionId ?? 'agent-test',
          ...(input.runtimeSessionId
            ? { runtimeSessionId: input.runtimeSessionId }
            : {}),
          ...(input.workspaceBinding
            ? { runtimeWorkspaceId: input.workspaceBinding.externalWorkspaceId }
            : {}),
          ...(input.cwd ? { cellCwd: input.cwd } : {}),
          ...(input.proposalLimit !== undefined
            ? { memoryCandidates: { proposalLimit: input.proposalLimit } }
            : {}),
        }) as AgentRuntimeExecuteInput;
    const execution = await runtime.execute(legacyInput);
    return {
      provider: execution.provider,
      model: execution.model,
      text: execution.text,
      workspaceBinding: {
        plane: 'paseo',
        externalWorkspaceId:
          execution.runtimeWorkspaceId ??
          input.workspaceBinding?.externalWorkspaceId ??
          'workspace-test',
      },
      sessionBinding: {
        plane: 'paseo',
        externalSessionId: execution.providerAgentId,
      },
      ...(execution.usage ? { usage: execution.usage } : {}),
      ...(execution.memoryCandidates
        ? { memoryCandidates: execution.memoryCandidates }
        : {}),
    };
  });
  runtime.cancelRun = vi.fn(async ({ runId }) => {
    await runtime.cancel?.({ runId });
  });
  runtime.planeHealth = vi.fn(async () => {
    const health = await runtime.health();
    return {
      ready: health.ready,
      plane: 'test',
      provider: health.provider,
      ...(health.model ? { model: health.model } : {}),
      checks: health.checks,
    };
  });
  return runtime;
}`,
    'runtime helpers',
  );
  return source;
});
