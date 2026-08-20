import type { ProductState } from '../../contracts/product-projection/index.js';

export interface WorkChatWakeWorkKey {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workId: string;
}

export interface WorkChatWakeStateRepository {
  getLastObserved(input: WorkChatWakeWorkKey): Promise<ProductState | null>;
  saveObserved(
    input: WorkChatWakeWorkKey & {
      readonly state: ProductState;
      readonly observedAt: string;
    },
  ): Promise<void>;
}
