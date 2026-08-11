import { PRODUCT_SOURCE_REF_KEYS } from './product-source-refs.js';

/** S4 schemas are intentionally provisional until S10 acceptance. */
export const PRODUCT_CONTRACT_STATUS = 'provisional' as const;
export const PRODUCT_WORK_CONTRACT_STATUS = PRODUCT_CONTRACT_STATUS;
export const PRODUCT_TECHNICAL_ID_CONTAINER = 'source_refs' as const;
export const PRODUCT_ALLOWED_SOURCE_REF_KEYS = PRODUCT_SOURCE_REF_KEYS;

export type ProductContractStatus = typeof PRODUCT_CONTRACT_STATUS;

export const PRODUCT_CONTRACT_POLICY = {
  status: PRODUCT_CONTRACT_STATUS,
  technicalIdContainer: PRODUCT_TECHNICAL_ID_CONTAINER,
  allowedSourceRefKeys: PRODUCT_ALLOWED_SOURCE_REF_KEYS,
} as const;
