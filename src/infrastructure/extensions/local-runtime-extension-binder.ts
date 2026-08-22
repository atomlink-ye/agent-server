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
import type { RuntimeToolGrantService } from '../../application/extensions/runtime-tool-grant-service.js';
import type { Logger } from '../../shared/observability/logger.js';
import { materializeOpenCodeSkill } from '../filesystem/opencode-skill-materializer.js';
import { RuntimeMcpServer } from './runtime-mcp-server.js';

type CachedChatBinding = Readonly<{
  readonly grantId: string;
  readonly binding: ExecutionExtensionBinding;
}>;

const MAX_CHAT_BINDINGS = 256;

export class LocalRuntimeExtensionBinder implements RuntimeExtensionBinder {
  readonly #agentCwd: string;
  readonly #registryRoot: string;
  readonly #mcp: RuntimeMcpServer;
  /** Plaintext bearer cache only. Durable authorization lives in Postgres. */
  readonly #chatBindings = new Map<string, CachedChatBinding>();
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
    const platformCollaboration = Boolean(input.teamMemberRunId);
    const isChatScope = Boolean(
      input.chatContext &&
        input.scopeId &&
        !input.productSessionId &&
        !platformCollaboration,
    );
    const chatKey = isChatScope
      ? chatBindingKey({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          principalType: input.principalType,
          principalId: input.principalId,
          scopeId: input.scopeId!,
        })
      : undefined;
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

    // Skills without tools do not require MCP unless this RuntimeSession is a
    // Team participant. Collaboration MCP is platform-owned and auto-mounted.
    if (!input.toolRefs.length && !platformCollaboration) return {};

    if (!input.productSessionId && !input.scopeId)
      throw new Error('Runtime extension scope is unavailable.');

    if (chatKey && input.chatContext) {
      const refreshed = await this.#mcp.grants.refreshForChatScope({
        tenantId: input.tenantId,
        principalType: input.principalType,
        principalId: input.principalId,
        workspaceId: input.workspaceId,
        scopeId: input.scopeId!,
        allowedTools: input.toolRefs,
        chatContext: input.chatContext,
      });
      if (refreshed) {
        const cached = this.#chatBindings.get(chatKey);
        if (cached && cached.grantId === refreshed.grantId) {
          this.#logger?.log('info', 'runtime.chat_grant.refreshed', {
            grant_id_prefix: `${refreshed.grantId.slice(0, 8)}…`,
            scope_id: input.scopeId,
          });
          return cached.binding;
        }

        // The durable grant survived a process restart, but its plaintext
        // bearer intentionally did not. Revoke it and issue a fresh bearer.
        // The new grantId enters the extension digest, forcing the runtime
        // resolver to replace a provider generation that still holds the old
        // bearer while preserving the stable Agent Server RuntimeSession.
        await this.#mcp.grants.revoke(refreshed.grantId);
        this.#logger?.log('info', 'runtime.chat_grant.reissued_after_restart', {
          previous_grant_id_prefix: `${refreshed.grantId.slice(0, 8)}…`,
          scope_id: input.scopeId,
        });
      }
      this.#chatBindings.delete(chatKey);
    }

    return this.issueBinding({
      input,
      runtimeRoot,
      chatKey,
    });
  }

  private async issueBinding(input: {
    readonly input: Parameters<RuntimeExtensionBinder['bind']>[0];
    readonly runtimeRoot: string;
    readonly chatKey?: string;
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
      if (input.chatKey)
        this.cacheChatBinding(input.chatKey, {
          grantId: receipt.receipt.grantId,
          binding,
        });
      return binding;
    } catch (error) {
      await this.#mcp.grants.revoke(receipt.receipt.grantId).catch(() => undefined);
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
    for (const [key, cached] of this.#chatBindings) {
      if (cached.grantId === grantId) this.#chatBindings.delete(key);
    }
    await this.#mcp.grants.revoke(grantId);
  }

  public revokeForTeamRun(teamRunId: string): Promise<void> {
    return this.#mcp.grants.revokeForTeamRun(teamRunId);
  }

  public activeToolCalls(grantId: string): number {
    return this.#mcp.grants.activeToolCalls(grantId);
  }

  private cacheChatBinding(
    key: string,
    value: CachedChatBinding,
  ): void {
    this.#chatBindings.delete(key);
    this.#chatBindings.set(key, value);
    while (this.#chatBindings.size > MAX_CHAT_BINDINGS) {
      const oldest = this.#chatBindings.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.#chatBindings.delete(oldest);
    }
  }
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

function chatBindingKey(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalType: string;
  readonly principalId: string;
  readonly scopeId: string;
}): string {
  return JSON.stringify([
    input.tenantId,
    input.workspaceId,
    input.principalType,
    input.principalId,
    input.scopeId,
  ]);
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
