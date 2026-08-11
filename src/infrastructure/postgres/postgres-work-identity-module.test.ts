import { describe, expect, it } from 'vitest';

import { createPostgresWorkIdentityModule } from './postgres-work-identity-repository.js';

describe('Postgres Work identity module', () => {
  it('does not let the raw write repository escape through its query facade', () => {
    const module = createPostgresWorkIdentityModule({
      database: {
        async query<Row>() {
          return { rows: [] as Row[] };
        },
      },
      definitions: {
        findTeamDefinitionById: async () => null,
        findPublishedTeamVersionById: async () => null,
      },
      execution: {
        admitRoot: async () => {
          throw new Error('not called by module construction');
        },
      },
    });

    expect(Object.keys(module.workIdentityQuery).sort()).toEqual([
      'findWorkById',
      'findWorkRunById',
    ]);
    expect(module.workIdentityQuery).not.toHaveProperty('createWork');
    expect(module.workIdentityQuery).not.toHaveProperty('bindRootTaskCas');
    expect(module.workIdentityQuery).not.toHaveProperty(
      'appendResolvedManifest',
    );
  });
});
