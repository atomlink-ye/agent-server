import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/runtime/execution-plane-runtime-facade.ts';
let source = await readFile(path, 'utf8');
source = source.replace(
  /import \{[\s\S]*?\} from '\.\.\/ports\/agent-runtime\.js';\n/,
  `import type { RunUsage } from '../../domain/runs/run.js';\n`,
);
source = source.replaceAll("AgentRuntimeExecution['usage']", 'RunUsage');
source = source.replace(
  `export class ExecutionPlaneRuntimeFacade\n  implements ExecutionRuntimeService, AgentRuntimePort\n{`,
  `export class ExecutionPlaneRuntimeFacade implements ExecutionRuntimeService {`,
);
source = source.replace('await this.initialize();', 'await this.#initialize();');
source = source.replace(
  '  public async initialize(): Promise<void> {',
  '  async #initialize(): Promise<void> {',
);
const executeStart = source.indexOf('  public async execute(\n');
const helperStart = source.indexOf('\nfunction compatibilityObservationSink', executeStart);
if (executeStart < 0 || helperStart < 0)
  throw new Error('AgentRuntime facade compatibility block missing');
source = source.slice(0, executeStart) + '}\n';
if (/AgentRuntime|RuntimeExecutionError|RuntimeTimedOutError|RuntimeEventSink|RuntimeEvent/.test(source))
  throw new Error('AgentRuntime compatibility remains in ExecutionPlaneRuntimeFacade');
await writeFile(path, source);
