import type { Hono } from 'hono';

import type { SkillCatalogPort } from '../../../application/extensions/skill-catalog.js';
import { ServiceAccountAuthenticator } from '../../../application/control-plane/service-account-authenticator.js';
import { SkillListResponseSchema } from '../../../contracts/skills.js';
import type { AppConfig } from '../../../shared/config.js';
import { requireServiceAccountAccess } from '../authentication.js';
import type { ApiEnvironment } from '../http-types.js';

export function registerSkillRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: {
    readonly config: AppConfig;
    readonly skillCatalog: Pick<SkillCatalogPort, 'list'>;
  },
): void {
  const auth = requireServiceAccountAccess(
    new ServiceAccountAuthenticator(dependencies.config.serviceAccounts ?? []),
  );
  app.use('/api/v1/skills', auth);

  app.get('/api/v1/skills', async (context) => {
    const skills = await dependencies.skillCatalog.list();
    return context.json(
      SkillListResponseSchema.parse({
        skills: skills.map((skill) => ({
          ref: skill.ref,
          name: skill.name,
          required_tool_refs: skill.requiredToolRefs,
        })),
      }),
      200,
    );
  });
}
