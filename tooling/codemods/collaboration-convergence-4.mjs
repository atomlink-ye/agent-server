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

await edit('src/infrastructure/postgres/postgres-collaboration-repository.ts', (source) => {
  return exact(
    source,
    `    const unique = [...new Set(dependencyIds)];\n    if (unique.length !== dependencyIds.length)\n      throw new TeamExecutionError('invalid_transition');\n    if (!unique.length) return;`,
    `    const unique = [...new Set(dependencyIds)];\n    if (unique.length !== dependencyIds.length)\n      throw new TeamExecutionError('invalid_transition');\n    if (unique.length > COLLABORATION_LIMITS.maxDependenciesPerWorkItem)\n      throw new TeamExecutionError('limit_exceeded');\n    if (!unique.length) return;`,
    'dependency limit',
  );
});

await edit('src/application/collaboration/collaboration-kernel.ts', (source) => {
  source = source.replaceAll(
    'this.activation?.kick(context.teamRun.rootTaskId, context.owner, context.task);',
    'this.kick(context);',
  );
  return exact(
    source,
    `  private async allMessages(context: TeamToolContext) {`,
    `  private kick(context: TeamToolContext): void {\n    // Durable mutation success must never depend on the immediate delivery\n    // attempt. The reconciler is restart-safe and will recompute from facts.\n    try {\n      this.activation?.kick(\n        context.teamRun.rootTaskId,\n        context.owner,\n        context.task,\n      );\n    } catch {\n      // A synchronous kick failure is intentionally non-fatal.\n    }\n  }\n\n  private async allMessages(context: TeamToolContext) {`,
    'kernel safe kick helper',
  );
});

await edit('src/application/collaboration/collaboration-activation-reconciler.ts', (source) => {
  source = exact(
    source,
    `    const senderNameById = new Map(\n      members.map((member) => [member.id, member.name]),\n    );\n\n    const lead = members.find((member) => member.role === 'lead');`,
    `    const senderNameById = new Map(\n      members.map((member) => [member.id, member.name]),\n    );\n    const taskRecords = this.tasks.findByRootTaskIdForOwner\n      ? await this.tasks.findByRootTaskIdForOwner(team.rootTaskId, owner)\n      : [];\n\n    const lead = members.find((member) => member.role === 'lead');`,
    'reconciler task records',
  );
  source = exact(
    source,
    `    const openActionable = orderedWorkItems(workItems).find(\n      (item) =>\n        item.status === 'open' &&\n        dependencies\n          .filter((edge) => edge.workItemId === item.id)\n          .every(\n            (edge) =>\n              workItems.find(\n                (candidate) => candidate.id === edge.dependsOnWorkItemId,\n              )?.status === 'accepted',\n          ),\n    );`,
    `    const openActionable = orderedWorkItems(workItems).find((item) => {\n      if (item.status !== 'open') return false;\n      if (\n        !dependencies\n          .filter((edge) => edge.workItemId === item.id)\n          .every(\n            (edge) =>\n              workItems.find(\n                (candidate) => candidate.id === edge.dependsOnWorkItemId,\n              )?.status === 'accepted',\n          )\n      )\n        return false;\n      const discoveryToken = \`available:\${item.id}:\${item.updatedAt}\`;\n      return !taskRecords.some((record) =>\n        record.task.logicalStepKey?.includes(discoveryToken),\n      );\n    });`,
    'single work discovery',
  );
  source = exact(
    source,
    `    const memberCandidates = members\n      .filter((member) => member.role === 'member' && isIdle(member))`,
    `    const memberCandidates = members\n      .filter(\n        (member) =>\n          member.role === 'member' &&\n          isIdle(member) &&\n          !taskRecords.some(\n            (record) =>\n              record.task.teamMemberRunId === member.id &&\n              !['completed', 'failed', 'cancelled'].includes(\n                record.task.status,\n              ),\n          ),\n      )`,
    'member active task guard',
  );
  return source;
});

console.log('durable activation fixes applied');
