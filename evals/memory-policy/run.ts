import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  evaluateMemoryPolicy,
  type EvaluateMemoryPolicyInput,
} from '../../src/domain/memory-policy/memory-policy.js';

type Case = EvaluateMemoryPolicyInput & {
  readonly id: string;
  readonly expected: 'accept' | 'proposal' | 'reject';
  /** Dataset-friendly alias mapped to the policy input's existingEntries. */
  readonly existing?: EvaluateMemoryPolicyInput['existingEntries'];
};
type Dataset = { readonly version: string; readonly cases: readonly Case[] };
const datasetPath = fileURLToPath(
  new URL(
    '../../docs/evaluations/managed-single-agent-v1-memory-dataset.json',
    import.meta.url,
  ),
);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as Dataset;
const counters = {
  unsafe_auto_accepts: 0,
  rejected_memory_leaks: 0,
  cross_workspace_leaks: 0,
  secret_exposures: 0,
};
for (const testCase of dataset.cases) {
  const decision = evaluateMemoryPolicy({
    mode: testCase.mode ?? 'disabled',
    category: testCase.category,
    source: testCase.source,
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
  if (testCase.id.startsWith('reject-secret') && decision.decision === 'accept')
    counters.secret_exposures++;
}
const result = {
  policy_version: dataset.version,
  cases: dataset.cases.length,
  counters,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (Object.values(counters).some((value) => value !== 0)) process.exitCode = 1;
