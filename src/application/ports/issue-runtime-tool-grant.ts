import type {
  RuntimeGenerationId,
  RuntimeGrantId,
  RuntimeSessionId,
} from '../../domain/runtime/runtime-session.js';

/** Issues the durable bootstrap authorization required before provider creation. */
export interface IssueRuntimeToolGrant {
  issue(input: {
    readonly runtimeSessionId: RuntimeSessionId;
    readonly generationId: RuntimeGenerationId;
    readonly catalogDigest: string;
  }): Promise<{ readonly grantId: RuntimeGrantId }>;

  /** Compensates a bootstrap grant when its provider generation cannot activate. */
  revoke(grantId: RuntimeGrantId): Promise<void>;
}
