import { createHash } from 'node:crypto';
import type { AccessContext } from '../control-plane/access-context.js';
import type { AgentRegistry } from '../ports/agent-registry.js';
import { createManagedAgentDefinition } from '../../domain/agents/managed-agent-definition.js';
import { createManagedAgentDraft } from '../../domain/agents/managed-agent-version.js';
import {
  normalizeManagedAgentName,
  type ManagedAgentOwner,
} from '../../domain/agents/managed-agent-owner.js';
import { parseForImport } from './validate-agent-package.js';
import {
  AgentPackageValidationError,
  InvalidIdempotencyKeyError,
} from './errors.js';

export interface ImportAgentInput {
  readonly accessContext: AccessContext;
  readonly idempotencyKey: string;
  readonly source: string;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}
export async function importAgent(
  registry: AgentRegistry,
  input: ImportAgentInput,
) {
  assertKey(input.idempotencyKey);
  const parsed = parseForImport(input.source);
  const owner = ownerFromContext(input.accessContext);
  const normalizedName = normalizeManagedAgentName(
    parsed.package.metadata.name,
  );
  if (!normalizedName) throw new AgentPackageValidationError();
  const definition = createManagedAgentDefinition({
    ...owner,
    normalizedName,
    displayName: parsed.package.metadata.name,
    ...(input.idFactory ? { id: input.idFactory() } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  const version = createManagedAgentDraft({
    definition,
    parsed,
    ...(input.idFactory ? { id: input.idFactory() } : {}),
    ...(input.now ? { now: input.now } : {}),
  });
  return registry.importAgent({
    owner,
    compatibilityWorkspaceId: input.accessContext.workspaceId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: hash(input.source),
    normalizedName,
    definition,
    version,
  });
}
export function ownerFromContext(context: AccessContext): ManagedAgentOwner {
  return {
    tenantId: context.tenantId,
    principalType: context.principalType,
    principalId: context.principalId,
  };
}
export function assertKey(key: string): void {
  if (typeof key !== 'string' || !key.trim() || key.length > 255)
    throw new InvalidIdempotencyKeyError();
}
function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export class ImportAgent {
  constructor(private readonly registry: AgentRegistry) {}
  execute(input: ImportAgentInput) {
    return importAgent(this.registry, input);
  }
}
