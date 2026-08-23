import {
  createMemoryModule,
  type MemoryModule,
  type MemoryModuleDatabase,
} from '../modules/memory/memory-module.js';
import type { SessionRepository } from '../application/ports/session-repository.js';
import type { TaskRepository } from '../application/ports/task-repository.js';
import type { TeamToolContextResolver } from '../application/teams/team-tool-context.js';
import type { AppConfig } from '../shared/config.js';

export interface CreateMemoryCapabilitiesOptions {
  readonly database: MemoryModuleDatabase;
  readonly tasks: TaskRepository;
  readonly sessions: SessionRepository;
  readonly config: AppConfig;
  readonly teamTools: {
    readonly contextResolver: TeamToolContextResolver;
  };
}

export type MemoryCapabilities = MemoryModule;

/** Creates the Memory capabilities shared by the application graph. */
export function createMemoryCapabilities(
  options: CreateMemoryCapabilitiesOptions,
): MemoryCapabilities {
  return createMemoryModule(options);
}
