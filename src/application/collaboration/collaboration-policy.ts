import type { CollaborationCapability } from '../../domain/collaboration/collaboration.js';
import { collaborationCapabilitiesForRole } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { TeamToolContext } from '../teams/team-tool-context.js';

export class CollaborationPolicy {
  public capabilities(context: Pick<TeamToolContext, 'member'>) {
    return collaborationCapabilitiesForRole(context.member.role);
  }

  public require(
    context: Pick<TeamToolContext, 'member'>,
    capability: CollaborationCapability,
  ): void {
    if (!this.capabilities(context).includes(capability))
      throw new CollaborationPolicyError('not_allowed');
  }
}

export class CollaborationPolicyError extends Error {
  public constructor(
    public readonly code: 'not_allowed' | 'invalid_request' = 'not_allowed',
  ) {
    super(code);
    this.name = 'CollaborationPolicyError';
  }
}
