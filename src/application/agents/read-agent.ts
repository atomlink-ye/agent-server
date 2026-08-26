import type { AccessContext } from '../../domain/access-context.js';
import type {
  AgentRegistry,
  ManagedAgentDefinitionRead,
} from '../ports/agent-registry.js';
import { AgentNotFoundError } from './errors.js';
import { InvalidAgentListLimitError } from './errors.js';
import type { ListAgentVersionsCommand } from '../ports/agent-registry.js';
export async function readAgentDefinition(
  registry: AgentRegistry &
    Pick<
      ManagedAgentDefinitionRead,
      | 'findManagedDefinitionByTenant'
      | 'findVersionByTenant'
      | 'listVersionsByTenant'
    >,
  accessContext: AccessContext,
  definitionId: string,
) {
  const value = await registry.findManagedDefinitionByTenant({
    tenantId: accessContext.tenantId,
    definitionId,
  });
  if (!value) throw new AgentNotFoundError();
  return value;
}
export async function readAgentVersion(
  registry: AgentRegistry &
    Pick<
      ManagedAgentDefinitionRead,
      | 'findManagedDefinitionByTenant'
      | 'findVersionByTenant'
      | 'listVersionsByTenant'
    >,
  accessContext: AccessContext,
  versionId: string,
) {
  const value = await registry.findVersionByTenant({
    tenantId: accessContext.tenantId,
    versionId,
  });
  if (!value) throw new AgentNotFoundError();
  return value;
}
export async function listAgentVersions(
  registry: AgentRegistry &
    Pick<
      ManagedAgentDefinitionRead,
      | 'findManagedDefinitionByTenant'
      | 'findVersionByTenant'
      | 'listVersionsByTenant'
    >,
  accessContext: AccessContext,
  input: ListAgentVersionsCommand,
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
    throw new InvalidAgentListLimitError();
  const page = await registry.listVersionsByTenant({
    tenantId: accessContext.tenantId,
    command: input,
  });
  if (!page) throw new AgentNotFoundError();
  return {
    items: page.items,
    nextCursor: page.nextCursor,
  };
}
