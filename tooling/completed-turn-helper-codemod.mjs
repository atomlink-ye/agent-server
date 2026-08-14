import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`No changes for ${path}`);
  await writeFile(path, next);
}

await edit('src/application/runtime/execution-plane-runtime-facade.ts', (source) => {
  const interfaceAnchor = `  executeTurn(\n    input: ExecutionTurnRequest,\n    observer?: ExecutionObservationSink,\n  ): Promise<ExecutionTurnResult>;`;
  if (!source.includes(interfaceAnchor)) throw new Error('service executeTurn interface missing');
  source = source.replace(
    interfaceAnchor,
    `${interfaceAnchor}\n  executeCompletedTurn(\n    input: ExecutionTurnRequest,\n    observer?: ExecutionObservationSink,\n  ): Promise<CompletedExecutionTurn>;`,
  );
  const methodAnchor = `  public async cancelRun(input: {`;
  if (!source.includes(methodAnchor)) throw new Error('cancelRun method anchor missing');
  source = source.replace(
    methodAnchor,
    `  public async executeCompletedTurn(\n    input: ExecutionTurnRequest,\n    observer?: ExecutionObservationSink,\n  ): Promise<CompletedExecutionTurn> {\n    const result = await this.executeTurn(input, observer);\n    if (result.status === 'completed') return result;\n    if (result.status === 'failed')\n      throw new Error(\n        \`Execution Turn failed (\${result.failure.code}): \${result.failure.message}\`,\n      );\n    throw new Error('Execution Turn was cancelled.');\n  }\n\n${methodAnchor}`,
  );
  return source;
});

for (const path of [
  'src/application/channels/synthesize-memory-document.ts',
  'src/application/channels/accept-memory-from-bound-document.ts',
]) {
  await edit(path, (source) => {
    if (!source.includes('this.runtime.executeTurn('))
      throw new Error(`channel executeTurn anchor missing: ${path}`);
    return source.replaceAll(
      'this.runtime.executeTurn(',
      'this.runtime.executeCompletedTurn(',
    );
  });
}

await edit('tests/fixtures/fake-agent-runtime.ts', (source) => {
  const methodAnchor = `  public armExecutionGate(runId?: string): {`;
  if (!source.includes(methodAnchor)) throw new Error('fake runtime helper anchor missing');
  return source.replace(
    methodAnchor,
    `  public async executeCompletedTurn(\n    input: ExecutionTurnRequest,\n    observer?: ExecutionObservationSink,\n  ): Promise<CompletedExecutionTurn> {\n    const result = await this.executeTurn(input, observer);\n    if (result.status !== 'completed')\n      throw new Error('Fake execution did not complete.');\n    return result;\n  }\n\n${methodAnchor}`,
  );
});
