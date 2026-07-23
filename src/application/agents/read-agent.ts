import type { AccessContext } from '../control-plane/access-context.js';
import type { AgentRegistry } from '../ports/agent-registry.js';
import { ownerFromContext } from './import-agent.js';
import { AgentNotFoundError } from './errors.js';
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
  definitionId: string,
) {
  const values = await registry.listVersions(
    ownerFromContext(accessContext),
    definitionId,
  );
  return [...values].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}
