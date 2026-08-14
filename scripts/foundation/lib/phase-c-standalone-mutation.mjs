import { projectStandaloneMutationFailure } from './phase-c-mutation-failure.mjs';

/**
 * Execute a standalone mutation and serialize only its bounded result.
 * The injected exit adapter is authoritative; the helper is deliberately
 * adapter-based so the exact catch/output/exit flow can be tested without Docker.
 */
export async function executeStandaloneMutation({
  runMutation,
  output,
  exit,
  secretValues = [],
}) {
  try {
    const result = await runMutation();
    output(`${JSON.stringify(result)}\n`);
    const code = result?.status === 'MISSING' ? 2 : 0;
    exit(code);
    return code;
  } catch (error) {
    if (error?.standalone_result?.status === 'MISSING') {
      output(`${JSON.stringify(error.standalone_result)}\n`);
      exit(2);
      return 2;
    }
    output(
      `${JSON.stringify(
        projectStandaloneMutationFailure(error, { secretValues }),
      )}\n`,
    );
    exit(1);
    return 1;
  }
}

export function assertMutationEvaluatorOutcome({
  evaluationExit,
  evaluated,
  expectedExit,
  expectedStatus,
  expectedFailure,
  mode,
}) {
  if (evaluationExit === 2 && evaluated?.status === 'MISSING') {
    const error = new Error('mutation_evaluator_missing');
    error.standalone_result = {
      status: 'MISSING',
      mode,
      reason: String(evaluated.reason ?? 'mutation evidence is missing').slice(
        0,
        512,
      ),
    };
    throw error;
  }
  if (
    evaluationExit !== expectedExit ||
    evaluated?.status !== expectedStatus ||
    (expectedStatus === 'FAIL' &&
      JSON.stringify(evaluated.failures) !== JSON.stringify([expectedFailure]))
  )
    throw new Error('mutation_evaluator_outcome_invalid');
  return evaluated;
}
