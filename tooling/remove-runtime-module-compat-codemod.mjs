import { readFile, writeFile } from 'node:fs/promises';

const modulePath = 'src/modules/runtime/runtime-module.ts';
let moduleSource = await readFile(modulePath, 'utf8');
moduleSource = moduleSource.replace(
  /import \{\n  isExecutionRuntimeService,\n  LegacyAgentRuntimeExecutionService,\n\} from '\.\.\/\.\.\/adapters\/runtime\/legacy-agent-runtime-execution-service\.js';\n/,
  '',
);
moduleSource = moduleSource.replace(
  /import type \{ AgentRuntimePort \} from '\.\.\/\.\.\/application\/ports\/agent-runtime\.js';\n/,
  '',
);
moduleSource = moduleSource.replace(
  /\n  \/\*\* @deprecated Temporary compatibility for the two channel memory callers\. \*\/\n  readonly runtime: AgentRuntimePort;/,
  '',
);
moduleSource = moduleSource.replace(
  '  readonly debugRuntime?: AgentRuntimePort;',
  '  readonly debugRuntime?: ExecutionRuntimeService;',
);
const selection = `  const executionRuntime: ExecutionRuntimeService = options.debugRuntime\n    ? isExecutionRuntimeService(options.debugRuntime)\n      ? options.debugRuntime\n      : new LegacyAgentRuntimeExecutionService(options.debugRuntime)\n    : productionExecutionRuntime;\n  const runtime: AgentRuntimePort = options.debugRuntime ?? productionExecutionRuntime;`;
if (!moduleSource.includes(selection)) throw new Error('runtime module compatibility selection missing');
moduleSource = moduleSource.replace(
  selection,
  `  const executionRuntime: ExecutionRuntimeService =\n    options.debugRuntime ?? productionExecutionRuntime;`,
);
moduleSource = moduleSource.replace(
  `          const health = await options.debugRuntime!.health();`,
  `          const health = await options.debugRuntime!.planeHealth();`,
);
moduleSource = moduleSource.replace(/\n    runtime,\n    executionRuntime,/, '\n    executionRuntime,');
if (moduleSource.includes('AgentRuntimePort') || moduleSource.includes('LegacyAgentRuntimeExecutionService'))
  throw new Error('runtime module legacy compatibility remains');
await writeFile(modulePath, moduleSource);

const bootstrapPath = 'src/bootstrap.ts';
let bootstrap = await readFile(bootstrapPath, 'utf8');
bootstrap = bootstrap.replace(/\n\s*runtime,\n\s*executionRuntime,/, '\n    executionRuntime,');
bootstrap = bootstrap.replaceAll('await runtime.close()', 'await executionRuntime.close()');
bootstrap = bootstrap.replaceAll('runtime.close()', 'executionRuntime.close()');
await writeFile(bootstrapPath, bootstrap);
