/**
 * Product controls were measured on a real in-flight Team Run and deliberately
 * withheld from revision 1. Keep this declaration explicit: an empty endpoint
 * list alone would be indistinguishable from an unfinished lane.
 */
export const PRODUCT_ACCEPTED_SUBSET_CONTROL_CAPABILITIES = [
  {
    id: 'cancel_work_run',
    availability: 'explicitly_unavailable',
  },
  {
    id: 'decide_completion',
    availability: 'explicitly_unavailable',
  },
] as const;

/**
 * The controls capability is present in the contract fragment, but neither
 * control endpoint is part of the accepted endpoint set after the paired
 * downgrade decision.
 */
export const PRODUCT_ACCEPTED_SUBSET_CONTROL_ENDPOINTS = [] as const;
