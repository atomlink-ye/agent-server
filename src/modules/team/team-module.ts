import type { Pool } from 'pg';

import { CollaborationKernel } from '../../application/collaboration/collaboration-kernel.js';
import type { AdmissionRepository } from '../../application/ports/admission-repository.js';
import type { RunEventRepository } from '../../application/ports/run-events.js';
import type { RunRepository } from '../../application/ports/run-repository.js';
import type { TaskRepository } from '../../application/ports/task-repository.js';
import { TeamCommandService } from '../../application/teams/team-command-service.js';
import { TeamPolicyEvaluator } from '../../application/teams/team-policy-evaluator.js';
import { TeamToolContextResolver } from '../../application/teams/team-tool-context.js';
import { TeamWakeReconciler } from '../../application/teams/team-wake-reconciler.js';
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
}) {
  const executions = new PostgresTeamExecutionRepository(options.database);
  const messages = new PostgresTeamMessageRepository(options.database);
  const collaborationRepository = new PostgresCollaborationRepository(
    options.database,
  );
  const policy = new TeamPolicyEvaluator();
  const contextResolver = new TeamToolContextResolver(
    executions,
    options.tasks,
    options.runs,
    policy,
  );
  const wakeReconciler = new TeamWakeReconciler(
    messages,
    executions,
    options.tasks,
    options.admissions,
    undefined,
    options.logger,
  );
  const commands = new TeamCommandService(
    executions,
    options.events,
    messages,
    wakeReconciler,
  );
  const collaboration = new CollaborationKernel(
    executions,
    collaborationRepository,
    messages,
    options.events,
    wakeReconciler,
  );

  return {
    executions,
    messages,
    collaborationRepository,
    policy,
    contextResolver,
    wakeReconciler,
    commands,
    collaboration,
  } as const;
}
