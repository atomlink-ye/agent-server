import { describe, expect, it } from 'vitest';

import { validateProductWorkDefinition } from './validate-product-work-definition.js';

const lead = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const environment = '33333333-3333-4333-8333-333333333333';

const SOURCE = `apiVersion: agentserver.dev/v1alpha1
kind: WorkDefinition
metadata:
  name: investment-review
spec:
  kind: collaboration
  lead:
    name: lead
    worker_version_id: ${lead}
  members:
    - name: risk
      worker_version_id: ${member}
  environment_version_id: ${environment}
  input_schema:
    type: object
    properties:
      question:
        type: string
    required: [question]
    additional_properties: false
`;

describe('Product Work Definition collaboration contract', () => {
  it('declares participants directly without exposing an internal Team id', () => {
    const result = validateProductWorkDefinition(SOURCE);
    expect(result.valid).toBe(true);
    if (!result.valid)
      throw new Error('expected valid collaboration Definition');
    expect(result.document.spec.kind).toBe('collaboration');
    if (result.document.spec.kind !== 'collaboration') return;
    expect(result.document.spec.lead).toMatchObject({
      name: 'lead',
      worker_version_id: lead,
    });
    expect(result.document.spec.members).toEqual([
      expect.objectContaining({ name: 'risk', worker_version_id: member }),
    ]);
    expect(result.document.spec).not.toHaveProperty('team_version_id');
  });

  it('rejects duplicate participant names', () => {
    const result = validateProductWorkDefinition(
      SOURCE.replace('    - name: risk', '    - name: lead'),
    );
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected duplicate name rejection');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.spec.members[0].name',
          severity: 'error',
        }),
      ]),
    );
  });
});
