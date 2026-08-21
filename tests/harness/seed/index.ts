import { randomUUID } from 'node:crypto';

import type { SeedDatabase } from './types.js';
import { seedPublishedAgentVersion } from './agent.js';
import { seedConversation } from './conversation.js';
import { seedEnvironmentVersion } from './environment.js';
import { seedPublishedTeamVersion } from './team.js';
import { seedActiveTask, seedPublishedWorkDefinition } from './work.js';
import { seedWorkspace } from './workspace.js';

export {
  seedActiveTask,
  seedPublishedAgentVersion,
  seedConversation,
  seedEnvironmentVersion,
  seedPublishedTeamVersion,
  seedPublishedWorkDefinition,
  seedWorkspace,
};
export type { HarnessOwner, SeedDatabase } from './types.js';

export async function seedGoldenPathWorld(
  db: SeedDatabase,
  options: {
    readonly tenantId?: string;
    readonly principalId?: string;
    readonly name?: string;
  } = {},
) {
  const owner = await seedWorkspace(db, {
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    ...(options.principalId !== undefined
      ? { principalId: options.principalId }
      : {}),
    name: `${options.name ?? 'Golden Path'} Workspace`,
  });
  const environment = await seedEnvironmentVersion(db, owner, {
    name: `${options.name ?? 'Golden Path'} Environment`,
  });
  const agent = await seedPublishedAgentVersion(db, owner, {
    name: `${options.name ?? 'Golden Path'} Agent`,
  });
  const team = await seedPublishedTeamVersion(db, owner, {
    environmentVersionId: environment.versionId,
    agentVersionId: agent.versionId,
    name: `${options.name ?? 'Golden Path'} Team`,
  });
  const conversation = await seedConversation(db, owner);
  const workDefinition = await seedPublishedWorkDefinition(db, owner, {
    agentVersionId: agent.versionId,
    environmentVersionId: environment.versionId,
    agentDefinitionId: agent.definitionId,
    name: `${options.name ?? 'Golden Path'} Work`,
  });
  return {
    owner,
    workspace: { id: owner.workspaceId },
    environment,
    agent,
    team,
    conversation,
    workDefinition,
    triggerMessageId: randomUUID(),
  } as const;
}
