import type { Hono } from 'hono';

import type {
  ManagedAgentCoworkerSummary,
  ManagedAgentDefinitionRead,
} from '../../../application/ports/agent-registry.js';
import type { AgentResolutionApi } from '../../../application/ports/agent-resolution-api.js';
import type { WorkDefinitionSourceRepository } from '../../../application/ports/work-definition-source-repository.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  AgentCoworkerProfileResponseSchema,
  AgentIdSchema,
} from '../../../contracts/agents.js';
import { HttpError } from '../../../contracts/http.js';
import { emptyWorkInputSchema } from '../../../domain/work/work-input-schema.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';

export function registerAgentProfileRoute(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly agents: Pick<
      ManagedAgentDefinitionRead,
      'listManagedDefinitionsByTenant'
    >;
    readonly resolution: AgentResolutionApi;
    readonly definitions?: Pick<
      WorkDefinitionSourceRepository,
      'listAgentWorkBindings'
    >;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/agents/:agentId/profile', auth);

  app.get('/api/v1/agents/:agentId/profile', async (c) => {
    const agentId = c.req.param('agentId');
    if (!AgentIdSchema.safeParse(agentId).success)
      throw new HttpError(400, 'invalid_request', 'The Agent id is invalid.');
    const access = getAuthenticatedAccessContext(c);
    const coworker = await findCoworker(
      dependencies.agents,
      access.tenantId,
      agentId,
    );
    if (!coworker)
      throw new HttpError(404, 'agent_not_found', 'The Agent does not exist.');

    const definition = coworker.definition;
    const resolved = await dependencies.resolution.resolvePublished(
      coworker.activeAgentVersionId,
      {
        tenantId: definition.tenantId,
        workspaceId: definition.workspaceId,
        principalType: definition.principalType,
        principalId: definition.principalId,
      },
      { resolveExtensions: true },
    );
    if (!resolved)
      throw new HttpError(
        409,
        'agent_version_unavailable',
        'The active Agent version cannot be resolved.',
      );

    const bindings = dependencies.definitions?.listAgentWorkBindings
      ? await dependencies.definitions.listAgentWorkBindings({
          tenantId: definition.tenantId,
          workspaceId: definition.workspaceId,
          agentDefinitionId: definition.id,
        })
      : [];

    return c.json(
      AgentCoworkerProfileResponseSchema.parse({
        agent: {
          id: definition.id,
          normalized_name: definition.normalizedName,
          display_name: definition.displayName,
          created_at: definition.createdAt,
          updated_at: definition.updatedAt,
          role_label: definition.roleLabel,
          summary: definition.summary,
          active_agent_version_id: coworker.activeAgentVersionId,
          runtime_status: coworker.runtimeStatus,
          links: {
            self: `/api/v1/agents/${definition.id}`,
            versions: `/api/v1/agents/${definition.id}/versions`,
          },
        },
        capabilities: {
          model_policy_ref: resolved.modelPolicyRef,
          proposal_limit: resolved.proposalLimit ?? null,
          tools: [...resolved.toolRefs].slice(0, 32),
          skills: resolved.skills.map((skill) => skill.ref).slice(0, 32),
        },
        work_catalog: bindings
          .slice(0, 100)
          .map(({ definition: work, version }) => ({
            // The binding query joins definition and version rows with shared
            // column names; the version's lineage is the authoritative
            // definition identity at this response boundary.
            definition_id: version.definitionId,
            definition_version_id: version.id,
            name: work.name,
            description: work.description,
            input_schema: version.source.inputSchema ?? emptyWorkInputSchema(),
          })),
      }),
    );
  });
}

async function findCoworker(
  agents: Pick<ManagedAgentDefinitionRead, 'listManagedDefinitionsByTenant'>,
  tenantId: string,
  agentId: string,
): Promise<ManagedAgentCoworkerSummary | null> {
  if (!agents.listManagedDefinitionsByTenant) return null;
  let cursor: string | null = null;
  do {
    const page = await agents.listManagedDefinitionsByTenant({
      tenantId,
      command: { cursor, limit: 100 },
    });
    const found = page.items.find((item) => item.definition.id === agentId);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}
