import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after);
}
function exact(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Missing ${label}`);
  return source.replace(from, to);
}

await edit('src/application/ports/team-execution-repository.ts', (source) =>
  exact(
    source,
    `  findLatestAgenticTeamRun(\n    owner: OwnerScope,\n    rootTaskId?: string,\n  ): Promise<TeamRun | null>;`,
    `  findLatestAgenticTeamRun(\n    owner: OwnerScope,\n    rootTaskId?: string,\n  ): Promise<TeamRun | null>;\n  /** Durable recovery scan used by the provider-neutral activation reconciler. */\n  listActiveTeamRunRoots?(): Promise<\n    readonly { readonly rootTaskId: string; readonly owner: OwnerScope }[]\n  >;`,
    'active Team roots port',
  ),
);

await edit('src/infrastructure/postgres/postgres-collaborative-team-repository.ts', (source) => {
  source = source.replaceAll('ORDER BY created_at`', 'ORDER BY created_at,id`');
  source = exact(
    source,
    '  public async completeTeamRunAtomically(input: {',
    `  public async listActiveTeamRunRoots() {\n    const result = await this.database.query<{\n      root_task_id: string;\n      tenant_id: string;\n      workspace_id: string;\n      principal_type: string;\n      principal_id: string;\n    }>(\n      \`SELECT root_task_id,tenant_id,workspace_id,principal_type,principal_id\n         FROM team_runs WHERE status='active' ORDER BY created_at,id\`,\n    );\n    return (result.rows ?? []).map((row) => ({\n      rootTaskId: row.root_task_id,\n      owner: {\n        tenantId: row.tenant_id,\n        workspaceId: row.workspace_id,\n        principalType: row.principal_type,\n        principalId: row.principal_id,\n      },\n    }));\n  }\n\n  public async completeTeamRunAtomically(input: {`,
    'active Team roots postgres implementation',
  );
  return source;
});

await edit('src/application/collaboration/collaboration-kernel.ts', (source) => {
  source = exact(
    source,
    "import type { TeamWakeReconciler } from '../teams/team-wake-reconciler.js';",
    "import type { CollaborationActivationKick } from './collaboration-activation-reconciler.js';",
    'kernel wake import',
  );
  source = exact(
    source,
    "    private readonly wake?: Pick<TeamWakeReconciler, 'reconcileForRootTask'>,",
    '    private readonly activation?: CollaborationActivationKick,',
    'kernel wake dependency',
  );
  source = source.replaceAll(
    'await this.wake?.reconcileForRootTask(context.teamRun.rootTaskId, context.owner);',
    'this.activation?.kick(context.teamRun.rootTaskId, context.owner, context.task);',
  );
  source = exact(
    source,
    `    const item = await this.journal.createOpenWork({\n      teamRunId: context.teamRun.id,\n      createdByMemberId: context.member.id,\n      sourceTaskId: context.task.id,\n      sourceRunId: context.run.id,\n      subject,\n      description,\n      dependsOnWorkItemIds: dependencyIds,\n      commandHash: commandHash('board_create_open', input),\n      expectedRevision: context.teamRun.revision,\n      owner: context.owner,\n    });\n    return {`,
    `    const item = await this.journal.createOpenWork({\n      teamRunId: context.teamRun.id,\n      createdByMemberId: context.member.id,\n      sourceTaskId: context.task.id,\n      sourceRunId: context.run.id,\n      subject,\n      description,\n      dependsOnWorkItemIds: dependencyIds,\n      commandHash: commandHash('board_create_open', input),\n      expectedRevision: context.teamRun.revision,\n      owner: context.owner,\n    });\n    this.activation?.kick(context.teamRun.rootTaskId, context.owner, context.task);\n    return {`,
    'open work activation kick',
  );
  source = exact(
    source,
    `    await this.executions.acceptWork({\n      teamRunId: context.teamRun.id,\n      workItemId: item.id,\n      sourceRunId: context.run.id,\n      leadTaskId: context.task.id,\n      commandHash: commandHash('board_accept', input),\n      expectedRevision: context.teamRun.revision,\n      owner: context.owner,\n    });\n    return { work_ref: input.workRef, status: 'accepted' };`,
    `    await this.executions.acceptWork({\n      teamRunId: context.teamRun.id,\n      workItemId: item.id,\n      sourceRunId: context.run.id,\n      leadTaskId: context.task.id,\n      commandHash: commandHash('board_accept', input),\n      expectedRevision: context.teamRun.revision,\n      owner: context.owner,\n    });\n    this.activation?.kick(context.teamRun.rootTaskId, context.owner, context.task);\n    return { work_ref: input.workRef, status: 'accepted' };`,
    'accept activation kick',
  );
  source = exact(
    source,
    `    const messages = await this.allMessages(context);\n    const items = await this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner);\n    return messages`,
    `    const messages = await this.allMessages(context);\n    const [items, members] = await Promise.all([\n      this.executions.findWorkItemsByTeamRunId(context.teamRun.id, context.owner),\n      this.executions.findMembersByTeamRunId(context.teamRun.id, context.owner),\n    ]);\n    const participantNameById = new Map(\n      members.map((member) => [member.id, member.name]),\n    );\n    return messages`,
    'inbox participant map',
  );
  source = exact(
    source,
    '        from: message.senderMemberRunId,',
    `        from: message.senderMemberRunId\n          ? participantNameById.get(message.senderMemberRunId) ?? 'participant'\n          : 'system',`,
    'logical inbox sender',
  );
  return source;
});

