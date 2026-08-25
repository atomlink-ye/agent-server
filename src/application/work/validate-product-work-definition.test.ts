import { describe, expect, it } from 'vitest';

import { validateProductWorkDefinition } from './validate-product-work-definition.js';

const SINGLE_WORKER = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: earnings-research
  description: Earnings research work
spec:
  kind: single_worker
  worker_version_id: 11111111-1111-4111-8111-111111111111
  environment_version_id: 22222222-2222-4222-8222-222222222222
  memory_version_ids: []
`;

describe('validateProductWorkDefinition', () => {
  it('returns a stable author-source fingerprint for equivalent YAML', () => {
    const first = validateProductWorkDefinition(SINGLE_WORKER);
    const second = validateProductWorkDefinition(
      SINGLE_WORKER.replace(
        'memory_version_ids: []',
        'memory_version_ids:\n    []',
      ),
    );

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    if (!first.valid || !second.valid) throw new Error('expected valid source');
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.metadata.normalizedName).toBe('earnings-research');
  });

  it('returns path-aware diagnostics without throwing for invalid author input', () => {
    const result = validateProductWorkDefinition(
      SINGLE_WORKER.replace(
        '11111111-1111-4111-8111-111111111111',
        'not-a-version-id',
      ),
    );

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid source');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.spec.worker_version_id',
          severity: 'error',
        }),
      ]),
    );
  });

  it('rejects duplicate YAML keys safely', () => {
    const result = validateProductWorkDefinition(
      `${SINGLE_WORKER}\nkind: Other\n`,
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid source');
    expect(result.diagnostics[0]).toMatchObject({
      path: '$',
      code: 'invalid_yaml',
      severity: 'error',
    });
  });
});
