import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { RuntimeExtensionBinder } from '../../application/extensions/runtime-extension-binder.js';
import {
  AGENT_SERVER_EXECUTION_MCP_SERVER_NAME,
  type ExecutionExtensionBinding,
} from '../../application/ports/execution-plane.js';
import type {
  RuntimeToolGrant,
  RuntimeToolGrantScopeQuery,
  RuntimeToolGrantService,
} from '../../application/extensions/runtime-tool-grant-service.js';
import type { Logger } from '../../shared/observability/logger.js';
import { materializeOpenCodeSkill } from '../filesystem/opencode-skill-materializer.js';
import { RuntimeMcpServer } from './runtime-mcp-server.js';

type CachedBinding = Readonly<{
  readonly grantId: string;
  readonly binding: ExecutionExtensionBinding;
}>;

const MAX_BINDINGS = 512;

export class LocalRuntimeExtensionBinder implements RuntimeExtensionBinder {
  readonly #agentCwd: string;
  readonly #registryRoot: string;
  readonly #mcp: RuntimeMcpServer;
  /** Plaintext bearer cache only. Durable authorization lives in Postgres. */
  readonly #bindings = new Map<string, CachedBinding>();
  readonly #logger: Logger | undefined;

  public constructor(
    agentCwd: string,
    registryRoot: string,
    mcp: RuntimeMcpServer,
    logger?: Logger,
  ) {
    this.#agentCwd = resolve(agentCwd);
    this.#registryRoot = resolve(registryRoot);
    this.#mcp = mcp;
    this.#logger = logger;
  }

