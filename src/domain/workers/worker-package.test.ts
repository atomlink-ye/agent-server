import { describe, expect, it } from 'vitest';

import { parseWorkerPackage } from './worker-package.js';

const yaml = (extra = '') => `apiVersion: agent-server/v1alpha1
kind: Worker
metadata:
  name: execution-worker
spec:
  description: Executes formal Work
  instructions: Complete the assigned Work.
  runtime: { provider: paseo, modelPolicyRef: free-only, mode: isolated }
  tools:
    - ref: agent-server/memory-read
      kind: tool
  skills: []
  input: { schema: { type: object, properties: {}, additionalProperties: false }, prompt: Work }
  session: { invocation: fresh_per_invocation, followUps: queued, binding: reusable }
  memory: { policy: workspace_snapshot, proposalLimit: 0 }
  permissions: { network: none, filesystem: none }
  completion: { type: executable, command: done }
${extra}`;

describe('Worker package', () => {
  it('accepts an explicitly typed tool without treating it as the resource kind', () => {
    expect(parseWorkerPackage(yaml()).package.spec.tools).toEqual([
      { ref: 'agent-server/memory-read', kind: 'tool' },
    ]);
  });

  it('rejects duplicate top-level resource kinds', () => {
    expect(() =>
      parseWorkerPackage(
        yaml().replace('kind: Worker\n', 'kind: Worker\nkind: Worker\n'),
      ),
    ).toThrow('invalid_worker_kind');
  });

  it.each([
    ['missing', yaml().replace('kind: Worker\n', '')],
    ['wrong', yaml().replace('kind: Worker', 'kind: ManagedAgent')],
  ])('rejects a %s top-level resource kind', (_case, source) => {
    expect(() => parseWorkerPackage(source)).toThrow('invalid_worker_kind');
  });
});
