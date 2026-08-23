import type { Hono } from 'hono';

import { CreateMemoryProposal } from '../application/memory/create-memory-proposal.js';
import { ListMemoryEntries } from '../application/memory/list-memory-entries.js';
import { ListMemoryProposals } from '../application/memory/list-memory-proposals.js';
import { ManagedMemory } from '../application/memory/managed-memory.js';
import { ReviewMemoryProposal } from '../application/memory/review-memory-proposal.js';
import {
  AcceptLearningProposal,
  CreateLearningProposal,
  GetLearningProposal,
  ListLearningProposals,
  RejectLearningProposal,
} from '../application/learning/learning-proposals.js';
import { ContextAwareLearningProposalRepository } from '../application/learning/context-aware-learning-proposal-repository.js';
import {
  CreateMemory,
  CreateMemoryStore,
  GetMemory,
  GetMemoryStore,
  ListMemories,
  ListMemoryStores,
  UpdateMemory,
} from '../application/memory-api/memory-api.js';
import { ContextAwareMemoryApiRepository } from '../application/memory-api/context-aware-memory-api-repository.js';
import { ContextMemoryService } from '../application/context/context-memory-service.js';
import { ContextPromotionService } from '../application/context/context-promotion-service.js';
import type {
  MemoryReviewApi,
  MemoryWorkspaceHttpApi,
} from '../application/ports/memory-review-api.js';
import type { FileStore } from '../application/ports/file-store.js';
import type { LogicalFileStore } from '../application/ports/logical-file-store.js';
import type { TaskRepository } from '../application/ports/task-repository.js';
import type { SessionRepository } from '../application/ports/session-repository.js';
import type { MemoryApiRouteDependencies } from '../entrypoints/api/routes/memory-api.js';
import { registerMemoryApiRoutes } from '../entrypoints/api/routes/memory-api.js';
import { registerLearningProposalRoutes } from '../entrypoints/api/routes/learning-proposals.js';
import { registerWorkspaceMemoryRoutes } from '../entrypoints/api/routes/workspace-memory.js';
import { registerContextFileRoutes } from '../entrypoints/api/routes/context-files.js';
import { createMemoryRuntimeContributor } from '../entrypoints/mcp/runtime-tool-contributors.js';
import type { RuntimeToolContributor } from '../application/extensions/runtime-tool-catalog.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import type { AppConfig } from '../shared/config.js';
import { ContextFsFileStore } from '../infrastructure/files/context-fs-file-store.js';
import { PostgresLearningProposalRepository } from '../infrastructure/postgres/postgres-learning-proposal-repository.js';
import { PostgresMemoryApiRepository } from '../infrastructure/postgres/postgres-memory-api-repository.js';
import { PostgresWorkspaceMemoryRepository } from '../infrastructure/postgres/postgres-workspace-memory-repository.js';
import { PostgresLogicalFileStore } from '../infrastructure/postgres/postgres-logical-file-store.js';
import {
  PostgresContextTransitionRepository,
  PostgresMemoryContextRepository,
} from '../infrastructure/postgres/postgres-memory-context-repository.js';
import type { TeamToolContextResolver } from '../application/teams/team-tool-context.js';

export interface MemoryModule {
  readonly http: MemoryWorkspaceHttpApi & {
    readonly memoryApi: Omit<MemoryApiRouteDependencies, 'config'>;
    readonly learningProposals: {
      readonly listLearningProposals: ListLearningProposals;
      readonly getLearningProposal: GetLearningProposal;
      readonly acceptLearningProposal: AcceptLearningProposal;
      readonly rejectLearningProposal: RejectLearningProposal;
    };
  };
  readonly reviewApi: MemoryReviewApi;
  readonly fileStore: FileStore;
  readonly logicalFiles: LogicalFileStore;
  readonly contextMemory: ContextMemoryService;
  readonly contextPromotions: ContextPromotionService;
  readonly createMemoryProposal: CreateMemoryProposal;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
  readonly contributeRuntime: RuntimeToolContributor;
}

export interface MemoryModuleDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly Row[]; rowCount?: number | null }>;
  connect?(): Promise<{
    query<Row = Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<{ rows?: readonly Row[]; rowCount?: number | null }>;
    release?(): void;
  }>;
}

export interface CreateMemoryModuleOptions {
  readonly database: MemoryModuleDatabase;
  readonly tasks: TaskRepository;
  readonly sessions?: SessionRepository;
  readonly config: AppConfig;
  readonly fileStore?: FileStore;
  readonly teamTools?: {
    readonly contextResolver: TeamToolContextResolver;
  };
}

export interface CreateMemoryCapabilitiesOptions
  extends CreateMemoryModuleOptions {
  readonly sessions: SessionRepository;
  readonly teamTools: {
    readonly contextResolver: TeamToolContextResolver;
  };
}

