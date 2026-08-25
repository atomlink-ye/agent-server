import type { AuthorizedRuntimeToolContext } from './authorize-runtime-tool.js';

export interface SyntheticToolReceipt {
  recordSuccessfulInvocation(input: {
    readonly grant: AuthorizedRuntimeToolContext;
    readonly toolRef: string;
  }): void;
  hasExactlyOne(input: {
    readonly grant: AuthorizedRuntimeToolContext;
    readonly toolRef: string;
  }): boolean;
}

type ReceiptInput = {
  readonly grant: AuthorizedRuntimeToolContext;
  readonly toolRef: string;
};

/**
 * Process-local proof that a registered synthetic tool completed in one
 * active runtime turn. Losing the process intentionally loses the proof.
 */
export function createSyntheticToolReceipt(): SyntheticToolReceipt {
  const completedByKey = new Map<string, number>();
  const keyFor = (input: {
    readonly grant: AuthorizedRuntimeToolContext;
    readonly toolRef: string;
  }): string | null => {
    const activeTurn = input.grant.activeTurn;
    if (!activeTurn) return null;
    return `${input.grant.turn.id}:${activeTurn.runId}:${input.toolRef}`;
  };

  return Object.freeze({
    recordSuccessfulInvocation(input: ReceiptInput) {
      const key = keyFor(input);
      if (!key) return;
      completedByKey.set(key, (completedByKey.get(key) ?? 0) + 1);
    },
    hasExactlyOne(input: ReceiptInput) {
      const key = keyFor(input);
      return key !== null && completedByKey.get(key) === 1;
    },
  });
}
