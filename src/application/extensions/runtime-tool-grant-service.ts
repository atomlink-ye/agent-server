import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  AGENT_SERVER_MEMORY_READ_TOOL_REF,
  SUPPORTED_MANAGED_AGENT_TOOL_REFS,
} from '../agents/built-in-skills.js';
import type {
  PersistedRuntimeToolGrant,
  RuntimeToolGrantPersistence,
} from '../ports/runtime-tool-grant-persistence.js';

export { AGENT_SERVER_MEMORY_READ_TOOL_REF } from '../agents/built-in-skills.js';
export const AGENT_SERVER_MEMORY_READ_MCP_NAME = 'agent_server_memory_read';

export type RuntimeActiveTurn = Readonly<{
  readonly taskId: string;
  readonly runId: string;
  readonly contextEpoch: string;
}>;

export type RuntimeToolChatContext = Readonly<{
  readonly conversationId: string;
  readonly triggerMessageId: string;
}>;

export type RuntimeToolGrant = Readonly<{
  readonly grantId: string;
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly productSessionId?: string;
  readonly scopeId?: string;
  readonly teamMemberRunId?: string;
  readonly teamRunId?: string;
  readonly allowedTools: readonly string[];
  readonly catalogTools: readonly string[];
  readonly activeTurn: RuntimeActiveTurn | null;
  readonly chatContext?: RuntimeToolChatContext;
  readonly expiresAt: string;
}>;

export type RuntimeToolGrantReceipt = Readonly<{
  readonly grantId: string;
  readonly workspaceId: string;
  readonly productSessionId?: string;
  readonly scopeId: string;
  readonly allowedTools: readonly string[];
  readonly expiresAt: string;
}>;

export type RuntimeToolGrantIssue = Readonly<{
  readonly receipt: RuntimeToolGrantReceipt;
  readonly token: string;
}>;

