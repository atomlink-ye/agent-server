import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No changes for ${path}`);
  await writeFile(path, next);
}

await edit('src/application/runtime/execution-plane-runtime-facade.ts', (source) => {
  source = source.replace(
    `import type {\n  ExecutionExtensionBinding,`,
    `import {\n  ExecutionBindingUnavailableError,\n  ProtocolViolationError,\n} from '../ports/execution-plane.js';\nimport type {\n  ExecutionExtensionBinding,`,
  );
  const outcomeStart = source.indexOf('export interface ExecutionTurnOutcome {');
  const serviceStart = source.indexOf('export interface ExecutionRuntimeService {', outcomeStart);
  if (outcomeStart < 0 || serviceStart < 0) throw new Error('turn outcome block missing');
  source = source.slice(0, outcomeStart) + `export interface CompletedExecutionTurn {\n  readonly status: 'completed';\n  readonly provider: string;\n  readonly model: string;\n  readonly text: string;\n  readonly workspaceBinding: ExecutionWorkspaceBinding;\n  readonly sessionBinding: ExecutionSessionBinding;\n  readonly usage?: AgentRuntimeExecution['usage'];\n  readonly memoryCandidates?: readonly RuntimeMemoryCandidate[];\n}\n\nexport interface FailedExecutionTurn {\n  readonly status: 'failed';\n  readonly failure: { readonly code: string; readonly message: string };\n  readonly workspaceBinding: ExecutionWorkspaceBinding;\n  readonly sessionBinding: ExecutionSessionBinding;\n}\n\nexport interface CancelledExecutionTurn {\n  readonly status: 'cancelled';\n  readonly workspaceBinding: ExecutionWorkspaceBinding;\n  readonly sessionBinding: ExecutionSessionBinding;\n}\n\nexport type ExecutionTurnResult =\n  | CompletedExecutionTurn\n  | FailedExecutionTurn\n  | CancelledExecutionTurn;\n\n` + source.slice(serviceStart);
  source = source.replaceAll('Promise<ExecutionTurnOutcome>', 'Promise<ExecutionTurnResult>');
  source = source.replace(
    /throw new RuntimeExecutionError\(\n\s*`Runtime session \$\{input\.runtimeSessionId\} could not be loaded\.`,\n\s*\);/g,
    `throw new ExecutionBindingUnavailableError(\n          \`Runtime session \${input.runtimeSessionId} could not be loaded.\`,\n        );`,
  );
  source = source.replaceAll(
    `throw new RuntimeExecutionError(\n          'Runtime session resolved without complete execution bindings.',\n        );`,
    `throw new ExecutionBindingUnavailableError(\n          'Runtime session resolved without complete execution bindings.',\n        );`,
  );
  source = source.replaceAll(
    `throw new RuntimeExecutionError(\n            'Durable compatibility session resolved without complete execution bindings.',\n          );`,
    `throw new ExecutionBindingUnavailableError(\n            'Durable compatibility session resolved without complete execution bindings.',\n          );`,
  );
  source = source.replaceAll(
    `throw new RuntimeExecutionError(\n            'The compatibility session binding is unavailable.',\n          );`,
    `throw new ExecutionBindingUnavailableError(\n            'The compatibility session binding is unavailable.',\n          );`,
  );
  source = source.replaceAll(
    `throw new RuntimeExecutionError('Fresh execution requires a system prompt.');`,
    `throw new ProtocolViolationError('Fresh execution requires a system prompt.');`,
  );
  source = source.replaceAll(
    `throw new RuntimeExecutionError(\n        'The owning runtime workspace has no execution-plane binding.',\n      );`,
    `throw new ExecutionBindingUnavailableError(\n        'The owning runtime workspace has no execution-plane binding.',\n      );`,
  );
  const expectedBlock = `      if (result.status === 'cancelled')\n        throw new RuntimeExecutionError('The runtime execution was cancelled.');\n      if (result.status === 'failed') {\n        if (result.failure.code === 'runtime_timeout')\n          throw new RuntimeTimedOutError(result.failure.message);\n        throw new RuntimeExecutionError(result.failure.message);\n      }\n      const candidates = await candidateSession.collect();\n      return {\n        provider: result.output.provider,`;
  const replacement = `      if (result.status === 'cancelled')\n        return {\n          status: 'cancelled',\n          workspaceBinding,\n          sessionBinding,\n        };\n      if (result.status === 'failed')\n        return {\n          status: 'failed',\n          failure: result.failure,\n          workspaceBinding,\n          sessionBinding,\n        };\n      const candidates = await candidateSession.collect();\n      return {\n        status: 'completed',\n        provider: result.output.provider,`;
  if (!source.includes(expectedBlock)) throw new Error('expected-result block missing');
  source = source.replace(expectedBlock, replacement);
  const compatMarker = `    if (input.operation === 'create' && input.onProviderBinding)`;
  const compatIndex = source.indexOf(compatMarker);
  if (compatIndex < 0) throw new Error('compat result marker missing');
  source = source.slice(0, compatIndex) + `    if (outcome.status === 'cancelled')\n      throw new RuntimeExecutionError('The runtime execution was cancelled.');\n    if (outcome.status === 'failed') {\n      if (outcome.failure.code === 'runtime_timeout')\n        throw new RuntimeTimedOutError(outcome.failure.message);\n      throw new RuntimeExecutionError(outcome.failure.message);\n    }\n` + source.slice(compatIndex);
  return source;
});

await edit('src/application/runs/execute-run.ts', (source) => {
  source = source.replace(
    `  ExecutionRuntimeService,\n  ExecutionTurnOutcome,`,
    `  ExecutionRuntimeService,\n  ExecutionTurnResult,`,
  );
  source = source.replace(
    `    let execution: ExecutionTurnOutcome | undefined;`,
    `    let execution: ExecutionTurnResult | undefined;`,
  );
  const marker = `    if (!execution) throw new Error('Runtime execution returned no result.');\n    const candidateInputs = (`;
  if (!source.includes(marker)) throw new Error('execute-run result marker missing');
  source = source.replace(
    marker,
    `    if (!execution) throw new Error('Runtime execution returned no result.');\n    if (execution.status === 'cancelled')\n      throw new Error('The runtime execution was cancelled.');\n    if (execution.status === 'failed') {\n      if (execution.failure.code === 'runtime_timeout')\n        throw new RuntimeTimedOutError(execution.failure.message);\n      throw new Error(execution.failure.message);\n    }\n    const candidateInputs = (`,
  );
  return source;
});

await edit('tests/fixtures/fake-agent-runtime.ts', (source) => {
  source = source.replaceAll('ExecutionTurnOutcome', 'CompletedExecutionTurn');
  source = source.replace(
    `  ExecutionRuntimeService,\n  CompletedExecutionTurn,`,
    `  CompletedExecutionTurn,\n  ExecutionRuntimeService,`,
  );
  source = source.replace(
    `    return {\n      provider: execution.provider,`,
    `    return {\n      status: 'completed',\n      provider: execution.provider,`,
  );
  return source;
});