  public async bind(
    input: Parameters<RuntimeExtensionBinder['bind']>[0],
  ): Promise<ExecutionExtensionBinding | undefined> {
    const startedAt = Date.now();
    const state = { cacheHit: false, reissued: false };
    try {
      return await this.bindInternal(input, state);
    } finally {
      this.#logger?.log('info', 'runtime.grant.bind.completed', {
        run_id: input.runId ?? null,
        team_member_run_id: input.teamMemberRunId ?? null,
        cache_hit: state.cacheHit,
        revoke_reissue: state.reissued,
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  private async bindInternal(
    input: Parameters<RuntimeExtensionBinder['bind']>[0],
    state: { cacheHit: boolean; reissued: boolean },
  ): Promise<ExecutionExtensionBinding | undefined> {
    const platformCollaboration = Boolean(input.teamMemberRunId);
    if (
      !input.skills.length &&
      !input.toolRefs.length &&
      !platformCollaboration
    )
      return undefined;

    const projectCwd = resolve(input.cellCwd ?? this.#agentCwd);
    const runtimeRoot = input.cellCwd
      ? projectCwd
      : resolve(dirname(projectCwd));
    for (const skill of input.skills)
      await materializeOpenCodeSkill({
        projectCwd,
        runtimeRoot,
        registryRoot: this.#registryRoot,
        skill,
      });

    if (!input.toolRefs.length && !platformCollaboration) return {};
    if (!input.productSessionId && !input.scopeId)
      throw new Error('Runtime extension scope is unavailable.');

    const scope = grantScope(input);
    const key = bindingKey(scope);
    const existing = await this.#mcp.grants.findForScope(scope);
    if (existing) {
      const cached = this.#bindings.get(key);
      if (cached?.grantId === existing.grantId) {
        const refreshed = await this.refreshExisting(input, existing);
        if (refreshed.grantId !== cached.grantId)
          throw new Error('Runtime grant identity changed during refresh.');
        this.touchBinding(key, cached);
        state.cacheHit = true;
        return cached.binding;
      }

      if (this.#mcp.grants.activeToolCalls(existing.grantId) > 0)
        throw new Error('Runtime grant replacement fence is active.');
      await this.#mcp.grants.revoke(existing.grantId);
      state.reissued = true;
      this.#bindings.delete(key);
      this.#logger?.log('info', 'runtime.grant.reissued_after_restart', {
        previous_grant_id_prefix: `${existing.grantId.slice(0, 8)}…`,
        scope_id: input.scopeId ?? input.productSessionId,
        scope_kind: input.chatContext
          ? 'agent_chat'
          : input.teamMemberRunId
            ? 'team_member'
            : input.productSessionId
              ? 'product_session'
              : 'task',
      });
    }

    return this.issueBinding({ input, runtimeRoot, key });
  }

  private async refreshExisting(
    input: Parameters<RuntimeExtensionBinder['bind']>[0],
    existing: RuntimeToolGrant,
  ): Promise<RuntimeToolGrant> {
    if (input.chatContext) {
      const refreshed = await this.#mcp.grants.refreshForChatScope({
        tenantId: input.tenantId,
        principalType: input.principalType,
        principalId: input.principalId,
        workspaceId: input.workspaceId,
        scopeId: input.scopeId!,
        allowedTools: input.toolRefs,
        chatContext: input.chatContext,
      });
      if (!refreshed)
        throw new Error('Runtime Chat grant disappeared during refresh.');
      return refreshed;
    }

    if (input.teamMemberRunId) {
      if (
        !input.taskId ||
        !input.runId ||
        !input.contextEpoch ||
        !input.scopeId
      )
        throw new Error(
          'Team runtime extension requires an active turn context.',
        );
      return this.#mcp.grants.refreshForTeamMember({
        grantId: existing.grantId,
        teamMemberRunId: input.teamMemberRunId,
        scopeId: input.scopeId,
        taskId: input.taskId,
        runId: input.runId,
        allowedTools: input.toolRefs,
        contextEpoch: input.contextEpoch,
      });
    }

    if (input.productSessionId) {
      await this.#mcp.grants.refreshForSession(
        input.productSessionId,
        input.toolRefs,
      );
      const refreshed = await this.#mcp.grants.findForScope(grantScope(input));
      if (!refreshed)
        throw new Error(
          'Product Session runtime grant disappeared during refresh.',
        );
      return refreshed;
    }

    if (!sameToolRefs(existing.allowedTools, input.toolRefs))
      throw new Error('Task runtime grant tool set changed unexpectedly.');
    return existing;
  }

  private async issueBinding(input: {
    readonly input: Parameters<RuntimeExtensionBinder['bind']>[0];
    readonly runtimeRoot: string;
    readonly key: string;
  }): Promise<ExecutionExtensionBinding> {
    const receipt = await this.#mcp.grants.issue({
      tenantId: input.input.tenantId,
      principalType: input.input.principalType,
      principalId: input.input.principalId,
      workspaceId: input.input.workspaceId,
      ...(input.input.productSessionId
        ? { productSessionId: input.input.productSessionId }
        : {}),
      ...(input.input.scopeId ? { scopeId: input.input.scopeId } : {}),
      ...(input.input.taskId ? { taskId: input.input.taskId } : {}),
      ...(input.input.runId ? { runId: input.input.runId } : {}),
      ...(input.input.teamMemberRunId
        ? { teamMemberRunId: input.input.teamMemberRunId }
        : {}),
      ...(input.input.teamRunId ? { teamRunId: input.input.teamRunId } : {}),
      ...(input.input.contextEpoch
        ? { contextEpoch: input.input.contextEpoch }
        : {}),
      ...(input.input.chatContext
        ? { chatContext: input.input.chatContext }
        : {}),
      allowedTools: input.input.toolRefs,
      catalogTools: input.input.catalogTools ?? input.input.toolRefs,
    });
    let ownedReceipt = false;
    let receiptPath: string | undefined;
    try {
      const runtimeRealRoot = await realpath(input.runtimeRoot);
      const receiptParent = join(runtimeRealRoot, 'skill-receipts', 'grants');
      await ensureSafeDirectoryPath(runtimeRealRoot);
      await ensureSafeParents(runtimeRealRoot, receiptParent);
      if (!/^[0-9a-f-]{36}$/.test(receipt.receipt.grantId))
        throw new Error('Invalid runtime grant identifier.');
      receiptPath = join(
        runtimeRealRoot,
        'skill-receipts',
        'grants',
        `${receipt.receipt.grantId}.json`,
      );
      const content = `${JSON.stringify(receipt.receipt)}\n`;
      try {
        await writeFile(receiptPath, content, { flag: 'wx', mode: 0o444 });
        ownedReceipt = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
        await validateGrantReceipt(receiptPath, content);
      }
      await chmod(receiptPath, 0o444);
      await validateGrantReceipt(receiptPath, content);

      const endpoint = await this.#mcp.startEndpoint();
      const digest = extensionDigest({
        endpointEpoch: endpoint.epoch,
        grantId: receipt.receipt.grantId,
        catalogTools: input.input.catalogTools ?? input.input.toolRefs,
      });
      const binding: ExecutionExtensionBinding = {
        mcpServers: [
          {
            name: AGENT_SERVER_EXECUTION_MCP_SERVER_NAME,
            url: endpoint.url,
            headers: { Authorization: `Bearer ${receipt.token}` },
          },
        ],
        endpointEpoch: endpoint.epoch,
        digest,
        grantId: receipt.receipt.grantId,
      };
      this.cacheBinding(input.key, {
        grantId: receipt.receipt.grantId,
        binding,
      });
      return binding;
    } catch (error) {
      await this.#mcp.grants
        .revoke(receipt.receipt.grantId)
        .catch(() => undefined);
      if (ownedReceipt && receiptPath) {
        try {
          const stat = await lstat(receiptPath);
          if (
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            (stat.mode & 0o777) === 0o444
          ) {
            await validateGrantReceipt(
              receiptPath,
              `${JSON.stringify(receipt.receipt)}\n`,
            );
            await rm(receiptPath, { force: false });
          }
        } catch {
          // Receipt rollback is best-effort and never masks the owning failure.
        }
      }
      throw error;
    }
  }

  public refreshForSession(
    productSessionId: string,
    allowedTools: readonly string[],
    ttlMs?: number,
  ): Promise<void> {
    return this.#mcp.grants.refreshForSession(
      productSessionId,
      allowedTools,
      ttlMs,
    );
  }

  public refreshForTeamMember(
    input: Parameters<RuntimeToolGrantService['refreshForTeamMember']>[0],
  ) {
    return this.#mcp.grants.refreshForTeamMember(input);
  }

  public closeTeamMemberTurn(
    input: Parameters<RuntimeToolGrantService['closeTeamMemberTurn']>[0],
  ) {
    return this.#mcp.grants.closeTeamMemberTurn(input);
  }

  public getTeamMemberGrant(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }) {
    return this.#mcp.grants.getForTeamMember(input);
  }

  public async revoke(grantId: string): Promise<void> {
    for (const [key, cached] of this.#bindings) {
      if (cached.grantId === grantId) this.#bindings.delete(key);
    }
    await this.#mcp.grants.revoke(grantId);
  }

  public revokeForTeamRun(teamRunId: string): Promise<void> {
    for (const [key, cached] of this.#bindings) {
      const scope = JSON.parse(key) as readonly unknown[];
      if (scope.at(-1) === teamRunId) this.#bindings.delete(key);
    }
    return this.#mcp.grants.revokeForTeamRun(teamRunId);
  }

  public activeToolCalls(grantId: string): number {
    return this.#mcp.grants.activeToolCalls(grantId);
  }

  private cacheBinding(key: string, value: CachedBinding): void {
    this.#bindings.delete(key);
    this.#bindings.set(key, value);
    while (this.#bindings.size > MAX_BINDINGS) {
      const oldest = this.#bindings.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.#bindings.delete(oldest);
    }
  }

  private touchBinding(key: string, value: CachedBinding): void {
    this.#bindings.delete(key);
    this.#bindings.set(key, value);
  }
}

