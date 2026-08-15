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
import { materializeOpenCodeSkill } from '../filesystem/opencode-skill-materializer.js';
import { RuntimeMcpServer } from './runtime-mcp-server.js';
import type { RuntimeToolGrantService } from '../../application/extensions/runtime-tool-grant-service.js';

export class LocalRuntimeExtensionBinder implements RuntimeExtensionBinder {
  readonly #agentCwd: string;
  readonly #registryRoot: string;
  readonly #mcp: RuntimeMcpServer;

  public constructor(
    agentCwd: string,
    registryRoot: string,
    mcp: RuntimeMcpServer,
  ) {
    this.#agentCwd = resolve(agentCwd);
    this.#registryRoot = resolve(registryRoot);
    this.#mcp = mcp;
  }

  public async bind(
    input: Parameters<RuntimeExtensionBinder['bind']>[0],
  ): Promise<ExecutionExtensionBinding | undefined> {
    if (!input.skills.length && !input.toolRefs.length) return undefined;
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
    if (!input.toolRefs.length) return {};
    const grantScopeId = input.productSessionId ?? input.scopeId;
    if (!grantScopeId)
      throw new Error('Runtime extension scope is unavailable.');
    const receipt = this.#mcp.grants.issue({
      tenantId: input.tenantId,
      principalType: input.principalType,
      principalId: input.principalId,
      workspaceId: input.workspaceId,
      productSessionId: grantScopeId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.teamMemberRunId
        ? { teamMemberRunId: input.teamMemberRunId }
        : {}),
      ...(input.teamRunId ? { teamRunId: input.teamRunId } : {}),
      ...(input.contextEpoch ? { contextEpoch: input.contextEpoch } : {}),
      allowedTools: input.toolRefs,
      catalogTools: input.catalogTools ?? input.toolRefs,
    });
    let ownedReceipt = false;
    let receiptPath: string | undefined;
    try {
      const runtimeRealRoot = await realpath(runtimeRoot);
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
      const url = await this.#mcp.start();
      return {
        mcpServers: [
          {
            name: AGENT_SERVER_EXECUTION_MCP_SERVER_NAME,
            url,
            headers: { Authorization: `Bearer ${receipt.token}` },
          },
        ],
      };
    } catch (error) {
      this.#mcp.grants.revoke(receipt.receipt.grantId);
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
          // Rollback is best-effort and never masks the original failure.
        }
      }
      throw error;
    }
  }

  public refreshForSession(
    productSessionId: string,
    allowedTools: readonly string[],
    ttlMs?: number,
  ): void {
    this.#mcp.grants.refreshForSession(productSessionId, allowedTools, ttlMs);
  }

  public refreshForTeamMember(
    input: Parameters<RuntimeToolGrantService['refreshForTeamMember']>[0],
  ) {
    return this.#mcp.grants.refreshForTeamMember(input);
  }

  public getTeamMemberGrant(input: {
    readonly teamMemberRunId: string;
    readonly scopeId: string;
  }) {
    return this.#mcp.grants.getForTeamMember(input);
  }

  public revoke(grantId: string): void {
    this.#mcp.grants.revoke(grantId);
  }

  public revokeForTeamRun(teamRunId: string): void {
    this.#mcp.grants.revokeForTeamRun(teamRunId);
  }

  public activeToolCalls(grantId: string): number {
    return this.#mcp.grants.activeToolCalls(grantId);
  }
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
