import { postConversationMessage } from '../../../src/application/chat/post-conversation-message.js';
import { PostgresConversationRepository } from '../../../src/infrastructure/postgres/postgres-conversation-repository.js';
import type { SeedDatabase } from './types.js';
import { seedPublishedAgentVersion } from './agent.js';
import { seedConversation } from './conversation.js';
import { seedWorkEntitlement } from './entitlement.js';
import { seedEnvironmentVersion } from './environment.js';
import { seedPublishedTeamVersion } from './team.js';
import { seedActiveTask, seedPublishedWorkDefinition } from './work.js';
import { seedWorkspace } from './workspace.js';

export {
  seedActiveTask,
  seedPublishedAgentVersion,
  seedConversation,
  seedWorkEntitlement,
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

  // Use production conversation/message paths for the canonical Golden Path
  // fixture so direct identity, memberships, runtime state and provenance FKs
  // match the real product path instead of a table-shaped approximation.
  const conversations = new PostgresConversationRepository(db as any);
  await conversations.ensureChatRuntime({
    tenantId: owner.tenantId,
    agentDefinitionId: agent.definitionId,
    activeAgentVersionId: agent.versionId,
  });
  const conversation = await conversations.findOrCreateDirect({
    tenantId: owner.tenantId,
    principalId: owner.principalId,
    principalType: owner.principalType,
    agentDefinitionId: agent.definitionId,
  });
  const trigger = await postConversationMessage(conversations, {
    author: {
      type: 'principal',
      tenantId: owner.tenantId,
      conversationId: conversation.id,
      principalType: owner.principalType,
      principalId: owner.principalId,
    },
    body: 'Golden Path harness trigger',
  });
  const entitlement = await seedWorkEntitlement(db, owner, {
    conversationId: conversation.id,
    agentDefinitionId: agent.definitionId,
  });
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
    entitlement,
    workDefinition,
    triggerMessageId: trigger.id,
  } as const;
}
