/**
 * An unexpected failure used to log only `error.name`, which for the failures
 * that actually reach here is either `Error` or something equally
 * contentless. That is not enough to find the fault, so the one signal an
 * operator has told them only that something threw.
 *
 * The response stays opaque. What widens is the server-side record: the
 * message, the cause chain, and the first stack frame. Frames are reported
 * repository-relative because absolute paths on a developer or CI machine are
 * private local paths, which must not enter logs.
 */
export function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error))
    return { error_name: 'unknown', error_value: typeof error };
  const causes: string[] = [];
  let cause: unknown = error.cause;
  while (cause instanceof Error && causes.length < 4) {
    causes.push(`${cause.name}: ${cause.message}`);
    cause = cause.cause;
  }
  const frame = error.stack
    ?.split('\n')
    .slice(1)
    .find((line) => line.includes('/'))
    ?.trim();
  return {
    error_name: error.name,
    error_message: error.message,
    ...(frame ? { error_frame: repositoryRelative(frame) } : {}),
    ...(causes.length > 0 ? { error_causes: causes } : {}),
  };
}

function repositoryRelative(frame: string): string {
  const marker = '/agent-server/';
  const index = frame.lastIndexOf(marker);
  return index === -1 ? frame : frame.slice(index + marker.length);
}
