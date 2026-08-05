import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,
  SUPPORTED_MANAGED_AGENT_TOOL_REFS,
} from '../agents/built-in-skills.js';
export {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  AGENT_SERVER_CANONICAL_TEAM_TOOL_REFS,
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
  readonly contextEpoch?: string;
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
  readonly #activeCalls = new Map<string, number>();

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
    readonly contextEpoch?: string;
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
      ...(input.contextEpoch ? { contextEpoch: input.contextEpoch } : {}),
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
    this.#activeCalls.delete(grantId);
  }

  public beginToolCall(grantId: string): RuntimeToolGrant {
    const grant = this.get(grantId);
    if (!grant || Date.parse(grant.expiresAt) <= Date.now())
      throw new Error('Runtime grant not found.');
    this.#activeCalls.set(grantId, (this.#activeCalls.get(grantId) ?? 0) + 1);
    return grant;
  }

  public endToolCall(grantId: string): void {
    const count = this.#activeCalls.get(grantId) ?? 0;
    if (count <= 1) this.#activeCalls.delete(grantId);
    else this.#activeCalls.set(grantId, count - 1);
  }

  public activeToolCalls(grantId: string): number {
    return this.#activeCalls.get(grantId) ?? 0;
  }

  public isToolAllowed(grantId: string, toolRef: string): boolean {
    this.pruneExpired();
    const grant = this.#grants.get(grantId);
    return Boolean(
      grant &&
      Date.parse(grant.expiresAt) > Date.now() &&
      grant.allowedTools.includes(toolRef),
    );
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
      if (grant.productSessionId !== productSessionId) continue;
      this.#grants.set(grantId, {
        ...grant,
        allowedTools: Object.freeze([...allowedTools]),
        expiresAt,
      });
    }
  }

  /** Refresh only turn-bound fields; the bearer, grant id and member binding remain stable. */
  public refreshForTeamMember(input: {
    readonly grantId?: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly allowedTools: readonly string[];
    readonly contextEpoch: string;
    readonly ttlMs?: number;
  }): RuntimeToolGrant {
    const matches = [...this.#grants.values()].filter(
      (candidate) =>
        candidate.teamMemberRunId === input.teamMemberRunId &&
        candidate.productSessionId === input.scopeId,
    );
    if (matches.length !== 1)
      throw new Error('Runtime grant scope is ambiguous.');
    const grant = input.grantId
      ? matches.find((candidate) => candidate.grantId === input.grantId)
      : matches[0];
    if (!grant || !grant.teamMemberRunId)
      throw new Error('Runtime grant not found.');
    if (this.activeToolCalls(grant.grantId) > 0)
      throw new Error('Runtime turn refresh fence is active.');
    validateTools(input.allowedTools);
    const updated: StoredGrant = {
      ...grant,
      taskId: input.taskId,
      runId: input.runId,
      allowedTools: Object.freeze([...input.allowedTools]),
      contextEpoch: input.contextEpoch,
      expiresAt: new Date(
        Date.now() + Math.max(1, input.ttlMs ?? 15 * 60 * 1000),
      ).toISOString(),
    };
    this.#grants.set(grant.grantId, updated);
    const { tokenHash: _tokenHash, ...publicGrant } = updated;
    return publicGrant;
  }

  public get(grantId: string): RuntimeToolGrant | null {
    const grant = this.#grants.get(grantId);
    if (!grant) return null;
    const { tokenHash: _tokenHash, ...publicGrant } = grant;
    return publicGrant;
  }

  public getForTeamMember(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }): RuntimeToolGrant | null {
    const matches = [...this.#grants.values()].filter(
      (grant) =>
        grant.teamMemberRunId === input.teamMemberRunId &&
        grant.productSessionId === input.scopeId,
    );
    if (matches.length > 1)
      throw new Error('Runtime grant scope is ambiguous.');
    if (!matches[0]) return null;
    const { tokenHash: _tokenHash, ...publicGrant } = matches[0];
    return publicGrant;
  }

  private pruneExpired(): void {
    // Expired grants remain as non-authorizing records so a still-live
    // RuntimeSession can refresh the same bearer token before continuation.
  }
}

function validateTools(allowedTools: readonly string[]): void {
  if (
    new Set(allowedTools).size !== allowedTools.length ||
    allowedTools.some((tool) => !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool))
  )
    throw new Error('Unsupported or duplicate runtime tool ref.');
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
