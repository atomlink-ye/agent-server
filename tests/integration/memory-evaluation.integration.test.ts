import { describe, expect, it } from 'vitest';
import dataset from '../../docs/evaluations/managed-single-agent-v1-memory-dataset.json' with { type: 'json' };
import { evaluateMemoryPolicy } from '../../src/domain/memory-policy/memory-policy.js';

describe('memory policy evaluation dataset', () => {
  it('has zero tolerance failures without exposing candidate content', () => {
    const counters = {
      unsafe_auto_accepts: 0,
      rejected_memory_leaks: 0,
      cross_workspace_leaks: 0,
      secret_exposures: 0,
    };
    for (const testCase of dataset.cases) {
      const decision = evaluateMemoryPolicy({
        mode: (testCase.mode ?? 'disabled') as
          'disabled' | 'proposal' | 'auto_safe',
        category: testCase.category,
        source: testCase.source as
          | 'current_user_message'
          | 'structured_system'
          | 'untrusted'
          | 'unknown',
        content: testCase.content,
        ...(testCase.existing ? { existingEntries: testCase.existing } : {}),
        ...(testCase.workspaceId ? { workspaceId: testCase.workspaceId } : {}),
      });
      if (
        testCase.mode === 'auto_safe' &&
        testCase.expected !== 'accept' &&
        decision.decision === 'accept'
      )
        counters.unsafe_auto_accepts++;
      if (testCase.expected === 'reject' && decision.decision === 'accept')
        counters.rejected_memory_leaks++;
      if (
        testCase.id === 'reject-cross-workspace' &&
        decision.decision === 'accept'
      )
        counters.cross_workspace_leaks++;
      if (
        testCase.id.startsWith('reject-secret') &&
        decision.decision === 'accept'
      )
        counters.secret_exposures++;
      expect(JSON.stringify(decision)).not.toContain(testCase.content);
    }
    expect(counters).toEqual({
      unsafe_auto_accepts: 0,
      rejected_memory_leaks: 0,
      cross_workspace_leaks: 0,
      secret_exposures: 0,
    });
  });
});
