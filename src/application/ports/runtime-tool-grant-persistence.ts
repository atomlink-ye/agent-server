import type {
  RuntimeActiveTurn,
  RuntimeToolChatContext,
} from '../extensions/runtime-tool-grant-service.js';

export interface PersistedRuntimeToolGrant {
  readonly grantId: string;
  readonly tokenHashHex: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly productSessionId?: string;
  readonly scopeId: string;
  readonly teamMemberRunId?: string;
  readonly teamRunId?: string;
  readonly allowedTools: readonly string[];
  readonly catalogTools: readonly string[];
  readonly activeTurn: RuntimeActiveTurn | null;
  readonly chatContext?: RuntimeToolChatContext;
  readonly expiresAt: string;
  readonly renewableUntil?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Durable authority for runtime bearer metadata. Plaintext bearer tokens never enter this port. */
export interface RuntimeToolGrantPersistence {
  loadRecoverable(now: string): Promise<readonly PersistedRuntimeToolGrant[]>;
  save(grant: PersistedRuntimeToolGrant): Promise<void>;
  revoke(grantId: string, revokedAt: string): Promise<void>;
  revokeForTeamRun(teamRunId: string, revokedAt: string): Promise<void>;
}
