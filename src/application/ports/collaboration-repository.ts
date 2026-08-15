import type {
  CollaborationCheckpoint,
  CollaborationSubmission,
} from '../../domain/collaboration/collaboration.js';
import type { TeamWorkItem } from '../../domain/teams/team-work-item.js';
import type { TeamWorkItemAttempt } from '../../domain/teams/team-work-item-attempt.js';
import type { OwnerScope } from './team-execution-repository.js';

export interface CollaborationRepository {
  createOpenWork(input: {
    readonly teamRunId: string;
    readonly createdByMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly subject: string;
    readonly description: string | null;
    readonly dependsOnWorkItemIds: readonly string[];
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<TeamWorkItem>;

  assignOpenWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly assigneeMemberId: string;
    readonly actorMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;

  claimOpenWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly claimantMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;

  blockCurrentAttempt(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly attemptId: string;
    readonly participantMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly summary: string;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;

  resumeBlockedWork(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly assigneeMemberId: string;
    readonly actorMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly feedback: string;
    readonly commandHash: string;
    readonly expectedRevision: number;
    readonly owner: OwnerScope;
  }): Promise<{ item: TeamWorkItem; attempt: TeamWorkItemAttempt }>;

  recordCheckpoint(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly attemptId: string | null;
    readonly participantMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly summary: string;
    readonly nextStep: string | null;
    readonly blocker: string | null;
    readonly evidenceRefs: readonly string[];
    readonly owner: OwnerScope;
  }): Promise<CollaborationCheckpoint>;

  submitCurrentAttempt(input: {
    readonly teamRunId: string;
    readonly workItemId: string;
    readonly attemptId: string;
    readonly participantMemberId: string;
    readonly sourceTaskId: string;
    readonly sourceRunId: string;
    readonly summary: string;
    readonly evidenceRefs: readonly string[];
    readonly artifactRefs: readonly string[];
    readonly owner: OwnerScope;
  }): Promise<{
    attempt: TeamWorkItemAttempt;
    submission: CollaborationSubmission;
  }>;

  listCheckpoints(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly CollaborationCheckpoint[]>;

  listSubmissions(
    teamRunId: string,
    owner: OwnerScope,
  ): Promise<readonly CollaborationSubmission[]>;
}