function grantScope(
  input: Parameters<RuntimeExtensionBinder['bind']>[0],
): RuntimeToolGrantScopeQuery {
  return {
    tenantId: input.tenantId,
    principalType: input.principalType,
    principalId: input.principalId,
    workspaceId: input.workspaceId,
    ...(input.productSessionId
      ? { productSessionId: input.productSessionId }
      : {}),
    ...(!input.productSessionId && input.scopeId
      ? { scopeId: input.scopeId }
      : {}),
    ...(input.teamMemberRunId
      ? { teamMemberRunId: input.teamMemberRunId }
      : {}),
    ...(input.teamRunId ? { teamRunId: input.teamRunId } : {}),
  };
}

function bindingKey(scope: RuntimeToolGrantScopeQuery): string {
  return JSON.stringify([
    scope.tenantId,
    scope.workspaceId,
    scope.principalType,
    scope.principalId,
    scope.productSessionId ?? null,
    scope.scopeId ?? scope.productSessionId ?? null,
    scope.teamMemberRunId ?? null,
    scope.teamRunId ?? null,
  ]);
}

function extensionDigest(input: {
  readonly endpointEpoch: string;
  readonly grantId: string;
  readonly catalogTools: readonly string[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        endpointEpoch: input.endpointEpoch,
        grantId: input.grantId,
        catalogTools: [...input.catalogTools].sort(),
      }),
    )
    .digest('hex');
}

function sameToolRefs(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return (
    new Set(left).size === left.length && left.every((ref) => rightSet.has(ref))
  );
}

async function ensureSafeDirectoryPath(path: string): Promise<void> {
  let current: string = sep;
  for (const part of relative(sep, resolve(path)).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Unsafe runtime extension path.');
  }
}

async function ensureSafeParents(root: string, target: string): Promise<void> {
  let current = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe runtime extension parent.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      try {
        await mkdir(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
        const concurrent = await lstat(current);
        if (!concurrent.isDirectory() || concurrent.isSymbolicLink())
          throw new Error('Unsafe runtime extension parent.');
      }
      await chmod(current, 0o755);
    }
  }
}

async function validateGrantReceipt(
  path: string,
  content: string,
): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o444)
    throw new Error('Unsafe runtime grant receipt.');
  if ((await readFile(path, 'utf8')) !== content)
    throw new Error('Runtime grant receipt mismatch.');
}
