/**
 * Product controls were measured on a real in-flight Team Run. `decide_completion`
 * was deliberately withheld from revision 1, but that downgrade's rationale was
 * never recorded, and the UI already promises `needs_you`. Per governance
 * decision D-4 (2026-08-19 round, DECISIONS.md), the downgrade is reversed for
 * `decide_completion`; `cancel_work_run` remains withheld (a separate, still-
 * documented gap — cancellation itself is not correctly implemented yet).
 */
export const PRODUCT_ACCEPTED_SUBSET_CONTROL_CAPABILITIES = [
  {
    id: 'cancel_work_run',
    availability: 'explicitly_unavailable',
  },
  {
    id: 'decide_completion',
    availability: 'available',
  },
] as const;

/**
 * The controls capability is present in the contract fragment. `decide_completion`
 * is now backed by a real endpoint (D-4); `cancel_work_run` is not.
 */
export const PRODUCT_ACCEPTED_SUBSET_CONTROL_ENDPOINTS = [
  'POST /api/v1/works/{work_id}/runs/{work_run_id}/completion-decision',
] as const;