type StoredGrant = RuntimeToolGrant & {
  readonly tokenHash: Buffer;
  readonly renewableUntil?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export interface RuntimeToolGrantScopeQuery {
  readonly tenantId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly productSessionId?: string;
  readonly scopeId?: string;
  readonly teamMemberRunId?: string;
  readonly teamRunId?: string;
}

export class RuntimeToolGrantService {
  readonly #grants = new Map<string, StoredGrant>();
  readonly #renewable = new Map<string, StoredGrant>();
  readonly #activeCalls = new Map<string, number>();
  #initialized = false;

  public constructor(
    private readonly persistence?: RuntimeToolGrantPersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async initialize(): Promise<void> {
    if (this.#initialized) return;
    const now = this.now();
    const recoverable = this.persistence
      ? await this.persistence.loadRecoverable(now.toISOString())
      : [];
    this.#grants.clear();
    this.#renewable.clear();
    for (const persisted of recoverable) {
      const grant = fromPersisted(persisted);
      if (
        isRenewableChatGrant(grant) &&
        Date.parse(grant.expiresAt) <= now.getTime()
      )
        this.#renewable.set(grant.grantId, grant);
      else if (
        Date.parse(grant.expiresAt) > now.getTime() ||
        grant.teamMemberRunId
      )
        this.#grants.set(grant.grantId, grant);
    }
    this.#initialized = true;
  }

  public async issue(input: {
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly productSessionId?: string;
    readonly scopeId?: string;
    readonly taskId?: string;
    readonly runId?: string;
    readonly teamMemberRunId?: string;
    readonly teamRunId?: string;
    readonly allowedTools?: readonly string[];
    readonly catalogTools?: readonly string[];
    readonly chatContext?: RuntimeToolChatContext;
    readonly contextEpoch?: string;
    readonly ttlMs?: number;
  }): Promise<RuntimeToolGrantIssue> {
    await this.initialize();
    this.pruneMemory();
    const allowedTools = input.allowedTools ?? [
      AGENT_SERVER_MEMORY_READ_TOOL_REF,
    ];
    const catalogTools = input.catalogTools ?? allowedTools;
    const scopeId = resolveScopeId(input);
    validateTools(allowedTools);
    validateTools(catalogTools);
    if (allowedTools.some((tool) => !catalogTools.includes(tool)))
      throw new Error('Runtime grant allowed tools exceed catalog.');
    if (input.chatContext) validateChatContext(input.chatContext);

    const activeTurn = activeTurnFromIssue(input);
    const existing = input.teamMemberRunId
      ? [...this.#grants.values()].filter(
          (candidate) =>
            candidate.teamMemberRunId === input.teamMemberRunId &&
            candidate.scopeId === scopeId,
        )
      : [];
    if (existing.some((grant) => this.activeToolCalls(grant.grantId) > 0))
      throw new Error('Runtime grant replacement fence is active.');
    for (const grant of existing) await this.revoke(grant.grantId);

    const token = randomBytes(32).toString('base64url');
    const issuedAt = this.now();
    const expiresAt = new Date(
      issuedAt.getTime() + Math.max(1, input.ttlMs ?? 15 * 60 * 1000),
    ).toISOString();
    const renewableUntil =
      input.chatContext &&
      input.productSessionId === undefined &&
      input.teamMemberRunId === undefined &&
      input.teamRunId === undefined
        ? new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : undefined;
    const timestamp = issuedAt.toISOString();
    const grant: StoredGrant = {
      grantId: randomUUID(),
      tenantId: input.tenantId,
      principalType: input.principalType,
      principalId: input.principalId,
      workspaceId: input.workspaceId,
      ...(input.productSessionId
        ? { productSessionId: input.productSessionId }
        : {}),
      scopeId,
      ...(input.teamMemberRunId
        ? { teamMemberRunId: input.teamMemberRunId }
        : {}),
      ...(input.teamRunId ? { teamRunId: input.teamRunId } : {}),
      allowedTools: Object.freeze([...allowedTools]),
      catalogTools: Object.freeze([...catalogTools]),
      activeTurn,
      ...(input.chatContext
        ? {
            chatContext: Object.freeze({
              conversationId: input.chatContext.conversationId,
              triggerMessageId: input.chatContext.triggerMessageId,
            }),
          }
        : {}),
      expiresAt,
      ...(renewableUntil ? { renewableUntil } : {}),
      tokenHash: hashToken(token),
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.persist(grant);
    this.#grants.set(grant.grantId, grant);
    return Object.freeze({
      receipt: Object.freeze({
        grantId: grant.grantId,
        workspaceId: grant.workspaceId,
        ...(grant.productSessionId
          ? { productSessionId: grant.productSessionId }
          : {}),
        scopeId: grant.scopeId!,
        allowedTools: grant.allowedTools,
        expiresAt,
      }),
      token,
    });
  }

  public resolve(token: string): RuntimeToolGrant | null {
    this.requireInitialized();
    this.pruneMemory();
    const hash = hashToken(token);
    for (const grant of this.#grants.values()) {
      if (
        grant.tokenHash.length !== hash.length ||
        !timingSafeEqual(grant.tokenHash, hash)
      )
        continue;
      if (Date.parse(grant.expiresAt) <= this.now().getTime()) return null;
      return publicGrant(grant);
    }
    return null;
  }

  public async findForScope(
    input: RuntimeToolGrantScopeQuery,
  ): Promise<RuntimeToolGrant | null> {
    await this.initialize();
    this.pruneMemory();
    const scopeId = resolveScopeId(input);
    const matches = [
      ...this.#grants.values(),
      ...this.#renewable.values(),
    ].filter(
      (grant) =>
        grant.tenantId === input.tenantId &&
        grant.principalType === input.principalType &&
        grant.principalId === input.principalId &&
        grant.workspaceId === input.workspaceId &&
        grant.scopeId === scopeId &&
        grant.productSessionId === input.productSessionId &&
        grant.teamMemberRunId === input.teamMemberRunId &&
        grant.teamRunId === input.teamRunId,
    );
    if (matches.length > 1)
      throw new Error('Runtime grant scope is ambiguous.');
    return matches[0] ? publicGrant(matches[0]) : null;
  }

  public async revoke(grantId: string): Promise<void> {
    await this.initialize();
    const revokedAt = this.now().toISOString();
    if (this.persistence) await this.persistence.revoke(grantId, revokedAt);
    this.#grants.delete(grantId);
    this.#renewable.delete(grantId);
    if ((this.#activeCalls.get(grantId) ?? 0) === 0)
      this.#activeCalls.delete(grantId);
  }

  public beginToolCall(grantId: string): RuntimeToolGrant {
    const grant = this.get(grantId);
    if (!grant || Date.parse(grant.expiresAt) <= this.now().getTime())
      throw new Error('Runtime grant not found.');
    this.#activeCalls.set(grantId, (this.#activeCalls.get(grantId) ?? 0) + 1);
    return grant;
  }

  public endToolCall(grantId: string): void {
    const count = this.#activeCalls.get(grantId) ?? 0;
    if (count <= 1) this.#activeCalls.delete(grantId);
    else this.#activeCalls.set(grantId, count - 1);
    this.pruneMemory();
  }

  public activeToolCalls(grantId: string): number {
    return this.#activeCalls.get(grantId) ?? 0;
  }

  public isToolAllowed(grantId: string, toolRef: string): boolean {
    this.requireInitialized();
    this.pruneMemory();
    const grant = this.#grants.get(grantId);
    return Boolean(
      grant &&
      Date.parse(grant.expiresAt) > this.now().getTime() &&
      grant.allowedTools.includes(toolRef),
    );
  }

  public async refreshForSession(
    productSessionId: string,
    allowedTools: readonly string[],
    ttlMs = 15 * 60 * 1000,
  ): Promise<void> {
    await this.initialize();
    this.pruneMemory();
    validateTools(allowedTools);
    const now = this.now();
    const expiresAt = new Date(
      now.getTime() + Math.max(1, ttlMs),
    ).toISOString();
    for (const [grantId, grant] of this.#grants) {
      if (grant.productSessionId !== productSessionId) continue;
      if (Date.parse(grant.expiresAt) <= now.getTime()) continue;
      if (allowedTools.some((tool) => !grant.catalogTools.includes(tool)))
        throw new Error('Runtime grant allowed tools exceed catalog.');
      const updated = updateStoredGrant(grant, {
        allowedTools: Object.freeze([...allowedTools]),
        expiresAt,
        updatedAt: now.toISOString(),
      });
      await this.persist(updated);
      this.#grants.set(grantId, updated);
    }
  }

  public async refreshForChatScope(input: {
    readonly tenantId: string;
    readonly principalType: string;
    readonly principalId: string;
    readonly workspaceId: string;
    readonly scopeId: string;
    readonly allowedTools: readonly string[];
    readonly chatContext: RuntimeToolChatContext;
  }): Promise<RuntimeToolGrant | null> {
    await this.initialize();
    this.pruneMemory();
    const matches = [
      ...this.#grants.values(),
      ...this.#renewable.values(),
    ].filter(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.principalType === input.principalType &&
        candidate.principalId === input.principalId &&
        candidate.workspaceId === input.workspaceId &&
        candidate.scopeId === input.scopeId &&
        isRenewableChatGrant(candidate),
    );
    if (matches.length > 1)
      throw new Error('Runtime Chat grant scope is ambiguous.');
    const grant = matches[0];
    if (!grant) return null;
    if (this.activeToolCalls(grant.grantId) > 0)
      throw new Error('Runtime grant refresh fence is active.');
    validateTools(input.allowedTools);
    if (input.allowedTools.some((tool) => !grant.catalogTools.includes(tool)))
      throw new Error('Runtime grant allowed tools exceed catalog.');
    validateChatContext(input.chatContext);
    const now = this.now();
    const updated = updateStoredGrant(grant, {
      allowedTools: Object.freeze([...input.allowedTools]),
      chatContext: Object.freeze({
        conversationId: input.chatContext.conversationId,
        triggerMessageId: input.chatContext.triggerMessageId,
      }),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.persist(updated);
    this.#renewable.delete(grant.grantId);
    this.#grants.set(grant.grantId, updated);
    return publicGrant(updated);
  }

  public async refreshForTeamMember(input: {
    readonly grantId?: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly allowedTools: readonly string[];
    readonly contextEpoch: string;
    readonly ttlMs?: number;
  }): Promise<RuntimeToolGrant> {
    await this.initialize();
    this.pruneMemory();
    const grant = this.findTeamMemberGrant(input);
    if (this.activeToolCalls(grant.grantId) > 0)
      throw new Error('Runtime turn refresh fence is active.');
    validateTools(input.allowedTools);
    if (input.allowedTools.some((tool) => !grant.catalogTools.includes(tool)))
      throw new Error('Runtime grant allowed tools exceed catalog.');
    const now = this.now();
    const updated = updateStoredGrant(grant, {
      allowedTools: Object.freeze([...input.allowedTools]),
      activeTurn: Object.freeze({
        taskId: input.taskId,
        runId: input.runId,
        contextEpoch: input.contextEpoch,
      }),
      expiresAt: new Date(
        now.getTime() + Math.max(1, input.ttlMs ?? 15 * 60 * 1000),
      ).toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.persist(updated);
    this.#grants.set(grant.grantId, updated);
    return publicGrant(updated);
  }

  public async closeTeamMemberTurn(input: {
    readonly grantId: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
    readonly ttlMs?: number;
  }): Promise<RuntimeToolGrant> {
    await this.initialize();
    this.pruneMemory();
    const grant = this.findTeamMemberGrant(input);
    if (this.activeToolCalls(grant.grantId) > 0)
      throw new Error('Runtime turn close fence is active.');
    const now = this.now();
    const updated = updateStoredGrant(grant, {
      allowedTools: Object.freeze([]),
      activeTurn: null,
      expiresAt: new Date(
        now.getTime() + Math.max(1, input.ttlMs ?? 15 * 60 * 1000),
      ).toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.persist(updated);
    this.#grants.set(grant.grantId, updated);
    return publicGrant(updated);
  }

  public get(grantId: string): RuntimeToolGrant | null {
    this.requireInitialized();
    this.pruneMemory();
    const grant = this.#grants.get(grantId);
    return grant ? publicGrant(grant) : null;
  }

  public getForTeamMember(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }): RuntimeToolGrant | null {
    this.requireInitialized();
    this.pruneMemory();
    const matches = [...this.#grants.values()].filter(
      (grant) =>
        grant.teamMemberRunId === input.teamMemberRunId &&
        grant.scopeId === input.scopeId,
    );
    if (matches.length > 1)
      throw new Error('Runtime grant scope is ambiguous.');
    return matches[0] ? publicGrant(matches[0]) : null;
  }

  public async revokeForTeamRun(teamRunId: string): Promise<void> {
    await this.initialize();
    const revokedAt = this.now().toISOString();
    if (this.persistence)
      await this.persistence.revokeForTeamRun(teamRunId, revokedAt);
    for (const grant of [
      ...this.#grants.values(),
      ...this.#renewable.values(),
    ]) {
      if (grant.teamRunId !== teamRunId) continue;
      this.#grants.delete(grant.grantId);
      this.#renewable.delete(grant.grantId);
      if ((this.#activeCalls.get(grant.grantId) ?? 0) === 0)
        this.#activeCalls.delete(grant.grantId);
    }
  }

  private findTeamMemberGrant(input: {
    readonly grantId?: string;
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }): StoredGrant {
    const matches = [...this.#grants.values()].filter(
      (candidate) =>
        candidate.teamMemberRunId === input.teamMemberRunId &&
        candidate.scopeId === input.scopeId,
    );
    if (matches.length === 0) throw new Error('Runtime grant scope not found.');
    if (matches.length > 1)
      throw new Error('Runtime grant scope is ambiguous.');
    const grant = input.grantId
      ? matches.find((candidate) => candidate.grantId === input.grantId)
      : matches[0];
    if (!grant || !grant.teamMemberRunId)
      throw new Error('Runtime grant not found.');
    return grant;
  }

  private pruneMemory(): void {
    if (!this.#initialized) return;
    const now = this.now().getTime();
    for (const [grantId, grant] of this.#renewable) {
      if (grant.renewableUntil && Date.parse(grant.renewableUntil) > now)
        continue;
      this.#renewable.delete(grantId);
      this.#activeCalls.delete(grantId);
    }
    for (const [grantId, grant] of this.#grants) {
      if (isRenewableChatGrant(grant)) {
        if (!grant.renewableUntil || Date.parse(grant.renewableUntil) <= now) {
          this.#grants.delete(grantId);
          this.#activeCalls.delete(grantId);
          continue;
        }
        if (Date.parse(grant.expiresAt) <= now) {
          this.#grants.delete(grantId);
          this.#renewable.set(grantId, grant);
          continue;
        }
      }
      if (Date.parse(grant.expiresAt) > now) continue;
      if ((this.#activeCalls.get(grantId) ?? 0) > 0 || grant.teamMemberRunId)
        continue;
      this.#grants.delete(grantId);
      this.#activeCalls.delete(grantId);
    }
  }

  private async persist(grant: StoredGrant): Promise<void> {
    if (this.persistence) await this.persistence.save(toPersisted(grant));
  }

  private requireInitialized(): void {
    if (!this.#initialized)
      throw new Error('Runtime grant service has not been initialized.');
  }
}

function isRenewableChatGrant(grant: RuntimeToolGrant): boolean {
  return Boolean(
    grant.chatContext &&
    grant.productSessionId === undefined &&
    grant.teamMemberRunId === undefined &&
    grant.teamRunId === undefined,
  );
}

function activeTurnFromIssue(input: {
  readonly teamMemberRunId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly contextEpoch?: string;
}): RuntimeActiveTurn | null {
  if (!input.teamMemberRunId) return null;
  if (!input.taskId || !input.runId || !input.contextEpoch)
    throw new Error('Team runtime grant requires an active turn context.');
  return Object.freeze({
    taskId: input.taskId,
    runId: input.runId,
    contextEpoch: input.contextEpoch,
  });
}

function validateTools(allowedTools: readonly string[]): void {
  if (
    new Set(allowedTools).size !== allowedTools.length ||
    allowedTools.some((tool) => !SUPPORTED_MANAGED_AGENT_TOOL_REFS.has(tool))
  )
    throw new Error('Unsupported or duplicate runtime tool ref.');
}

function validateChatContext(context: RuntimeToolChatContext): void {
  if (!context.conversationId || !context.triggerMessageId)
    throw new Error('Chat runtime grant context is incomplete.');
}

function resolveScopeId(input: {
  readonly productSessionId?: string;
  readonly scopeId?: string;
}): string {
  if (
    input.productSessionId &&
    input.scopeId &&
    input.productSessionId !== input.scopeId
  )
    throw new Error('Runtime grant scope is ambiguous.');
  const scopeId = input.productSessionId ?? input.scopeId;
  if (!scopeId) throw new Error('Runtime grant scope is unavailable.');
  return scopeId;
}

function updateStoredGrant(
  grant: StoredGrant,
  changes: Partial<
    Pick<
      StoredGrant,
      'allowedTools' | 'activeTurn' | 'chatContext' | 'expiresAt' | 'updatedAt'
    >
  >,
): StoredGrant {
  return Object.freeze({
    ...grant,
    ...changes,
    revision: grant.revision + 1,
  });
}

function publicGrant(grant: StoredGrant): RuntimeToolGrant {
  const {
    tokenHash: _tokenHash,
    renewableUntil: _renewableUntil,
    revision: _revision,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...value
  } = grant;
  return value;
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function toPersisted(grant: StoredGrant): PersistedRuntimeToolGrant {
  return Object.freeze({
    grantId: grant.grantId,
    tokenHashHex: grant.tokenHash.toString('hex'),
    tenantId: grant.tenantId,
    workspaceId: grant.workspaceId,
    principalType: grant.principalType,
    principalId: grant.principalId,
    ...(grant.productSessionId
      ? { productSessionId: grant.productSessionId }
      : {}),
    scopeId: grant.scopeId!,
    ...(grant.teamMemberRunId
      ? { teamMemberRunId: grant.teamMemberRunId }
      : {}),
    ...(grant.teamRunId ? { teamRunId: grant.teamRunId } : {}),
    allowedTools: grant.allowedTools,
    catalogTools: grant.catalogTools,
    activeTurn: grant.activeTurn,
    ...(grant.chatContext ? { chatContext: grant.chatContext } : {}),
    expiresAt: grant.expiresAt,
    ...(grant.renewableUntil ? { renewableUntil: grant.renewableUntil } : {}),
    revision: grant.revision,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  });
}

function fromPersisted(grant: PersistedRuntimeToolGrant): StoredGrant {
  return Object.freeze({
    grantId: grant.grantId,
    tenantId: grant.tenantId,
    principalType: grant.principalType,
    principalId: grant.principalId,
    workspaceId: grant.workspaceId,
    ...(grant.productSessionId
      ? { productSessionId: grant.productSessionId }
      : {}),
    scopeId: grant.scopeId,
    ...(grant.teamMemberRunId
      ? { teamMemberRunId: grant.teamMemberRunId }
      : {}),
    ...(grant.teamRunId ? { teamRunId: grant.teamRunId } : {}),
    allowedTools: Object.freeze([...grant.allowedTools]),
    catalogTools: Object.freeze([...grant.catalogTools]),
    activeTurn: grant.activeTurn,
    ...(grant.chatContext ? { chatContext: grant.chatContext } : {}),
    expiresAt: grant.expiresAt,
    ...(grant.renewableUntil ? { renewableUntil: grant.renewableUntil } : {}),
    tokenHash: Buffer.from(grant.tokenHashHex, 'hex'),
    revision: grant.revision,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  });
}
