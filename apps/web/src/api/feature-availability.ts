/**
 * The server marks a workspace surface that is not composed with
 * `error.code === 'feature_unavailable'` on an HTTP 503. `ApiTransportError`
 * preserves that code as `.code`, and read clients that wrap a transport
 * failure to add read-shape context (see `features/work/clients/errors.ts`)
 * still forward the same code. This check stays structural rather than
 * binding to one error class so every caller sees the same answer.
 */
export function isFeatureUnavailable(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    (reason as { code?: unknown }).code === 'feature_unavailable'
  );
}

/**
 * Resource reads use a safe HTTP 404 to say that a previously shareable
 * selection is no longer available. Keep this structural for read clients
 * that wrap ApiTransportError while preserving its status.
 */
export function isResourceNotFound(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'status' in reason &&
    (reason as { status?: unknown }).status === 404
  );
}
