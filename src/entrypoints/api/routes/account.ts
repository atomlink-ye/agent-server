import type { Hono } from 'hono';

import type { WorkspaceMembershipRepository } from '../../../application/ports/workspace-membership-repository.js';
import { RenameWorkspaceMember } from '../../../application/workspaces/rename-workspace-member.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { getRequestAccessContext } from '../access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';
import { readBoundedJson } from '../read-bounded-json.js';
import type { ApiEnvironment } from '../http-types.js';
import type { AppConfig } from '../../../shared/config.js';
import { HttpError } from '../../../contracts/http.js';
import {
  AccountResponseSchema,
  SetDisplayNameRequestSchema,
  SetDisplayNameResponseSchema,
} from '../../../contracts/account.js';

const MAX_REQUEST_BYTES = 4 * 1024;

export interface AccountRouteDependencies {
  readonly config: AppConfig;
  readonly workspaceMembers: WorkspaceMembershipRepository;
}

/**
 * The caller's own identity, distinct from the Coworker/Conversation
 * surfaces: this is where a person is read and named as themselves, not as a
 * message author or a hired Coworker.
 */
export function registerAccountRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: AccountRouteDependencies,
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/account', auth);
  app.use('/api/v1/account/*', auth);
  const renameMember = new RenameWorkspaceMember(dependencies.workspaceMembers);

  app.get('/api/v1/account', async (c) => {
    const access = getRequestAccessContext(c);
    const names = await dependencies.workspaceMembers.findDisplayNames({
      tenantId: access.tenantId,
      workspaceId: access.workspaceId,
      principalIds: [access.principalId],
    });
    return c.json(
      AccountResponseSchema.parse({
        principal_id: access.principalId,
        principal_type: access.principalType,
        display_name: names.get(access.principalId) ?? null,
      }),
    );
  });

  app.patch('/api/v1/account/display-name', async (c) => {
    const parsed = SetDisplayNameRequestSchema.safeParse(
      await readBoundedJson(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!parsed.success)
      throw new HttpError(400, 'invalid_request', 'The request is invalid.');
    const access = getRequestAccessContext(c);
    try {
      await renameMember.execute({
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        principalType: access.principalType,
        principalId: access.principalId,
        displayName: parsed.data.display_name,
      });
    } catch (error) {
      throw new HttpError(
        400,
        'invalid_request',
        error instanceof Error ? error.message : 'The request is invalid.',
      );
    }
    return c.json(
      SetDisplayNameResponseSchema.parse({
        display_name: parsed.data.display_name.trim(),
      }),
    );
  });
}
