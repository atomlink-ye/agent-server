import type {
  RuntimeGenerationId,
  RuntimeGrantId,
  RuntimeSessionId,
  RuntimeTurnId,
} from '../../domain/runtime/runtime-session.js';

/** The immutable durable grant projection used by runtime authorization. */
export interface RuntimeGrantRecord {
  readonly id: RuntimeGrantId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly generationId: RuntimeGenerationId;
  readonly runtimeTurnId: RuntimeTurnId | null;
  readonly tokenHash: string;
  readonly catalogDigest: string;
  readonly allowedTools: readonly string[];
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

/** Reads grant rows only; it does not cache or make policy decisions. */
export interface RuntimeGrantReader {
  findByTokenHash(tokenHash: string): Promise<RuntimeGrantRecord | null>;
  findById(id: RuntimeGrantId): Promise<RuntimeGrantRecord | null>;
}
