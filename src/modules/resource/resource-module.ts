import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

import { ResolveAgentVersion } from '../../application/agents/resolve-agent-version.js';
import {
  AGENT_SERVER_MEMORY_API_SKILL_REF,
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
} from '../../application/agents/built-in-skills.js';
import type { AgentResolutionApi } from '../../application/ports/agent-resolution-api.js';
import type { AgentRegistry } from '../../application/ports/agent-registry.js';
import type { DefinitionReadApi } from '../../application/ports/definition-read-api.js';
import type { EnvironmentReadApi } from '../../application/ports/environment-read-api.js';
import type { EnvironmentRegistry } from '../../application/ports/environment-registry.js';
import type { ApiEnvironment } from '../../platform/http-types.js';
import type { AppConfig } from '../../shared/config.js';
import { registerAgentRoutes } from '../../entrypoints/api/routes/agents.js';
import { registerEnvironmentRoutes } from '../../entrypoints/api/routes/environments.js';
import { registerTeamRoutes } from '../../entrypoints/api/routes/teams.js';
import { LocalSkillCatalog } from '../../infrastructure/filesystem/local-skill-catalog.js';
import { PostgresAgentRegistry } from '../../infrastructure/postgres/postgres-agent-registry.js';
import { PostgresEnvironmentRegistry } from '../../infrastructure/postgres/postgres-environment-registry.js';
import { PostgresInvokableRepository } from '../../infrastructure/postgres/postgres-invokable-repository.js';
import { registerSkill } from '../../application/extensions/skill-registry.js';

export interface ResourceModuleDatabase {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: readonly Row[]; rowCount?: number | null }>;
}

export interface ResourceModule {
  readonly agentResolutionApi: AgentResolutionApi;
  readonly definitionReadApi: DefinitionReadApi;
  readonly environmentReadApi: EnvironmentReadApi;
  installHttp(app: Hono<ApiEnvironment>, config: AppConfig): void;
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
  const environmentReadApi: EnvironmentReadApi = {
    findVersion: (owner, id) => environmentRegistry.findVersion(owner, id),
  };

  return {
    agentResolutionApi,
    definitionReadApi,
    environmentReadApi,
    installHttp(app, config) {
      registerAgentRoutes(app, { config, agentRegistry });
      registerTeamRoutes(app, {
        config,
        invokableRepository,
        environmentRegistry,
      });
      registerEnvironmentRoutes(app, { config, environmentRegistry });
    },
  };
}
