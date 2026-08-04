import type { TeamMessage } from '../../domain/teams/team-message.js';
import type { OwnerScope } from './team-execution-repository.js';

export interface TeamMessageWakeRoot {
  readonly rootTaskId: string;
  readonly owner: OwnerScope;
}

export interface TeamMessageRepository {
  create(message: TeamMessage): Promise<TeamMessage>;
  listQueuedWakeRoots(): Promise<readonly TeamMessageWakeRoot[]>;
  listQueuedForMember(
    teamRunId: string,
    memberId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamMessage[]>;
  bindToTask(input: {
    readonly messageIds: readonly string[];
    readonly taskId: string;
    readonly owner: OwnerScope;
  }): Promise<readonly TeamMessage[]>;
  claimDirectForTask(input: {
    readonly messageId: string;
    readonly taskId: string;
    readonly teamRunId: string;
    readonly recipientMemberRunId: string;
    readonly owner: OwnerScope;
  }): Promise<TeamMessage>;
  markDirectDelivered(input: {
    readonly messageId: string;
    readonly taskId: string;
    readonly owner: OwnerScope;
  }): Promise<TeamMessage | null>;
  sendDirect(input: {
    readonly teamRunId: string;
    readonly senderMemberRunId: string;
    readonly recipientMemberRunId: string;
    readonly dedupKey: string;
    readonly body: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamMessage>;
  listDirectForTeamRun(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamMessage[]>;
}
