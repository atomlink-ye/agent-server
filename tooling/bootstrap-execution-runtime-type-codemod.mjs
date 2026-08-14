import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/bootstrap.ts';
let source = await readFile(path, 'utf8');
const before = source;
source = source.replace(
  "import type { AgentRuntimePort } from './application/ports/agent-runtime.js';",
  "import type { ExecutionRuntimeService } from './application/runtime/execution-plane-runtime-facade.js';",
);
source = source.replaceAll('AgentRuntimePort', 'ExecutionRuntimeService');
if (source === before) throw new Error('bootstrap AgentRuntime type anchor missing');
if (source.includes("ports/agent-runtime.js"))
  throw new Error('bootstrap still imports AgentRuntime contract');
await writeFile(path, source);
