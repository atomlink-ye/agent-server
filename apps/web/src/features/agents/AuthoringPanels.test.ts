import { describe, expect, it } from 'vitest';

import { capabilityBindingFromApply } from './AuthoringPanels';

describe('Capability apply binding translation', () => {
  it('maps the applied version id to the binding contract', () => {
    expect(
      capabilityBindingFromApply({
        definitionId: 'definition-id',
        versionId: 'version-id',
      }),
    ).toEqual({
      definitionId: 'definition-id',
      definitionVersionId: 'version-id',
    });
  });
});
