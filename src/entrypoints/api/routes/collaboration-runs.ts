import type { Hono } from 'hono';

import { ProjectCollaborationRun } from '../../../application/collaboration/project-collaboration-run.js';
import type { TeamExecutionRepository } from '../../../application/ports/team-execution-repository.js';
import type { TeamMessageRepository } from '../../../application/ports/team-message-repository.js';
import { CollaborationRunResponseSchema } from '../../../contracts/collaboration.js';
import type { AppConfig } from '../../../shared/config.js';
import type { ApiEnvironment } from '../http-types.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { getAuthenticatedAccessContext } from '../../../platform/access-context.js';
import { requireServiceAccountAccess } from '../authentication.js';

export interface CollaborationRunRouteDependencies {
  readonly config: AppConfig;
  readonly teamExecutions: TeamExecutionRepository;
  readonly teamMessages: TeamMessageRepository;
}

export function registerCollaborationRunRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: CollaborationRunRouteDependencies,
): void {
  const authenticate = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  const project = new ProjectCollaborationRun(
    dependencies.teamExecutions,
    dependencies.teamMessages,
  );

  app.get(
    '/api/v1/team-runs/:teamRunId/collaboration',
    authenticate,
    async (context) => {
      const access = getAuthenticatedAccessContext(context);
      const value = await project.project(context.req.param('teamRunId'), {
        tenantId: access.tenantId,
        workspaceId: access.workspaceId,
        principalType: access.principalType,
        principalId: access.principalId,
      });
      if (!value)
        return context.json(
          {
            error: {
              code: 'team_not_found',
              message: 'The collaboration run was not found.',
              request_id: context.get('requestId'),
            },
          },
          404,
        );
      return context.json(CollaborationRunResponseSchema.parse(value), 200);
    },
  );
}
