import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_TEAM_TOOL_REFS,
  SUPPORTED_MANAGED_AGENT_TOOL_REFS,
} from '../agents/built-in-skills.js';
export {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_TEAM_TOOL_REFS,
} from '../agents/built-in-skills.js';
export const AGENT_SERVER_MEMORY_READ_MCP_NAME = 'agent_server_memory_read';

export type RuntimeToolGrant = Readonly<{
  readonly grantId: string;
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly productSessionId: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly teamMemberRunId?: string;
  readonly allowedTools: readonly string[];
  readonly expiresAt: string;
}>;

export type RuntimeToolGrantReceipt = Readonly<{
  readonly grantId: string;
  readonly workspaceId: string;
  readonly productSessionId: string;
  readonly allowedTools: readonly string[];
  readonly expiresAt: string;
}>;

export type RuntimeToolGrantIssue = Readonly<{
  readonly receipt: RuntimeToolGrantReceipt;
  readonly token: string;
}>;

type StoredGrant = RuntimeToolGrant & { readonly tokenHash: Buffer };

export class RuntimeToolGrantService {
  readonly #grants = new Map<string, StoredGrant>();

  public issue(input: {
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly productSessionId: string;
    readonly taskId?: string;
    readonly runId?: string;
    readonly teamMemberRunId?: string;
    readonly allowedTools?: readonly string[];
    readonly ttlMs?: number;
  }): RuntimeToolGrantIssue {
    this.pruneExpired();
    const allowedTools = input.allowedTools ?? [
      AGENT_SERVER_MEMORY_READ_TOOL_REF,
    ];
    if (
      new Set(allowedTools).size !== allowedTools.length ||
      allowedTools.some((tool) => !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool))
    )
      throw new Error('Unsupported or duplicate runtime tool ref.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + Math.max(1, input.ttlMs ?? 15 * 60 * 1000),
    ).toISOString();
    const grant: StoredGrant = {
      grantId: randomUUID(),
      tenantId: input.tenantId,
      principalType: input.principalType,
      principalId: input.principalId,
      workspaceId: input.workspaceId,
      productSessionId: input.productSessionId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.teamMemberRunId
        ? { teamMemberRunId: input.teamMemberRunId }
        : {}),
      allowedTools: Object.freeze([...allowedTools]),
      expiresAt,
      tokenHash: hashToken(token),
    };
    this.#grants.set(grant.grantId, grant);
    return Object.freeze({
      receipt: Object.freeze({
        grantId: grant.grantId,
        workspaceId: grant.workspaceId,
        productSessionId: grant.productSessionId,
        allowedTools: grant.allowedTools,
        expiresAt,
      }),
      token,
    });
  }

  public resolve(token: string): RuntimeToolGrant | null {
    this.pruneExpired();
    const hash = hashToken(token);
    for (const grant of this.#grants.values()) {
      if (
        grant.tokenHash.length !== hash.length ||
        !timingSafeEqual(grant.tokenHash, hash)
      )
        continue;
      if (Date.parse(grant.expiresAt) <= Date.now()) return null;
      const { tokenHash: _tokenHash, ...publicGrant } = grant;
      return publicGrant;
    }
    return null;
  }

  public revoke(grantId: string): void {
    this.#grants.delete(grantId);
  }

  public refreshForSession(
    productSessionId: string,
    allowedTools: readonly string[],
    ttlMs = 15 * 60 * 1000,
  ): void {
    if (
      new Set(allowedTools).size !== allowedTools.length ||
      allowedTools.some((tool) => !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool))
    )
      throw new Error('Unsupported or duplicate runtime tool ref.');
    const expiresAt = new Date(Date.now() + Math.max(1, ttlMs)).toISOString();
    for (const [grantId, grant] of this.#grants) {
      if (
        grant.productSessionId !== productSessionId ||
        grant.allowedTools.length !== allowedTools.length ||
        grant.allowedTools.some((tool, index) => tool !== allowedTools[index])
      )
        continue;
      this.#grants.set(grantId, { ...grant, expiresAt });
    }
  }

  private pruneExpired(): void {
    // Expired grants remain as non-authorizing records so a still-live
    // RuntimeSession can refresh the same bearer token before continuation.
  }
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
