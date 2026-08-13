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
    exit(0);
    return 0;
  } catch (error) {
    output(
      `${JSON.stringify(
        projectStandaloneMutationFailure(error, { secretValues }),
      )}\n`,
    );
    exit(1);
    return 1;
  }
}
