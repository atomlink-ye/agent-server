import { describe, expect, it } from 'vitest';

import { planWhenBootstrapDigestIsIndeterminate } from './ensure-runtime-session.js';
import type { ReconciliationPlan } from '../../domain/runtime/reconciliation-plan.js';

const generationId = '11111111-1111-4111-8111-111111111111';

const reuse: ReconciliationPlan = { kind: 'reuse', generationId };
const replace: ReconciliationPlan = {
  kind: 'replace',
  generationId,
  reason: 'provider_missing',
};

describe('planWhenBootstrapDigestIsIndeterminate', () => {
  it('returns reuse when the provider cannot inspect bootstrap digest components', () => {
    expect(
      planWhenBootstrapDigestIsIndeterminate({
        plan: reuse,
        canInspectBootstrapDigestComponents: false,
      }),
    ).toEqual(reuse);
  });

  it('returns replace when the provider cannot inspect bootstrap digest components', () => {
    expect(
      planWhenBootstrapDigestIsIndeterminate({
        plan: replace,
        canInspectBootstrapDigestComponents: false,
      }),
    ).toEqual(replace);
  });

  it('throws when a digest-inspecting provider returns indeterminate on non-replace', () => {
    expect(() =>
      planWhenBootstrapDigestIsIndeterminate({
        plan: reuse,
        canInspectBootstrapDigestComponents: true,
      }),
    ).toThrow('runtime_provider_bootstrap_digest_indeterminate');
  });
});
