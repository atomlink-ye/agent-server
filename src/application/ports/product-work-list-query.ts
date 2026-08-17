import type { Work } from '../../domain/work/work.js';
import type { WorkRun } from '../../domain/work/work-run.js';
import type { WorkIdentityOwnerScope } from './work-identity-repository.js';

export interface ProductListQuery {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface ProductWorkListPage {
  readonly items: readonly Work[];
  readonly nextCursor: string | null;
}

export interface ProductWorkRunListPage {
  readonly items: readonly WorkRun[];
  readonly nextCursor: string | null;
}

export class InvalidProductWorkListCursorError extends Error {
  public readonly code = 'invalid_cursor';
  public constructor() {
    super('The requested Product Work list cursor is invalid.');
    this.name = 'InvalidProductWorkListCursorError';
  }
}

/**
 * Product read ordering is intentionally separate from the compatibility
 * WorkIdentity list seam. Canonical Work-first callers use latest-first reads;
 * legacy callers may retain the original oldest-first behavior.
 */
export interface ProductWorkListQuery {
  listWorksLatestFirst(
    owner: WorkIdentityOwnerScope,
    query: ProductListQuery,
  ): Promise<ProductWorkListPage>;
  listWorkRunsLatestFirst(
    owner: WorkIdentityOwnerScope,
    workId: string,
    query: ProductListQuery,
  ): Promise<ProductWorkRunListPage>;
}
