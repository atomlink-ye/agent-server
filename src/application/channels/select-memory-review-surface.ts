import {
  selectReviewSurfaceMode,
  type ReviewSurfaceMode,
} from '../../domain/channels/lark-memory-review-surface.js';

export interface MemoryReviewSurfaceSelection {
  readonly mode: ReviewSurfaceMode;
  readonly commandOnlyFallback: boolean;
}

export function selectMemoryReviewSurface(input: {
  readonly content: string;
  readonly cardDeliveryAvailable?: boolean;
}): MemoryReviewSurfaceSelection {
  if (input.cardDeliveryAvailable === false) {
    return { mode: 'command_only', commandOnlyFallback: true };
  }
  return {
    mode: selectReviewSurfaceMode(input.content),
    commandOnlyFallback: false,
  };
}
