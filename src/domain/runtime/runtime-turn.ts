import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeTurnId,
} from './runtime-session.js';

export type { RuntimeTurnId } from './runtime-session.js';

export type RuntimeTurnSource =
  | Readonly<{ readonly kind: 'run'; readonly runId: string }>
  | Readonly<{
      readonly kind: 'conversation';
      readonly conversationId: string;
      readonly triggerMessageId: string;
    }>
  | Readonly<{
      readonly kind: 'team_member';
      readonly teamMemberRunId: string;
      readonly taskId: string;
      readonly runId: string;
    }>;

export type RuntimeTurnStatus =
  'pending' | 'preparing' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type RuntimeFailureCode =
  | 'runtime_session_not_found'
  | 'runtime_spec_not_found'
  | 'runtime_provider_unavailable'
  | 'runtime_provider_session_missing'
  | 'runtime_reconfigure_failed'
  | 'runtime_replacement_failed'
  | 'runtime_turn_cancelled'
  | 'runtime_turn_timed_out'
  | 'runtime_grant_denied';

export interface RuntimeTurn {
  readonly id: RuntimeTurnId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly source: RuntimeTurnSource;
  readonly generationId: RuntimeGenerationId | null;
  readonly status: RuntimeTurnStatus;
  readonly promptDigest: string | null;
  readonly failureCode: RuntimeFailureCode | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}
