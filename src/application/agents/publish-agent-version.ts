import { createHash } from 'node:crypto';
import type { AccessContext } from '../../platform/access-context.js';
import type { AgentRegistry } from '../ports/agent-registry.js';
import { ownerFromContext, assertKey } from './import-agent.js';
import { AgentNotFoundError } from './errors.js';
export interface PublishAgentVersionInput {
  readonly accessContext: AccessContext;
  readonly idempotencyKey: string;
  readonly versionId: string;
}
export async function publishAgentVersion(
  registry: AgentRegistry,
  input: PublishAgentVersionInput,
) {
  assertKey(input.idempotencyKey);
  try {
    return await registry.publishAgentVersion({
      owner: ownerFromContext(input.accessContext),
      idempotencyKey: input.idempotencyKey,
      versionId: input.versionId,
      requestFingerprint: `sha256:${createHash('sha256').update(input.versionId).digest('hex')}`,
    });
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw error;
    throw error;
  }
}
export class PublishAgentVersion {
  constructor(private readonly registry: AgentRegistry) {}
  execute(input: PublishAgentVersionInput) {
    return publishAgentVersion(this.registry, input);
  }
}
