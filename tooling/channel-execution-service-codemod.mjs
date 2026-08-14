import { readFile, writeFile } from 'node:fs/promises';

async function migrateChannel(path, mode) {
  let source = await readFile(path, 'utf8');
  const before = source;
  source = source.replace(
    "import type { AgentRuntimePort } from '../ports/agent-runtime.js';",
    "import type { ExecutionRuntimeService } from '../runtime/execution-plane-runtime-facade.js';",
  );
  source = source.replaceAll('AgentRuntimePort', 'ExecutionRuntimeService');
  source = source.replaceAll('this.runtime.execute(', 'this.runtime.executeTurn(');
  source = source.replace(/\s*operation:\s*'create',\n/g, '\n');
  source = source.replace(/\s*operation:\s*'continue',\n/g, '\n');
  if (mode === 'continue') {
    source = source.replace(
      /\n(\s*)providerAgentId,\n/g,
      "\n$1compatibilitySessionBinding: {\n$1  plane: 'paseo',\n$1  externalSessionId: providerAgentId,\n$1},\n",
    );
  }
  if (source === before) throw new Error(`No channel migration changes for ${path}`);
  if (source.includes('AgentRuntimePort') || source.includes("operation: 'create'") || source.includes("operation: 'continue'"))
    throw new Error(`Legacy runtime contract remains in ${path}`);
  await writeFile(path, source);
}

await migrateChannel(
  'src/application/channels/synthesize-memory-document.ts',
  'create',
);
await migrateChannel(
  'src/application/channels/accept-memory-from-bound-document.ts',
  'continue',
);

const bootstrapPath = 'src/bootstrap.ts';
let bootstrap = await readFile(bootstrapPath, 'utf8');
for (const className of [
  'SynthesizeMemoryDocument',
  'AcceptMemoryFromBoundDocument',
]) {
  const pattern = new RegExp(`(new ${className}\\([\\s\\S]*?)(\\bruntime\\b)([\\s\\S]*?\\))`);
  if (!pattern.test(bootstrap))
    throw new Error(`Bootstrap ${className} runtime anchor missing`);
  bootstrap = bootstrap.replace(pattern, '$1executionRuntime$3');
}
await writeFile(bootstrapPath, bootstrap);
