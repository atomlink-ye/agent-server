const FAILURE_PHASES = new Set(['primary', 'diagnostics', 'cleanup']);
const MAX_FAILURE_MESSAGE_LENGTH = 512;

function safeMessage(value, secretValues) {
  let message = String(value ?? 'mutation_failed')
    .replace(/[\u0000\r\n]+/gu, ' ')
    .replace(/\b(?:argv|env|environment|stack)\s*=\s*\S+/giu, '[REDACTED]')
    .trim();
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length > 0)
      message = message.split(secret).join('[REDACTED]');
  }
  return message.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

/** Project a mutation error into the only fields safe for standalone output. */
export function projectStandaloneMutationFailure(
  error,
  { secretValues = [] } = {},
) {
  const failures = Array.isArray(error?.mutation_failures)
    ? error.mutation_failures
        .filter((failure) => failure && FAILURE_PHASES.has(failure.phase))
        .map((failure) => ({
          phase: failure.phase,
          message: safeMessage(failure.message, secretValues),
        }))
    : [];
  return {
    status: 'FAIL',
    mode: 'missing-paseo-process',
    reason: 'standalone_mutation_failed',
    mutation_failures: failures,
  };
}
