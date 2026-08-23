import type {
  RuntimeGenerationId,
  RuntimeGrantId,
  RuntimeScope,
  RuntimeSessionId,
  RuntimeSessionOwner,
} from '../../domain/runtime/runtime-session.js';

/** Issues the durable bootstrap authorization required before provider creation. */
export interface IssueRuntimeToolGrant {
  issue(input: {
    readonly runtimeSessionId: RuntimeSessionId;
    readonly generationId: RuntimeGenerationId;
    readonly tenantId: string;
    readonly principal: Pick<RuntimeSessionOwner, 'principalType' | 'principalId'>;
    readonly scope: RuntimeScope;
    readonly catalogDigest: string;
    readonly allowedTools: readonly string[];
  }): Promise<{ readonly grantId: RuntimeGrantId; readonly token: string }>;

  /** Compensates a bootstrap grant when its provider generation cannot activate. */
  revoke(grantId: RuntimeGrantId): Promise<void>;
}
