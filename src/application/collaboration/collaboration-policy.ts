import type { CollaborationCapability } from '../../domain/collaboration/collaboration.js';
import { collaborationCapabilitiesForRole } from '../../domain/collaboration/collaboration-policy-definition.js';
import type { TeamToolContext } from '../teams/team-tool-context.js';

export type CollaborationLeadCommand =
  | 'board_create'
  | 'board_assign'
  | 'board_accept'
  | 'board_cancel'
  | 'board_request_changes'
  | 'collaboration_finish';

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

  /**
   * Role capability is necessary but not sufficient: a participant's active
   * task kind determines which side of the collaboration protocol may mutate
   * state in this turn. Durable repositories remain authoritative for exact
   * target/state/revision checks.
   */
  public requireForTask(
    context: Pick<TeamToolContext, 'member' | 'task'> &
      Partial<Pick<TeamToolContext, 'attempt'>>,
    capability: CollaborationCapability,
  ): void {
    this.require(context, capability);
    const kind = context.task.teamTaskKind;
    const completedWorkAttempt =
      kind === 'work_attempt' && context.attempt?.status === 'completed';
    const allowed =
      capability === 'board.create' ||
      capability === 'board.assign' ||
      capability === 'board.review' ||
      capability === 'board.cancel'
        ? context.member.role === 'lead' && kind === 'lead_turn'
        : capability === 'run.finalize'
          ? context.member.role === 'lead' &&
            (kind === 'lead_turn' || kind === 'direct_message')
          : capability === 'board.claim'
            ? context.member.role === 'member' && kind === 'direct_message'
            : capability === 'board.checkpoint' ||
                capability === 'board.block' ||
                capability === 'board.submit'
              ? context.member.role === 'member' &&
                kind === 'work_attempt' &&
                context.attempt?.status === 'running'
              : capability === 'mailbox.send' || capability === 'mailbox.ack'
                ? !completedWorkAttempt
                : true;
    if (!allowed) throw new CollaborationPolicyError('not_allowed');
  }

  public requireLeadCommand(
    context: Pick<TeamToolContext, 'member' | 'task'>,
    command: CollaborationLeadCommand,
  ): void {
    const capability: CollaborationCapability =
      command === 'board_create'
        ? 'board.create'
        : command === 'board_assign'
          ? 'board.assign'
          : command === 'board_accept' || command === 'board_request_changes'
            ? 'board.review'
            : command === 'board_cancel'
              ? 'board.cancel'
              : 'run.finalize';
    this.requireForTask(context, capability);
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
