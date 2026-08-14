import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/runs/execute-run.ts';
let source = await readFile(path, 'utf8');
source = source.replace(
  `import { RuntimeTimedOutError } from '../ports/agent-runtime.js';\n`,
  '',
);
const block = `    if (execution.status === 'cancelled')\n      throw new Error('The runtime execution was cancelled.');\n    if (execution.status === 'failed') {\n      if (execution.failure.code === 'runtime_timeout')\n        throw new RuntimeTimedOutError(execution.failure.message);\n      throw new Error(execution.failure.message);\n    }`;
if (!source.includes(block)) throw new Error('execution result throw block missing');
source = source.replace(
  block,
  `    if (execution.status === 'cancelled')\n      return transitionRun(\n        claim.run,\n        'cancelled',\n        {\n          error: {\n            code: 'cancelled',\n            message: 'The runtime execution was cancelled.',\n          },\n        },\n        this.now,\n      );\n    if (execution.status === 'failed') {\n      const failure: RunFailure = {\n        code: execution.failure.code,\n        message: execution.failure.message,\n      };\n      return transitionRun(\n        claim.run,\n        execution.failure.code === 'runtime_timeout' ? 'timed_out' : 'failed',\n        { error: failure },\n        this.now,\n      );\n    }`,
);
source = source.replace(
  /\n\s*if \(error instanceof RuntimeTimedOutError\) \{[\s\S]*?\n\s*}\n(?=\s*const failure|\s*completed =|\s*throw|\s*this\.)/,
  '\n',
);
if (source.includes('RuntimeTimedOutError'))
  throw new Error('RuntimeTimedOutError remains in ExecuteRun');
await writeFile(path, source);
