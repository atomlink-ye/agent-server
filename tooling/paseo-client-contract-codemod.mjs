import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/adapters/paseo/paseo-client-port.ts';
let source = await readFile(path, 'utf8');
const before = source;
source = source.replaceAll('RuntimeMcpServerConfig', 'ExecutionMcpServerConfig');
source = source.replace(
  /import type \{([^}]*)\} from '\.\.\/\.\.\/application\/ports\/agent-runtime\.js';/s,
  (_match, names) => {
    const normalized = names.replaceAll('RuntimeMcpServerConfig', 'ExecutionMcpServerConfig');
    if (/Runtime[A-Z]|AgentRuntime|AGENT_SERVER_RUNTIME/.test(normalized))
      throw new Error(`Unhandled legacy runtime import: ${normalized}`);
    return `import type {${normalized}} from '../../application/ports/execution-plane.js';`;
  },
);
if (source === before) throw new Error('Paseo client legacy contract import not found');
if (source.includes("ports/agent-runtime.js"))
  throw new Error('Paseo client still imports AgentRuntime contract');
await writeFile(path, source);
