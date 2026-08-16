import type { Pool } from 'pg';

import { CollaborationActivationReconciler } from '../../application/collaboration/collaboration-activation-reconciler.js';
import { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { AdmissionRepository } from '../../application/ports/admission-repository.js';
import type { RunEventRepository } from '../../application/ports/run-events.js';
import type { RunRepository } from '../../application/ports/run-repository.js';
import type { TaskRepository } from '../../application/ports/task-repository.js';
import { TeamPolicyEvaluator } from '../../application/teams/team-policy-evaluator.js';
import { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import { PostgresCollaborationRepository } from '../../infrastructure/postgres/postgres-collaboration-repository.js';
import { PostgresTeamExecutionRepository } from '../../infrastructure/postgres/postgres-collaborative-team-repository.js';
import { PostgresTeamMessageRepository } from '../../infrastructure/postgres/postgres-team-message-repository.js';
import type { Logger } from '../../shared/observability/logger.js';

export function createTeamModule(options: {
  readonly database: Pool;
  readonly tasks: TaskRepository;
  readonly runs: RunRepository;
  readonly admissions: AdmissionRepository;
  readonly events: RunEventRepository;
  readonly logger: Logger;
  readonly deferActivationKick?: boolean;
}) {
  const collaborationRepository = new PostgresCollaborationRepository(
    options.database,
  );
  const executions = Object.assign(
    new PostgresTeamExecutionRepository(options.database),
    {
      listCollaborationCheckpoints: (
        teamRunId: string,
        owner: Parameters<
          PostgresCollaborationRepository['listCheckpoints']
        >[1],
      ) => collaborationRepository.listCheckpoints(teamRunId, owner),
      listCollaborationSubmissions: (
        teamRunId: string,
        owner: Parameters<
          PostgresCollaborationRepository['listSubmissions']
        >[1],
      ) => collaborationRepository.listSubmissions(teamRunId, owner),
    },
  );
  const messages = new PostgresTeamMessageRepository(options.database);
  const policy = new TeamPolicyEvaluator();
  const contextResolver = new TeamToolContextResolver(
    executions,
    options.tasks,
    options.runs,
    policy,
  );
  const activationReconciler = new CollaborationActivationReconciler(
    messages,
    executions,
    options.tasks,
    options.admissions,
    options.logger,
  );
  const collaboration = new CollaborationKernel(
    executions,
    collaborationRepository,
    messages,
    options.events,
    options.deferActivationKick ? undefined : activationReconciler,
  );

  return {
    executions,
    messages,
    collaborationRepository,
    policy,
    contextResolver,
    activationReconciler,
    collaboration,
  } as const;
}
