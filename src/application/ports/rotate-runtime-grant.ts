import type {
  RuntimeGenerationId,
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../domain/runtime/runtime-session.js';

export type RotateRuntimeGrantResult =
  | Readonly<{ readonly kind: 'rotated' }>
  | Readonly<{ readonly kind: 'denied'; readonly reason: string }>;

/** Rotates the grant bound to one exact runtime turn and generation. */
export interface RotateRuntimeGrant {
  execute(input: {
    readonly runtimeSessionId: RuntimeSessionId;
    readonly generationId: RuntimeGenerationId;
    readonly runtimeTurnId: RuntimeTurnId;
  }): Promise<RotateRuntimeGrantResult>;
}
