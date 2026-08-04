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
}
