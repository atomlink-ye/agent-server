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
import type { WorkspaceMembershipRepository } from '../../../application/ports/workspace-membership-repository.js';
import type { EnsureCoworkerConversation } from '../../../application/chat/ensure-coworker-conversation.js';
import { AdmitWorkspaceMember } from '../../../application/workspaces/admit-workspace-member.js';
import {
  CreateCoworkerRequestSchema,
  CreateCoworkerResponseSchema,
} from '../../../contracts/agents.js';
import { HttpError } from '../../../contracts/http.js';
import type { AppConfig } from '../../../shared/config.js';
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
      const imported = await importAgent(dependencies.agentRegistry, {
        accessContext: owner,
        idempotencyKey: `${idempotencyRoot}:import`,
        source,
        roleLabel: parsed.data.role,
        summary: parsed.data.summary,
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
