import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

import { ResolveAgentVersion } from '../application/agents/resolve-agent-version.js';
import { ResolveWorkerVersion } from '../application/workers/resolve-worker-version.js';
import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from '../application/agents/built-in-skills.js';
import { EnsureCoworkerConversation } from '../application/chat/ensure-coworker-conversation.js';
import { ReconcileCoworkerConversations } from '../application/chat/reconcile-coworker-conversations.js';
import type { AgentResolutionApi } from '../application/ports/agent-resolution-api.js';
import type {
  WorkerRegistry,
  WorkerResolutionApi,
} from '../application/ports/worker-registry.js';
import type { ManagedAgentDefinitionRead } from '../application/ports/agent-registry.js';
import type { DefinitionReadApi } from '../application/ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../application/ports/environment-read-api.js';
import type { MemoryVersionReadApi } from '../application/ports/memory-version-read-api.js';
import type { WorkDefinitionSourceRepository } from '../application/ports/work-definition-source-repository.js';
import type { WorkDefinitionResolutionPort } from '../application/ports/work-definition-resolution.js';
import { ProductWorkDefinitionApi } from '../application/work/product-work-definition-api.js';
import { ResolveWorkDefinition } from '../application/work/resolve-work-definition.js';
import type { ApiEnvironment } from '../entrypoints/api/http-types.js';
import { registerAgentRoutes } from '../entrypoints/api/routes/agents.js';
import { registerWorkerRoutes } from '../entrypoints/api/routes/workers.js';
import { registerAgentProfileRoute } from '../entrypoints/api/routes/agent-profile.js';
import { registerAgentWorkCatalogRoute } from '../entrypoints/api/routes/agent-work-catalog.js';
import { registerCoworkerAuthoringRoute } from '../entrypoints/api/routes/coworker-authoring.js';
import { registerEnvironmentRoutes } from '../entrypoints/api/routes/environments.js';
import { registerProductWorkDefinitionRoutes } from '../entrypoints/api/routes/product-work-definitions.js';
import { registerTeamRoutes } from '../entrypoints/api/routes/teams.js';
import { LocalSkillCatalog } from '../infrastructure/filesystem/local-skill-catalog.js';
import { PostgresAgentRegistry } from '../infrastructure/postgres/postgres-agent-registry.js';
import { PostgresWorkerRegistry } from '../infrastructure/postgres/postgres-worker-registry.js';
import { PostgresConversationRepository } from '../infrastructure/postgres/postgres-conversation-repository.js';
import { PostgresConversationWorkEntitlementRepository } from '../infrastructure/postgres/postgres-conversation-work-entitlement-repository.js';
import { PostgresEnvironmentRegistry } from '../infrastructure/postgres/postgres-environment-registry.js';
import { PostgresInvokableRepository } from '../infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresMemoryVersionReadApi } from '../infrastructure/postgres/postgres-memory-version-read-api.js';
import { PostgresWorkDefinitionSourceRepository } from '../infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresWorkRunResourceManifestRead } from '../infrastructure/postgres/postgres-work-run-resource-manifest-read.js';
import { registerSkill } from '../application/extensions/skill-registry.js';
import type { AppConfig } from '../shared/config.js';

export interface ResourceModuleDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly Row[]; rowCount?: number | null }>;
}

export interface ResourceModuleHttpOptions {
  readonly coworkerProvisioning?: Pick<EnsureCoworkerConversation, 'execute'>;
}

export interface ResourceModule {
  readonly managedAgentDefinitions: ManagedAgentDefinitionRead;
  readonly agentResolutionApi: AgentResolutionApi;
  readonly workerRegistry: WorkerRegistry;
  readonly workerResolutionApi: WorkerResolutionApi;
  readonly definitionReadApi: DefinitionReadApi;
  readonly environmentReadApi: EnvironmentReadApi;
  readonly memoryVersionReadApi: MemoryVersionReadApi;
  readonly workDefinitionSources: WorkDefinitionSourceRepository;
  readonly workDefinitionResolution: WorkDefinitionResolutionPort;
  readonly productWorkDefinitions: ProductWorkDefinitionApi;
  installHttp(
    app: Hono<ApiEnvironment>,
    config: AppConfig,
    options?: ResourceModuleHttpOptions,
  ): void;
  /**
   * Installs the Product-Work-shaped routes this module owns (Work
   * Definition authoring and the Capability-binding route). The resource
   * module does not decide when these are reachable -- app.ts is the single
   * owner of that surface gate, and calls this only when it is composed.
   */
  installProductWorkHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
}

export interface CreateResourceModuleOptions {
  readonly database: ResourceModuleDatabase;
  readonly config: AppConfig;
}

