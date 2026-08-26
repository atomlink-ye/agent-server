import { describe, expect, it, vi } from 'vitest';

import { WorkCompositionResolutionError } from '../../domain/work/work-composition.js';
import { WorkIdentityApi } from './work-identity-api.js';

const accessContext = {
  tenantId: 'tenant',
  workspaceId: 'workspace',
  principalType: 'service_account' as const,
  principalId: 'principal',
  policySnapshotVersion: 'policy',
};

describe('WorkIdentityApi composition diagnostics', () => {
  it('preserves composition resolution message and path as validation error data', async () => {
    const createWork = vi.fn();
    const identity = new WorkIdentityApi({
      repository: { createWork } as never,
      definitions: {} as never,
      definitionResolution: {
        resolve: async () => {
          throw new WorkCompositionResolutionError(
            'The selected environment is unavailable.',
            '$.spec.environment_version_id',
          );
        },
      },
    });

    await expect(
      identity.createWork({
        owner: { tenantId: 'tenant', workspaceId: 'workspace' },
        accessContext,
        definitionId: 'definition',
        definitionVersionId: 'version',
        title: 'Work',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_work_definition',
      message: 'The selected environment is unavailable.',
      diagnosticPath: '$.spec.environment_version_id',
    });
    expect(createWork).not.toHaveBeenCalled();
  });
});