await edit('src/bootstrap.ts', (source) => {
  source = exact(
    source,
    "import { createLegacyRuntimeToolsContributor } from './entrypoints/mcp/runtime-tool-contributors.js';",
    `import {\n  createCollaborationRuntimeContributor,\n  createSyntheticRuntimeToolsContributor,\n} from './entrypoints/mcp/runtime-tool-contributors.js';`,
    'bootstrap contributor import',
  );
  source = source
    .replace("import { PostgresTeamExecutionRepository } from './infrastructure/postgres/postgres-collaborative-team-repository.js';\n", '')
    .replace("import { PostgresTeamMessageRepository } from './infrastructure/postgres/postgres-team-message-repository.js';\n", '')
    .replace("import { TeamWakeReconciler } from './application/teams/team-wake-reconciler.js';\n", '');
  source = exact(
    source,
    `    events,\n    logger,\n  });`,
    `    events,\n    logger,\n    deferActivationKick: options.deferTeamWakeReconcile,\n  });`,
    'team module options',
  );
  source = exact(
    source,
    `    contextResolver: teamToolContextResolver,\n    wakeReconciler: teamWakeReconciler,\n    commands: teamCommandService,\n  } = teamModule;`,
    `    contextResolver: teamToolContextResolver,\n    activationReconciler: collaborationActivationReconciler,\n    collaboration,\n  } = teamModule;`,
    'team module destructure',
  );
  source = exact(
    source,
    `      createLegacyRuntimeToolsContributor({\n        teamTools: {\n          contextResolver: teamToolContextResolver,\n          commands: teamCommandService,\n        },\n        market: new SyntheticMarketAdapter(),\n        logger,\n      }),`,
    `      createCollaborationRuntimeContributor({\n        contextResolver: teamToolContextResolver,\n        kernel: collaboration,\n      }),\n      createSyntheticRuntimeToolsContributor({\n        market: new SyntheticMarketAdapter(),\n        logger,\n      }),`,
    'runtime contributor composition',
  );
  source = exact(
    source,
    `  const terminalWakeReconciler = options.deferTeamWakeReconcile\n    ? {\n        reconcileForRootTask: async () => 0,\n      }\n    : teamWakeReconciler;`,
    `  const terminalActivationReconciler = options.deferTeamWakeReconcile\n    ? undefined\n    : collaborationActivationReconciler;`,
    'terminal activation seam',
  );
  source = source.replaceAll('terminalWakeReconciler', 'terminalActivationReconciler');
  source = source.replaceAll('teamWakeReconciler.reconcileQueuedWakeRoots()', 'collaborationActivationReconciler.reconcilePendingRoots()');
  source = source.replaceAll('teamWakeReconciler.reconcileForRootTask', 'collaborationActivationReconciler.reconcileForRootTask');
  const oldDebug = `          rebuildQueuedTeamWakes: () =>\n            new TeamWakeReconciler(\n              new PostgresTeamMessageRepository(pool),\n              new PostgresTeamExecutionRepository(pool),\n              new PostgresTaskRepository(pool),\n              new PostgresAdmissionRepository(pool),\n              undefined,\n              logger,\n            ).reconcileQueuedWakeRoots(),`;
  if (source.includes(oldDebug)) {
    source = source.replace(
      oldDebug,
      `          rebuildQueuedTeamWakes: () =>\n            collaborationActivationReconciler.reconcilePendingRoots(),`,
    );
  }
  return source;
});

await edit('src/application/runs/execution-observation-payload.ts', (source) => {
  source = exact(
    source,
    `import {\n  canonicalTeamMcpName,\n  canonicalTeamMcpRefForName,\n} from '../agents/built-in-skills.js';`,
    `import {\n  collaborationMcpName,\n  collaborationMcpRefForName,\n} from '../../domain/collaboration/canonical-collaboration-tools.js';`,
    'observation classifier import',
  );
  return source
    .replaceAll('canonicalTeamToolName', 'collaborationToolName')
    .replaceAll('canonicalTeamToolRef', 'collaborationToolRef')
    .replaceAll('canonicalTeamMcpName', 'collaborationMcpName')
    .replaceAll('canonicalTeamMcpRefForName', 'collaborationMcpRefForName')
    .replaceAll('authorizedTeamTool', 'authorizedCollaborationTool')
    .replaceAll("provenance: 'server_authorized_team_mcp_catalog'", "provenance: 'server_authorized_collaboration_mcp_catalog'");
});

console.log('collaboration activation convergence codemod applied');
