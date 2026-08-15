import type { CollaborationCapability } from '../../domain/collaboration/collaboration.js';
import type { TeamToolContext } from '../teams/team-tool-context.js';

const LEAD_CAPABILITIES = Object.freeze<readonly CollaborationCapability[]>([
  'board.read',
  'board.create',
  'board.assign',
  'board.review',
  'board.cancel',
  'mailbox.read',
  'mailbox.send',
  'mailbox.ack',
  'run.finalize',
]);

const MEMBER_CAPABILITIES = Object.freeze<readonly CollaborationCapability[]>([
  'board.read',
  'board.claim',
  'board.checkpoint',
  'board.block',
  'board.submit',
  'mailbox.read',
  'mailbox.send',
  'mailbox.ack',
]);

export class CollaborationPolicy {
  public capabilities(context: Pick<TeamToolContext, 'member'>) {
    return context.member.role === 'lead'
      ? LEAD_CAPABILITIES
      : MEMBER_CAPABILITIES;
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
