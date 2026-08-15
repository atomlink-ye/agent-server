import type {
  TeamMessage,
  TeamMessagePriority,
} from '../../domain/teams/team-message.js';
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
  requeueDirectForFailedTask(input: {
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
  claimDirectBatchForTask?(input: {
    readonly messageIds: readonly string[];
    readonly taskId: string;
    readonly teamRunId: string;
    readonly recipientMemberRunId: string;
    readonly owner: OwnerScope;
  }): Promise<readonly TeamMessage[]>;
  sendDirect(input: {
    readonly teamRunId: string;
    readonly senderMemberRunId: string;
    readonly recipientMemberRunId: string;
    readonly dedupKey: string;
    readonly body: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly expectedRevision: number;
    readonly aboutWorkItemId?: string | null;
    readonly replyToMessageId?: string | null;
    readonly priority?: TeamMessagePriority;
    readonly requiresAck?: boolean;
    readonly owner: OwnerScope;
  }): Promise<TeamMessage>;
  acknowledgeDirect?(input: {
    readonly messageId: string;
    readonly recipientMemberRunId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly owner: OwnerScope;
  }): Promise<TeamMessage>;
  listDirectForTeamRun(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamMessage[]>;
  listForTeamRun?(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly TeamMessage[]>;
}
