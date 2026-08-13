import type { AccessContext } from '../../platform/access-context.js';
import type { AgentRegistry } from '../ports/agent-registry.js';
import { ownerFromContext } from './import-agent.js';
import { AgentNotFoundError } from './errors.js';
import { InvalidAgentListLimitError } from './errors.js';
import type { ListAgentVersionsCommand } from '../ports/agent-registry.js';
export async function readAgentDefinition(
  registry: AgentRegistry,
  accessContext: AccessContext,
  definitionId: string,
) {
  const value = await registry.findDefinition(
    ownerFromContext(accessContext),
    definitionId,
  );
  if (!value) throw new AgentNotFoundError();
  return value;
}
export async function readAgentVersion(
  registry: AgentRegistry,
  accessContext: AccessContext,
  versionId: string,
) {
  const value = await registry.findVersion(
    ownerFromContext(accessContext),
    versionId,
  );
  if (!value) throw new AgentNotFoundError();
  return value;
}
export async function listAgentVersions(
  registry: AgentRegistry,
  accessContext: AccessContext,
  input: ListAgentVersionsCommand,
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
    throw new InvalidAgentListLimitError();
  const page = await registry.listVersionsForOwner(
    ownerFromContext(accessContext),
    input,
  );
  if (!page) throw new AgentNotFoundError();
  return {
    items: page.items,
    nextCursor: page.nextCursor,
  };
}
