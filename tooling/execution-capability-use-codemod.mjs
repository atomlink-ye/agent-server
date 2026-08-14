import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/application/runtime/execution-session-resolver.ts';
let source = await readFile(path, 'utf8');
const importAnchor = `import { ExecutionSessionResolver`;
if (source.includes(importAnchor)) throw new Error('unexpected self import');
const firstImportEnd = source.indexOf("from '../ports/execution-plane.js';");
if (firstImportEnd < 0) throw new Error('execution plane import missing');
const lineEnd = source.indexOf('\n', firstImportEnd);
source = source.slice(0, lineEnd + 1) +
  `import { requirePlaneCapability } from './execution-capabilities.js';\n` +
  source.slice(lineEnd + 1);
const boundAnchor = `    if (runtime.sessionBinding) {\n      if (!runtime.workspaceBinding)`;
if (!source.includes(boundAnchor)) throw new Error('bound session anchor missing');
source = source.replace(
  boundAnchor,
  `    if (runtime.sessionBinding) {\n      requirePlaneCapability(this.plane.capabilities(), 'reusable_session');\n      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');\n      if (!runtime.workspaceBinding)`,
);
const createAnchor = `    const created = await this.plane.createSession(spec);`;
if (!source.includes(createAnchor)) throw new Error('create anchor missing');
source = source.replace(
  createAnchor,
  `    if (effectiveWorkspaceBinding)\n      requirePlaneCapability(this.plane.capabilities(), 'external_workspace');\n    const created = await this.plane.createSession(spec);`,
);
await writeFile(path, source);
