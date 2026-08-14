import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  PRODUCTION_MUTATION_EXPECTATIONS,
  applyProductionMutation,
} from './c3-e8-production-mutation.mjs';

describe('C3 never-settle mutation shape', () => {
  it('keeps the initial list response settled and moves incompleteness to per-Work runs', () => {
    const source = 'setWorks(response.works);';
    const mutated = applyProductionMutation(source, 'never-settle');
    assert.match(mutated, /setWorks\(response\.works\);/u);
    assert.match(mutated, /response\.works\.length > 0/u);
    assert.match(mutated, /\/runs\?c3_e8_observation_missing=ledger/u);
    assert.match(mutated, /x-c3-e8-observation/u);
    assert.equal(mutated.includes("readJson<WorkListResponse>('/api/works?c3_e8_observation_missing=ledger')"), false);
    assert.equal(PRODUCTION_MUTATION_EXPECTATIONS['never-settle'],
      'c3_e8_observation_missing:reason=request-ledger-incomplete');
  });
});
