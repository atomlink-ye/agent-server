import type { Pool } from 'pg';

import { createTeamModule } from '../modules/team/team-module.js';
import type { AdmissionRepository } from '../application/ports/admission-repository.js';
import type { RunEventRepository } from '../application/ports/run-events.js';
import type { RunRepository } from '../application/ports/run-repository.js';
import type { TaskRepository } from '../application/ports/task-repository.js';
import type { Logger } from '../shared/observability/logger.js';

export interface CreateTeamCapabilitiesOptions {
  readonly database: Pool;
  readonly tasks: TaskRepository;
  readonly runs: RunRepository;
  readonly admissions: AdmissionRepository;
  readonly events: RunEventRepository;
  readonly logger: Logger;
  readonly deferActivationKick?: boolean;
}

export type TeamCapabilities = ReturnType<typeof createTeamModule>;

/** Creates the Team capabilities shared by the application graph. */
export function createTeamCapabilities(
  options: CreateTeamCapabilitiesOptions,
): TeamCapabilities {
  return createTeamModule(options);
}
