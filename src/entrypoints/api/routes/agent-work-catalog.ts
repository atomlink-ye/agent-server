import type { Hono } from 'hono';

import type { AgentRegistry } from '../../../application/ports/agent-registry.js';
import type { WorkDefinitionSourceRepository } from '../../../application/ports/work-definition-source-repository.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  AgentIdSchema,
  AssociateAgentCapabilityRequestSchema,
  AssociateAgentCapabilityResponseSchema,
  WorkDefinitionAgentAvailabilityResponseSchema,
  WorkDefinitionAgentBindingRequestSchema,
  WorkDefinitionAgentBindingResponseSchema,
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
      | 'associateAgentWorkflow'
      | 'findDefinition'
      | 'findPublishedVersion'
      | 'listProductVersions'
      | 'listAgentWorkBindingsForDefinition'
    >;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/agents/:agentId/capabilities', auth);
  app.use('/api/v1/work-definitions/*', auth);

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
        principalType: access.principalType,
        principalId: access.principalId,
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

  // Definition-first catalog reads expose the reverse side of the existing
  // Agent-first capability route. Bindings remain many-to-many records; this
  // endpoint only changes the catalog relationship and never Work/WorkRun
  // execution identity.
  app.get('/api/v1/work-definitions/:definitionId/agents', async (c) => {
    const definitionId = c.req.param('definitionId');
    if (!AgentIdSchema.safeParse(definitionId).success)
      throw new HttpError(
        400,
        'invalid_request',
        'The Definition id is invalid.',
      );
    const access = getAuthenticatedAccessContext(c);
    const owner = {
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalType: access.principalType,
      principalId: access.principalId,
    };
    const definition = await dependencies.definitions.findDefinition(
      definitionId,
      owner,
    );
    if (!definition)
      throw new HttpError(
        404,
        'work_definition_not_found',
        'The Work Definition does not exist.',
      );
    const version = await currentPublishedVersion(
      dependencies.definitions,
      definitionId,
      owner,
    );
    if (!version)
      throw new HttpError(
        404,
        'work_definition_not_found',
        'The Work Definition has no published version.',
      );
    const bindings = dependencies.definitions.listAgentWorkBindingsForDefinition
      ? await dependencies.definitions.listAgentWorkBindingsForDefinition({
          ...owner,
          definitionId,
        })
      : [];
    const agents = await Promise.all(
      bindings.map(async (binding) => {
        const agent = await dependencies.agents.findDefinition(
          owner,
          binding.agentDefinitionId,
        );
        return agent
          ? {
              agent_definition_id: agent.id,
              definition_version_id: binding.definitionVersionId,
              display_name: agent.displayName,
              role_label: agent.roleLabel,
            }
          : null;
      }),
    );
    return c.json(
      WorkDefinitionAgentAvailabilityResponseSchema.parse({
        definition_id: definition.id,
        definition_version_id: version.id,
        agents: agents.filter(
          (agent): agent is NonNullable<typeof agent> => agent !== null,
        ),
      }),
      200,
    );
  });

  app.put(
    '/api/v1/work-definitions/:definitionId/agents/:agentId',
    async (c) => {
      const definitionId = c.req.param('definitionId');
      const agentId = c.req.param('agentId');
      if (
        !AgentIdSchema.safeParse(definitionId).success ||
        !AgentIdSchema.safeParse(agentId).success
      )
        throw new HttpError(
          400,
          'invalid_request',
          'The Definition or Agent id is invalid.',
        );
      const parsed = WorkDefinitionAgentBindingRequestSchema.safeParse(
        (await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES)) ?? {},
      );
      if (!parsed.success)
        throw new HttpError(
          400,
          'invalid_request',
          'The Work catalog binding is invalid.',
        );
      const access = getAuthenticatedAccessContext(c);
      const owner = {
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        principalType: access.principalType,
        principalId: access.principalId,
      };
      const [definition, agent] = await Promise.all([
        dependencies.definitions.findDefinition(definitionId, owner),
        dependencies.agents.findDefinition(owner, agentId),
      ]);
      if (!definition)
        throw new HttpError(
          404,
          'work_definition_not_found',
          'The Work Definition does not exist.',
        );
      if (!agent)
        throw new HttpError(
          404,
          'agent_not_found',
          'The Agent does not exist in this owner scope.',
        );
      const version = await dependencies.definitions.findPublishedVersion(
        parsed.data.definition_version_id,
        owner,
      );
      if (!version || version.definitionId !== definitionId)
        throw new HttpError(
          404,
          'work_definition_not_found',
          'The Work Definition version does not exist in this owner scope or lineage.',
        );
      if (!dependencies.definitions.associateAgentWorkflow)
        throw new HttpError(
          503,
          'work_catalog_unavailable',
          'The Work Catalog is unavailable.',
        );
      await dependencies.definitions.associateAgentWorkflow({
        ...owner,
        agentDefinitionId: agent.id,
        definitionId,
        definitionVersionId: version.id,
        now: new Date().toISOString(),
      });
      return c.json(
        WorkDefinitionAgentBindingResponseSchema.parse({
          associated: true,
          definition_id: definitionId,
          definition_version_id: version.id,
          agent_definition_id: agent.id,
        }),
        200,
      );
    },
  );
}

async function currentPublishedVersion(
  definitions: Pick<
    WorkDefinitionSourceRepository,
    'findPublishedVersion' | 'listProductVersions'
  >,
  definitionId: string,
  owner: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly principalType: string;
    readonly principalId: string;
  },
) {
  if (!definitions.listProductVersions) return null;
  const page = await definitions.listProductVersions({
    definitionId,
    owner,
    limit: 1,
    cursor: null,
  });
  return page.items[0]?.version ?? null;
}
