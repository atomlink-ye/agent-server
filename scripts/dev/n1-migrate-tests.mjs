import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, fn) {
  const before = await readFile(path, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`N1 codemod made no change to ${path}`);
  await writeFile(path, after);
}

function mustReplace(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`N1 codemod missing ${label}`);
  return source.replace(search, replacement);
}

await edit('tests/fixtures/create-test-app.ts', (source) => {
  source = source.replace(
    "import { ResolveAgentVersion } from '../../src/application/agents/resolve-agent-version.js';\n",
    '',
  );
  source = source.replace(
    "import { createAgentDefinition } from '../../src/domain/invokables/agent-definition.js';\nimport {\n  createDraftAgentVersion,\n  publishAgentVersion,\n} from '../../src/domain/invokables/agent-version.js';\n",
    '',
  );
  source = source.replace(
    "import { createManagedAgentDefinition } from '../../src/domain/agents/managed-agent-definition.js';\nimport { parseManagedAgentPackage } from '../../src/domain/agents/managed-agent-package.js';\nimport {\n  createManagedAgentDraft,\n  publishManagedAgentVersion,\n} from '../../src/domain/agents/managed-agent-version.js';\n",
    '',
  );
  source = mustReplace(
    source,
    "import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';\n",
    "import { PostgresAgentRegistry } from '../../src/infrastructure/postgres/postgres-agent-registry.js';\nimport { canonicalAgentResolver, seedCanonicalPublishedAgent } from './canonical-agent.js';\n",
    'create-test-app canonical helper import',
  );
  source = mustReplace(
    source,
    `  const resolveAgentVersion = new ResolveAgentVersion(\n    agentRegistry,\n    invokableRepository,\n    { resolve: async () => null },\n  );`,
    `  const resolveAgentVersion = canonicalAgentResolver(repositoryDatabase);`,
    'create-test-app resolver',
  );
  source = source.replace(
    /  if \(options\.seedManagedAgent\)[\s\S]*?  else\n    await seedDefaultPublishedAgent\([\s\S]*?\n    \);/,
    `  await seedDefaultPublishedAgent(\n    repositoryDatabase,\n    options.workspaceId ?? testConfig.serviceAccounts[0].workspaceId,\n    options.publishedAgentVersionId,\n  );`,
  );
  source = source.replace(
    /async function seedDefaultPublishedAgent\([\s\S]*$/,
    `async function seedDefaultPublishedAgent(\n  database: TestDatabase,\n  workspaceId: string,\n  versionId = defaultPublishedAgentVersionId,\n): Promise<void> {\n  await seedCanonicalPublishedAgent(\n    database as any,\n    {\n      tenantId: 'tenant_alpha',\n      workspaceId,\n      principalType: 'service_account',\n      principalId: 'svc_enabled',\n      policySnapshotVersion: 'policy-2026-07-22',\n    },\n    {\n      definitionId:\n        versionId === defaultPublishedAgentVersionId\n          ? '00000000-0000-4000-8000-0000000a0001'\n          : randomUUID(),\n      versionId,\n      name: 'Default Task Agent',\n      description: 'Seeded canonical managed test Agent',\n      instructions: 'Do the task.',\n      now: new Date('2026-07-22T12:00:00.000Z'),\n    },\n  );\n}\n`,
  );
  return source;
});

await edit('tests/integration/session-lane-postgres.integration.impl.ts', (source) =>
  mustReplace(
    source,
    `          },\n          invokables,\n          { resolve: async () => null },\n        ),`,
    `          },\n          { resolve: async () => null },\n        ),`,
    'session-lane canonical resolver',
  ),
);

await edit('tests/integration/agent-registry-postgres.integration.impl.ts', (source) => {
  source = source.replace(
    /  it\('keeps legacy definition repository upserts mutable',[\s\S]*?\n  \}\);\n\n(?=  it\.each)/,
    '',
  );
  source = source.replace(
    /  it\('prevents repository upsert from mutating a managed definition',[\s\S]*?\n  \}\);\n\n(?=  it\('rejects legacy-to-managed)/,
    '',
  );
  return source;
});

await edit('tests/integration/durable-kernel-postgres.integration.test.ts', (source) => {
  const anchor = "import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';\n";
  if (source.includes(anchor) && !source.includes("../fixtures/canonical-agent.js")) {
    source = source.replace(
      anchor,
      `${anchor}import { canonicalAgentResolver, seedCanonicalPublishedAgent } from '../fixtures/canonical-agent.js';\n`,
    );
  }
  let occurrence = 0;
  source = source.replace(
    /    const invokables = new PostgresInvokableRepository\(database\);\n    const createdAt[\s\S]*?    await invokables\.saveAgentVersion\(agentVersion\);/g,
    () => {
      occurrence += 1;
      if (occurrence === 1)
        return `    const invokables = new PostgresInvokableRepository(database);\n    const { version: agentVersion } = await seedCanonicalPublishedAgent(\n      database,\n      primaryAccessContext,\n      {\n        definitionId: '00000000-0000-4000-8000-000000030001',\n        versionId: '00000000-0000-4000-8000-000000030101',\n        name: 'Task Agent',\n        description: 'Used for canonical task invoke',\n        instructions: 'Do the task.',\n        now: new Date('2026-07-22T12:00:00.000Z'),\n      },\n    );`;
      return `    const invokables = new PostgresInvokableRepository(database);\n    const { version: agentVersion } = await seedCanonicalPublishedAgent(\n      database,\n      primaryAccessContext,\n      {\n        definitionId: '00000000-0000-4000-8000-000000040001',\n        versionId: '00000000-0000-4000-8000-000000040101',\n        name: 'Canonical Agent',\n        description: 'Executes through the task path',\n        instructions: 'Reply with the analyzed result only.',\n        now: new Date('2026-07-22T12:00:00.000Z'),\n      },\n    );`;
    },
  );
  if (occurrence !== 2) throw new Error(`expected 2 durable Agent seed blocks, got ${occurrence}`);
  source = source.replace(
    /new InvokeTask\(\n      admissions,\n      invokables,\n      (\(\) => new Date\('[^']+'\)|clock\.now),\n    \)/g,
    (_m, clock) => `new InvokeTask(\n      admissions,\n      invokables,\n      canonicalAgentResolver(database),\n      ${clock},\n    )`,
  );
  return source;
});

await edit('tests/integration/real-pg-pool.integration.impl.ts', (source) => {
  const anchor = "import { PostgresInvokableRepository } from '../../src/infrastructure/postgres/postgres-invokable-repository.js';\n";
  if (source.includes(anchor) && !source.includes("../fixtures/canonical-agent.js")) {
    source = source.replace(
      anchor,
      `${anchor}import { canonicalAgentResolver, seedCanonicalPublishedAgent } from '../fixtures/canonical-agent.js';\n`,
    );
  }
  source = source.replace(
    /new InvokeTask\(\n      new PostgresAdmissionRepository\(pool!\),\n      new PostgresInvokableRepository\(readerPool!\),\n      \(\) => new Date\('2026-07-23T12:00:00.000Z'\),\n    \)/,
    `new InvokeTask(\n      new PostgresAdmissionRepository(pool!),\n      new PostgresInvokableRepository(readerPool!),\n      canonicalAgentResolver(readerPool!),\n      () => new Date('2026-07-23T12:00:00.000Z'),\n    )`,
  );
  source = source.replace(
    /    const invokables = new PostgresInvokableRepository\(pool!\);\n    await invokables\.saveAgentDefinition\(definition\);\n    await invokables\.saveAgentVersion\(version\);/g,
    `    const invokables = new PostgresInvokableRepository(pool!);\n    await seedCanonicalPublishedAgent(pool!, sessionOwner, {\n      definitionId: definition.id,\n      versionId: version.id,\n      name: definition.name,\n      description: definition.description ?? 'Canonical fixture',\n      instructions: version.instructions,\n      now: new Date('2026-07-23T11:00:00.000Z'),\n    });`,
  );
  // The first global fixture has a different owner variable and is migrated below.
  source = source.replace(
    /    await invokables\.saveAgentDefinition\(agentDefinition\);\n    await invokables\.saveAgentVersion\(agentVersion\);/g,
    `    await seedCanonicalPublishedAgent(pool!, owner, {\n      definitionId: agentDefinition.id,\n      versionId: agentVersion.id,\n      name: agentDefinition.name,\n      description: agentDefinition.description ?? 'Canonical fixture',\n      instructions: agentVersion.instructions,\n      now: new Date('2026-07-23T11:00:00.000Z'),\n    });`,
  );
  source = source.replace(
    `      new BarrierInvokableRepository(readerPool!, createTwoPartyBarrier()),\n      () => new Date('2026-07-23T12:00:00.000Z'),`,
    `      new PostgresInvokableRepository(readerPool!),\n      barrierAgentResolver(readerPool!, createTwoPartyBarrier()),\n      () => new Date('2026-07-23T12:00:00.000Z'),`,
  );
  source = source.replace(
    /class BarrierInvokableRepository extends PostgresInvokableRepository \{[\s\S]*?\n\}\n\n(?=function createTwoPartyBarrier)/,
    `function barrierAgentResolver(\n  database: NonNullable<typeof readerPool>,\n  arrive: () => Promise<void>,\n) {\n  const resolver = canonicalAgentResolver(database);\n  return {\n    async resolvePublished(\n      ...args: Parameters<typeof resolver.resolvePublished>\n    ) {\n      const value = await resolver.resolvePublished(...args);\n      await arrive();\n      return value;\n    },\n  };\n}\n\n`,
  );
  return source;
});

console.log('N1 test migration codemod complete');