export function createMemoryModule(
  options: CreateMemoryModuleOptions,
): MemoryModule {
  const workspaceMemoryRepository = new PostgresWorkspaceMemoryRepository(
    options.database,
  );

  const logicalFiles = new PostgresLogicalFileStore(options.database);
  const memoryContextRepository = new PostgresMemoryContextRepository(
    options.database,
  );
  const contextMemory = new ContextMemoryService(
    memoryContextRepository,
    logicalFiles,
  );
  const contextPromotions = new ContextPromotionService(
    logicalFiles,
    new PostgresContextTransitionRepository(options.database),
    contextMemory,
  );

  const learningProposalRepository = new ContextAwareLearningProposalRepository(
    new PostgresLearningProposalRepository(options.database),
    contextMemory,
  );
  const memoryApiRepository = new ContextAwareMemoryApiRepository(
    new PostgresMemoryApiRepository(options.database),
    contextMemory,
  );
  const fileStore = options.fileStore ?? new ContextFsFileStore(logicalFiles);
  const managedMemory = new ManagedMemory(options.database, fileStore);

  const createMemoryProposal = new CreateMemoryProposal(
    workspaceMemoryRepository,
    options.tasks,
  );
  const listMemoryProposals = new ListMemoryProposals(
    workspaceMemoryRepository,
  );
  const reviewMemoryProposal = new ReviewMemoryProposal(
    workspaceMemoryRepository,
  );
  const listMemoryEntries = new ListMemoryEntries(workspaceMemoryRepository);

  const createLearningProposal = new CreateLearningProposal(
    learningProposalRepository,
  );
  const listLearningProposals = new ListLearningProposals(
    learningProposalRepository,
  );
  const getLearningProposal = new GetLearningProposal(
    learningProposalRepository,
  );
  const acceptLearningProposal = new AcceptLearningProposal(
    learningProposalRepository,
  );
  const rejectLearningProposal = new RejectLearningProposal(
    learningProposalRepository,
  );

  const createMemoryStore = new CreateMemoryStore(memoryApiRepository);
  const listMemoryStores = new ListMemoryStores(memoryApiRepository);
  const getMemoryStore = new GetMemoryStore(memoryApiRepository);
  const createMemory = new CreateMemory(memoryApiRepository);
  const listMemories = new ListMemories(memoryApiRepository);
  const getMemory = new GetMemory(memoryApiRepository);
  const updateMemory = new UpdateMemory(memoryApiRepository);

  const reviewApi = createReviewApi({
    reviewMemoryProposal,
    managedMemory,
    workspaceMemoryRepository,
  });
  const http: MemoryModule['http'] = {
    createMemoryProposal,
    listMemoryProposals,
    reviewMemoryProposal,
    listMemoryEntries,
    managedMemory,
    memoryApi: {
      createMemoryStore,
      listMemoryStores,
      getMemoryStore,
      createMemory,
      listMemories,
      getMemory,
      updateMemory,
    },
    learningProposals: {
      listLearningProposals,
      getLearningProposal,
      acceptLearningProposal,
      rejectLearningProposal,
    },
  };

  return {
    http,
    reviewApi,
    fileStore,
    logicalFiles,
    contextMemory,
    contextPromotions,
    createMemoryProposal,
    installHttp(app, config) {
      registerWorkspaceMemoryRoutes(app, {
        config,
        ...http,
        ...(options.sessions ? { sessions: options.sessions } : {}),
      });
      registerMemoryApiRoutes(app, {
        config,
        ...http.memoryApi,
      });
      registerLearningProposalRoutes(app, {
        config,
        ...http.learningProposals,
      });
      registerContextFileRoutes(app, {
        config,
        database: options.database,
        files: logicalFiles,
        promotions: contextPromotions,
      });
    },
    contributeRuntime: createMemoryRuntimeContributor({
      repository: memoryApiRepository,
      createLearningProposal,
      ...(options.teamTools ? { teamTools: options.teamTools } : {}),
    }),
  };
}

function createReviewApi(input: {
  readonly reviewMemoryProposal: ReviewMemoryProposal;
  readonly managedMemory: ManagedMemory;
  readonly workspaceMemoryRepository: PostgresWorkspaceMemoryRepository;
}): MemoryReviewApi {
  const { reviewMemoryProposal, managedMemory } = input;
  return {
    review: reviewMemoryProposal,
    managedMemory: {
      acceptEntry: managedMemory.acceptEntry.bind(managedMemory),
    },
    workspaceMemory: input.workspaceMemoryRepository,
  };
}

export type MemoryCapabilities = MemoryModule;

/** Creates the Memory capabilities shared by the application graph. */
export function createMemoryCapabilities(
  options: CreateMemoryCapabilitiesOptions,
): MemoryCapabilities {
  return createMemoryModule(options);
}
