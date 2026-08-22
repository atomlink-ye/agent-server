import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

import { ResolveAgentVersion } from '../../application/agents/resolve-agent-version.js';
import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import type { EnsureCoworkerConversation } from '../../application/chat/ensure-coworker-conversation.js';
import type { AgentResolutionApi } from '../../application/ports/agent-resolution-api.js';
import type { ManagedAgentDefinitionRead } from '../../application/ports/agent-registry.js';
import type { DefinitionReadApi } from '../../application/ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../../application/ports/environment-read-api.js';
import type { MemoryVersionReadApi } from '../../application/ports/memory-version-read-api.js';
import type { WorkDefinitionSourceRepository } from '../../application/ports/work-definition-source-repository.js';
import type { WorkDefinitionResolutionPort } from '../../application/ports/work-definition-resolution.js';
import { ProductWorkDefinitionApi } from '../../application/work/product-work-definition-api.js';
import { ResolveWorkDefinition } from '../../application/work/resolve-work-definition.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import type { AppConfig } from '../../shared/config.js';
import { registerAgentRoutes } from '../../entrypoints/api/routes/agents.js';
import { registerEnvironmentRoutes } from '../../entrypoints/api/routes/environments.js';
import { registerProductWorkDefinitionRoutes } from '../../entrypoints/api/routes/product-work-definitions.js';
import { registerTeamRoutes } from '../../entrypoints/api/routes/teams.js';
import { LocalSkillCatalog } from '../../infrastructure/filesystem/local-skill-catalog.js';
import { PostgresAgentRegistry } from '../../infrastructure/postgres/postgres-agent-registry.js';
import { PostgresEnvironmentRegistry } from '../../infrastructure/postgres/postgres-environment-registry.js';
import { PostgresInvokableRepository } from '../../infrastructure/postgres/postgres-invokable-repository.js';
import { PostgresMemoryVersionReadApi } from '../../infrastructure/postgres/postgres-memory-version-read-api.js';
import { PostgresWorkDefinitionSourceRepository } from '../../infrastructure/postgres/postgres-work-definition-source-repository.js';
import { PostgresWorkRunResourceManifestRead } from '../../infrastructure/postgres/postgres-work-run-resource-manifest-read.js';
import { registerSkill } from '../../application/extensions/skill-registry.js';

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
      new URL('../../../skills/agent-server-memory-api', import.meta.url),
    ),
    requiredToolRefs: [AGENT_SERVER_MEMORY_READ_TOOL_REF],
  });

  const agentRegistry = new PostgresAgentRegistry(options.database);
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
    invokableRepository,
    skillCatalog,
  );
  const definitionReadApi: DefinitionReadApi = {
    findPublishedAgentVersionById: (id, ownerScope) =>
      invokableRepository.findPublishedAgentVersionById(id, ownerScope),
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
    agents: agentRegistry,
    agentResolution: agentResolutionApi,
    definitions: definitionReadApi,
    environments: environmentReadApi,
    authoredDefinitions: workDefinitionSources,
    memories: memoryVersionReadApi,
  });
  const productWorkDefinitions = new ProductWorkDefinitionApi({
    repository: workDefinitionSources,
    resolver: workDefinitionResolution,
    agents: agentResolutionApi,
    agentRegistry,
    invokables: invokableRepository,
    environments: environmentRegistry,
    environmentRegistry,
    memories: memoryVersionReadApi,
  });

  return {
    managedAgentDefinitions: agentRegistry,
    agentResolutionApi,
    definitionReadApi,
    environmentReadApi,
    memoryVersionReadApi,
    workDefinitionSources,
    workDefinitionResolution,
    productWorkDefinitions,
    installHttp(app, config, httpOptions) {
      registerProductWorkDefinitionRoutes(app, {
        config,
        definitions: productWorkDefinitions,
      });
      registerAgentRoutes(app, {
        config,
        agentRegistry,
        ...(httpOptions?.coworkerProvisioning
          ? { coworkerProvisioning: httpOptions.coworkerProvisioning }
          : {}),
      });
      registerTeamRoutes(app, {
        config,
        invokableRepository,
        environmentRegistry,
      });
      registerEnvironmentRoutes(app, { config, environmentRegistry });
    },
  };
}
