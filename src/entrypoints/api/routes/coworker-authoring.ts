import { createHash } from 'node:crypto';
import type { Hono } from 'hono';

import { compileCoworkerDraft } from '../../../application/agents/coworker-authoring.js';
import { importAgent } from '../../../application/agents/import-agent.js';
import { publishAgentVersion } from '../../../application/agents/publish-agent-version.js';
import { validateAgentPackage } from '../../../application/agents/validate-agent-package.js';
import {
  AgentPackageValidationError,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from '../../../application/agents/errors.js';
import type { AgentRegistry } from '../../../application/ports/agent-registry.js';
import type { ComputerRepository } from '../../../application/ports/computer-repository.js';
import type { WorkspaceMembershipRepository } from '../../../application/ports/workspace-membership-repository.js';
import type { EnsureCoworkerConversation } from '../../../application/chat/ensure-coworker-conversation.js';
import type { EnsureCoworkerDefaultCapability } from '../../../application/agents/ensure-coworker-default-capability.js';
import type { SeedCoworkerIdentityFiles } from '../../../application/agents/seed-coworker-identity-files.js';
import { AdmitWorkspaceMember } from '../../../application/workspaces/admit-workspace-member.js';
import {
  CreateCoworkerRequestSchema,
  CreateCoworkerResponseSchema,
} from '../../../contracts/agents.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
import type { Logger } from '../../../shared/observability/logger.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import {
  getAuthenticatedAccessContext,
  getRequestAccessContext,
} from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';
import { readBoundedJson } from '../read-bounded-json.js';
import { MAX_AGENT_REQUEST_BYTES } from '../../../contracts/agents.js';

/**
 * Product authoring facade over the existing immutable Agent package lifecycle.
 * The friendly draft never becomes a second persistence authority.
 */
