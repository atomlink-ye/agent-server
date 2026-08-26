import type { Hono } from 'hono';

import type { AgentRegistry } from '../../../application/ports/agent-registry.js';
import type { WorkDefinitionSourceRepository } from '../../../application/ports/work-definition-source-repository.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  AgentIdSchema,
  AssociateAgentCapabilityRequestSchema,
  AssociateAgentCapabilityResponseSchema,
} from '../../../contracts/agents.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import { getAuthenticatedAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import { readBoundedJson } from '../read-bounded-json.js';
import { MAX_AGENT_REQUEST_BYTES } from '../../../contracts/agents.js';

export function registerAgentWorkCatalogRoute(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly agents: Pick<AgentRegistry, 'findDefinition'>;
    readonly definitions: Pick<
      WorkDefinitionSourceRepository,
      'associateAgentWorkflow'
    >;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/agents/:agentId/capabilities', auth);

  app.post('/api/v1/agents/:agentId/capabilities', async (c) => {
    const agentId = c.req.param('agentId');
    if (!AgentIdSchema.safeParse(agentId).success)
      throw new HttpError(400, 'invalid_request', 'The Agent id is invalid.');
    const parsed = AssociateAgentCapabilityRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_request',
        'The Capability binding is invalid.',
      );
    if (!dependencies.definitions.associateAgentWorkflow)
      throw new HttpError(
        503,
        'work_catalog_unavailable',
        'The Work Catalog is unavailable.',
      );

    const access = getAuthenticatedAccessContext(c);
    const owner = {
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalType: access.principalType,
      principalId: access.principalId,
    };
    const agent = await dependencies.agents.findDefinition(owner, agentId);
    if (!agent)
      throw new HttpError(
        404,
        'agent_not_found',
        'The Agent does not exist in this owner scope.',
      );

    try {
      await dependencies.definitions.associateAgentWorkflow({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        agentDefinitionId: agent.id,
        definitionId: parsed.data.definition_id,
        definitionVersionId: parsed.data.definition_version_id,
        now: new Date().toISOString(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'agent_work_binding_not_found'
      )
        throw new HttpError(
          404,
          'capability_not_found',
          'The Work Definition version does not exist in this owner scope or lineage.',
        );
      throw error;
    }

    return c.json(
      AssociateAgentCapabilityResponseSchema.parse({
        associated: true,
        agent_definition_id: agent.id,
        definition_id: parsed.data.definition_id,
        definition_version_id: parsed.data.definition_version_id,
      }),
      200,
    );
  });
}
