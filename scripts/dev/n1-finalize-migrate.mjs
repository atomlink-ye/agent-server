import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, fn) {
  const before = await readFile(path, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`N1 final codemod made no change to ${path}`);
  await writeFile(path, after);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`N1 final codemod missing ${label}`);
  return source.replace(search, replacement);
}

await edit('src/entrypoints/api/app.ts', (source) => {
  source = replaceOnce(
    source,
    "import type { InvokableRepository } from '../../application/ports/invokable-repository.js';\n",
    "import type { InvokableRepository } from '../../application/ports/invokable-repository.js';\nimport type { AgentResolutionApi } from '../../application/ports/agent-resolution-api.js';\n",
    'app AgentResolutionApi import',
  );
  source = replaceOnce(
    source,
    '  readonly invokableRepository?: InvokableRepository;\n',
    '  readonly invokableRepository?: InvokableRepository;\n  /** Legacy fixture composition only; production resourceModule owns this seam. */\n  readonly agentResolution?: AgentResolutionApi;\n',
    'app agentResolution dependency',
  );
  source = replaceOnce(
    source,
    `    if (dependencies.invokableRepository && dependencies.environmentRegistry)\n      registerTeamRoutes(app, {\n        config: dependencies.config,\n        invokableRepository: dependencies.invokableRepository,\n        environmentRegistry: dependencies.environmentRegistry,\n      });`,
    `    if (\n      dependencies.invokableRepository &&\n      dependencies.environmentRegistry &&\n      dependencies.agentResolution\n    )\n      registerTeamRoutes(app, {\n        config: dependencies.config,\n        invokableRepository: dependencies.invokableRepository,\n        agentResolution: dependencies.agentResolution,\n        environmentRegistry: dependencies.environmentRegistry,\n      });`,
    'app Team route composition',
  );
  return source;
});

await edit('tests/fixtures/create-test-app.ts', (source) =>
  replaceOnce(
    source,
    '    agentRegistry,\n    sessions,\n',
    '    agentRegistry,\n    agentResolution: resolveAgentVersion,\n    sessions,\n',
    'test app canonical resolver dependency',
  ),
);

await edit('tests/integration/real-pg-pool.integration.impl.ts', (source) => {
  source = source.replace(
    "import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';\nimport {\n  createDraftAgentVersion,\n  publishAgentVersion,\n} from '../../src/domain/invokables/agent-version.js';\n",
    '',
  );
  source = replaceOnce(
    source,
    `        new PostgresInvokableRepository(readerPool!),\n        () => new Date('2026-07-23T12:00:00.000Z'),`,
    `        new PostgresInvokableRepository(readerPool!),\n        canonicalAgentResolver(readerPool!),\n        () => new Date('2026-07-23T12:00:00.000Z'),`,
    'real-pg canonical invoke resolver',
  );
  source = source.replace(
    /    const definition = createAgentDefinition\(\{\n      id: agentDefinitionId,[\s\S]*?    await invokables\.saveAgentVersion\(version\);/,
    `    await seedCanonicalPublishedAgent(pool, owner, {\n      definitionId: agentDefinitionId,\n      versionId: agentVersionId,\n      name: 'Real PostgreSQL admission agent',\n      description: 'Admission integration fixture',\n      instructions: 'Return the input unchanged.',\n      now: new Date('2026-07-23T11:00:00.000Z'),\n    });`,
  );
  source = source.replace(
    /    const definition = createAgentDefinition\(\{\n      id: crypto\.randomUUID\(\),\n      \.\.\.sessionOwner,[\s\S]*?    await seedCanonicalPublishedAgent\(pool!, sessionOwner, \{[\s\S]*?    \}\);/,
    `    const { version } = await seedCanonicalPublishedAgent(pool!, sessionOwner, {\n      definitionId: crypto.randomUUID(),\n      versionId: crypto.randomUUID(),\n      name: 'Task 6 real PG agent',\n      description: 'Task 6 fixture',\n      instructions: 'Return the input unchanged.',\n      now: new Date('2026-07-23T11:00:00.000Z'),\n    });`,
  );
  if (/\bcreateAgentDefinition\b|\bcreateDraftAgentVersion\b|\bsaveAgentDefinition\b|\bsaveAgentVersion\b/u.test(source)) {
    throw new Error('real-pg still contains legacy Agent fixture construction');
  }
  return source;
});

console.log('N1 final convergence codemod complete');