export function registerCoworkerAuthoringRoute(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly agentRegistry: AgentRegistry;
    readonly coworkerProvisioning?: Pick<EnsureCoworkerConversation, 'execute'>;
    readonly workspaceMembers?: WorkspaceMembershipRepository;
    /**
     * Present so a Coworker can optionally be hired onto a named Computer.
     * Absent means the deployment has no Computer surface composed, and
     * `computer_id` in the request is then rejected rather than silently
     * dropped -- the caller asked for a placement this deployment cannot honor.
     */
    readonly computerRepository?: Pick<ComputerRepository, 'findById'>;
    /**
     * Present only where the Product Work surface is composed. A deployment
     * without it still hires Coworkers; they simply have no Work to run, and
     * `list_agent_workflows` says so honestly instead of listing a Capability
     * this deployment could never execute.
     */
    readonly defaultCapability?: Pick<
      EnsureCoworkerDefaultCapability,
      'execute'
    >;
    /**
     * Present only where the Chat plane is composed, because the Agent's own
     * workspace is the Chat plane's store. Without it a Coworker is still
     * hired; it simply starts with the identity its published instructions
     * carry and nothing it can edit.
     */
    readonly identityFiles?: Pick<SeedCoworkerIdentityFiles, 'execute'>;
    readonly logger?: Logger;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/coworkers', auth);
  const admission = dependencies.workspaceMembers
    ? new AdmitWorkspaceMember(dependencies.workspaceMembers)
    : null;

  app.post('/api/v1/coworkers', async (c) => {
    const parsed = CreateCoworkerRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_AGENT_REQUEST_BYTES),
    );
    if (!parsed.success)
      throw new HttpError(
        400,
        'invalid_request',
        'The Coworker draft is invalid.',
      );
    if (!dependencies.coworkerProvisioning)
      throw new HttpError(
        503,
        'coworker_chat_unavailable',
        'Coworker Chat is unavailable.',
      );

    const requestKey = c.req.header('idempotency-key')?.trim() ?? '';
    if (!requestKey)
      throw new HttpError(
        400,
        'invalid_idempotency_key',
        'An idempotency key is required.',
      );
    const source = compileCoworkerDraft({
      name: parsed.data.name,
      role: parsed.data.role,
      summary: parsed.data.summary,
      ...(parsed.data.instructions
        ? { instructions: parsed.data.instructions }
        : {}),
      modelPolicyRef: parsed.data.model_policy_ref,
      tools: parsed.data.tools,
      skills: parsed.data.skills,
    });
    const idempotencyRoot = `coworker-create:${createHash('sha256')
      .update(requestKey, 'utf8')
      .digest('hex')}`;

    try {
      validateAgentPackage(source);
      // Two principals, deliberately. The Agent itself is registered by the
      // service account so the whole tenant keeps seeing it on the roster --
      // hiring a Coworker adds a teammate, not a private pet. The first
      // Conversation is opened as the person who hired them, because that
      // Conversation is a direct message and a direct message has exactly one
      // human on the other end: whoever just clicked Create.
      const owner = getAuthenticatedAccessContext(c);
      const requester = getRequestAccessContext(c);
      if (parsed.data.computer_id !== undefined) {
        if (!dependencies.computerRepository)
          throw new HttpError(
            400,
            'computer_unavailable',
            'Computer placement is unavailable.',
          );
        const computer = await dependencies.computerRepository.findById({
          tenantId: owner.tenantId,
          workspaceId: owner.workspaceId,
          id: parsed.data.computer_id,
        });
        if (!computer)
          throw new HttpError(
            404,
            'computer_not_found',
            'The Computer does not exist in this workspace.',
          );
      }
      const imported = await importAgent(dependencies.agentRegistry, {
        accessContext: owner,
        idempotencyKey: `${idempotencyRoot}:import`,
        source,
        roleLabel: parsed.data.role,
        summary: parsed.data.summary,
        computerId: parsed.data.computer_id ?? null,
      });
      const published =
        imported.version.status === 'published'
          ? imported.version
          : await publishAgentVersion(dependencies.agentRegistry, {
              accessContext: owner,
              idempotencyKey: `${idempotencyRoot}:publish`,
              versionId: imported.version.id,
            });
      // Admission before provisioning: Work context is granted only to a
      // workspace member, and a first-time visitor whose first action is
      // hiring a Coworker has no membership row yet. Without this their new
      // Conversation would open without Work, silently.
      await admission?.execute(requester);
      const provisioned = await dependencies.coworkerProvisioning.execute({
        accessContext: requester,
        definition: imported.definition,
      });
      // The Coworker's own account of itself, written from what the person
      // typed. It is attached here rather than lazily on first turn so the
      // very first thing the Agent reads about itself is a file it owns and
      // can rewrite. A failure does not un-hire it: the Agent, its version
      // and its Conversation are already durable, and it still knows who it
      // is from its published instructions -- it just has nothing to edit.
      if (dependencies.identityFiles) {
        try {
          const files = await dependencies.identityFiles.execute({
            draft: {
              name: parsed.data.name,
              role: parsed.data.role,
              summary: parsed.data.summary,
              ...(parsed.data.instructions
                ? { instructions: parsed.data.instructions }
                : {}),
            },
            agentDefinitionId: imported.definition.id,
            accessContext: owner,
          });
          dependencies.logger?.log('info', 'coworker.identity_files', {
            agent_definition_id: imported.definition.id,
            paths: files.map((file) => file.path),
          });
        } catch (error) {
          dependencies.logger?.log('error', 'coworker.identity_files_failed', {
            agent_definition_id: imported.definition.id,
            error_name: error instanceof Error ? error.name : 'unknown',
            error_message: error instanceof Error ? error.message : undefined,
          });
        }
      }
      // Work is what makes this Coworker more than a chat persona, so it is
      // attached at hire time rather than left for a later authoring visit.
      // A failure here does not un-hire the Coworker: the Agent, its version
      // and its Conversation are already durable, and returning 500 would
      // strand them behind an error the person cannot act on. The Coworker
      // simply starts with no Capability, which every Work surface already
      // reports truthfully.
      if (dependencies.defaultCapability) {
        try {
          const capability = await dependencies.defaultCapability.execute({
            draft: {
              name: parsed.data.name,
              role: parsed.data.role,
              summary: parsed.data.summary,
              ...(parsed.data.instructions
                ? { instructions: parsed.data.instructions }
                : {}),
              modelPolicyRef: parsed.data.model_policy_ref,
            },
            agentDefinitionId: imported.definition.id,
            accessContext: owner,
            idempotencyKey: `${idempotencyRoot}:capability`,
          });
          if (capability)
            dependencies.logger?.log('info', 'coworker.default_capability', {
              agent_definition_id: imported.definition.id,
              work_definition_id: capability.definitionId,
              work_definition_version_id: capability.definitionVersionId,
            });
        } catch (error) {
          dependencies.logger?.log(
            'error',
            'coworker.default_capability_failed',
            {
              agent_definition_id: imported.definition.id,
              error_name: error instanceof Error ? error.name : 'unknown',
              error_message: error instanceof Error ? error.message : undefined,
            },
          );
        }
      }
      return c.json(
        CreateCoworkerResponseSchema.parse({
          agent_id: imported.definition.id,
          agent_version_id: published.id,
          conversation_id: provisioned.conversation.id,
        }),
        201,
      );
    } catch (error) {
      if (error instanceof InvalidIdempotencyKeyError)
        throw new HttpError(400, error.code, error.message);
      if (error instanceof IdempotencyConflictError)
        throw new HttpError(409, error.code, error.message);
      if (error instanceof AgentPackageValidationError)
        throw new HttpError(400, error.code, error.message);
      throw error;
    }
  });
}