export async function createResourceModule(
  options: CreateResourceModuleOptions,
): Promise<ResourceModule> {
  await registerSkill({
    registryRoot: options.config.skillRegistryRoot,
    ref: AGENT_SERVER_MEMORY_API_SKILL_REF,
    name: AGENT_SERVER_MEMORY_API_SKILL_REF,
    sourceRoot: fileURLToPath(
      new URL('../../skills/agent-server-memory-api', import.meta.url),
    ),
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });

  const agentRegistry = new PostgresAgentRegistry(options.database);
  const workerRegistry = new PostgresWorkerRegistry(options.database);
  const invokableRepository = new PostgresInvokableRepository(options.database);
  const environmentRegistry = new PostgresEnvironmentRegistry(options.database);
  const memoryVersionReadApi = new PostgresMemoryVersionReadApi(
    options.database,
  );
  const workRunManifests = new PostgresWorkRunResourceManifestRead(
    options.database,
  );
  const workDefinitionSources = new PostgresWorkDefinitionSourceRepository(
    options.database,
  );
  const skillCatalog = new LocalSkillCatalog(options.config.skillRegistryRoot);

  const agentResolutionApi = new ResolveAgentVersion(
    agentRegistry,
    skillCatalog,
  );
  const workerResolutionApi = new ResolveWorkerVersion(
    workerRegistry,
    skillCatalog,
  );
  const definitionReadApi: DefinitionReadApi = {
    findTeamDefinitionById: (id) =>
      invokableRepository.findTeamDefinitionById(id),
    findPublishedTeamVersionById: (id, ownerScope) =>
      invokableRepository.findPublishedTeamVersionById(id, ownerScope),
  };
  const environmentReadApi = {
    findVersion: (
      owner: Parameters<EnvironmentReadApi['findVersion']>[0],
      id: string,
    ) => environmentRegistry.findVersion(owner, id),
    workRunManifests,
    memoryVersions: memoryVersionReadApi,
  };
  const workDefinitionResolution = new ResolveWorkDefinition({
    workers: workerRegistry,
    workerResolution: workerResolutionApi,
    definitions: definitionReadApi,
    environments: environmentReadApi,
    authoredDefinitions: workDefinitionSources,
    memories: memoryVersionReadApi,
  });
  const productWorkDefinitions = new ProductWorkDefinitionApi({
    repository: workDefinitionSources,
    resolver: workDefinitionResolution,
    workers: workerResolutionApi,
    workerRegistry,
    invokables: invokableRepository,
    environments: environmentRegistry,
    environmentRegistry,
    memories: memoryVersionReadApi,
  });

  const directChatEnabled = options.config.directChatPlane !== 'absent';
  const productWorkEnabled =
    options.config.productWorkAvailability.surface === 'composed';
  const conversationRepository = directChatEnabled
    ? new PostgresConversationRepository(options.database)
    : undefined;
  const workEntitlementRepository =
    directChatEnabled && productWorkEnabled
      ? new PostgresConversationWorkEntitlementRepository(options.database)
      : undefined;
  const defaultCoworkerProvisioning = conversationRepository
    ? new EnsureCoworkerConversation(
        conversationRepository,
        workEntitlementRepository,
      )
    : undefined;

  if (defaultCoworkerProvisioning) {
    const reconciliation = new ReconcileCoworkerConversations(
      agentRegistry,
      defaultCoworkerProvisioning,
    );
    for (const account of options.config.serviceAccounts ?? []) {
      if (account.disabled) continue;
      await reconciliation.execute({
        tenantId: account.tenantId,
        workspaceId: account.workspaceId,
        principalType: 'service_account',
        principalId: account.serviceAccountId,
        serviceAccountId: account.serviceAccountId,
        policySnapshotVersion: account.policyVersion,
      });
    }
  }

  return {
    managedAgentDefinitions: agentRegistry,
    agentResolutionApi,
    workerRegistry,
    workerResolutionApi,
    definitionReadApi,
    environmentReadApi,
    memoryVersionReadApi,
    workDefinitionSources,
    workDefinitionResolution,
    productWorkDefinitions,
    installHttp(app, config, httpOptions) {
      const configuredCoworkerProvisioning =
        httpOptions?.coworkerProvisioning ?? defaultCoworkerProvisioning;
      registerAgentRoutes(app, {
        config,
        agentRegistry,
        ...(configuredCoworkerProvisioning
          ? { coworkerProvisioning: configuredCoworkerProvisioning }
          : {}),
      });
      registerCoworkerAuthoringRoute(app, {
        config,
        agentRegistry,
        ...(configuredCoworkerProvisioning
          ? { coworkerProvisioning: configuredCoworkerProvisioning }
          : {}),
      });
      registerWorkerRoutes(app, { config, workerRegistry });
      registerAgentProfileRoute(app, {
        config,
        agents: agentRegistry,
        resolution: agentResolutionApi,
        // When the Product Work surface is absent, omit the definitions
        // seam so the profile honestly reports no work bindings (the
        // Coworker exists; it simply has no formal Capabilities here)
        // rather than surfacing bindings the authoring surface is not
        // installed to have produced.
        ...(productWorkEnabled ? { definitions: workDefinitionSources } : {}),
      });
      registerTeamRoutes(app, {
        config,
        invokableRepository,
        workerResolution: workerResolutionApi,
        environmentRegistry,
      });
      registerEnvironmentRoutes(app, { config, environmentRegistry });
    },
    installProductWorkHttp(app, config) {
      registerProductWorkDefinitionRoutes(app, {
        config,
        definitions: productWorkDefinitions,
      });
      registerAgentWorkCatalogRoute(app, {
        config,
        agents: agentRegistry,
        definitions: workDefinitionSources,
      });
    },
  };
}

export type ResourceCapabilities = ResourceModule;

export function createResourceCapabilities(
  options: CreateResourceModuleOptions,
): Promise<ResourceCapabilities> {
  return createResourceModule(options);
}
