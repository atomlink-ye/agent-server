import { lstat, mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  type AgentRuntimeExecution,
  type AgentRuntimeHealth,
  type AgentRuntimePort,
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../application/ports/agent-runtime.js';
import type { Logger } from '../../shared/observability/logger.js';
import { PaseoConnectionError } from './errors.js';
import {
  selectOpenCodeModel,
  type PaseoModelDescriptor,
} from './model-selector.js';
import { PaseoSdkClient, type PaseoClientPort } from './paseo-client-port.js';
import { mapPaseoFinishStatus } from './status-mapper.js';

export interface PaseoRuntimeOptions {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly workspaceTitle: string;
  readonly requestedModel?: string;
  readonly connectTimeoutMs: number;
  readonly executionTimeoutMs: number;
}

const MEMORY_ARTIFACT_MAX_BYTES = 64 * 1024;
const MEMORY_ARTIFACT_MAX_PROPOSALS = 64;
const MEMORY_CATEGORIES = new Set([
  'terminology',
  'output_preference',
  'project_constraint',
  'confirmed_workflow_procedure',
]);
const MEMORY_CONTENT_MAX_CHARS = 4096;

export class PaseoRuntimeAdapter implements AgentRuntimePort {
  readonly #client: PaseoClientPort;
  readonly #options: PaseoRuntimeOptions;
  readonly #logger: Logger;
  #initialization: Promise<void> | null = null;
  #workspaceId: string | null = null;
  #model: PaseoModelDescriptor | null = null;
  #lastError: string | null = null;
  #generation = 0;
  #connectedGeneration: number | null = null;
  readonly #agents = new Map<string, string>();

  public constructor(
    options: PaseoRuntimeOptions,
    logger: Logger,
    client: PaseoClientPort = new PaseoSdkClient({
      url: options.wsUrl,
      connectTimeoutMs: options.connectTimeoutMs,
    }),
  ) {
    this.#options = options;
    this.#logger = logger;
    this.#client = client;
  }

  public async initialize(): Promise<void> {
    const initialized = this.#workspaceId !== null && this.#model !== null;
    if (initialized && this.#client.connectionStatus() === 'connected') {
      return;
    }
    if (this.#initialization) {
      return this.#initialization;
    }

    const generation = ++this.#generation;
    const attempt = initialized
      ? this.#reconnectOnce(generation)
      : this.#initializeOnce(generation);
    this.#initialization = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.#initialization === attempt) {
        this.#lastError = 'Runtime initialization failed.';
      }
      throw error;
    } finally {
      if (this.#initialization === attempt) {
        this.#initialization = null;
      }
    }
  }

  async #reconnectOnce(generation: number): Promise<void> {
    try {
      await this.#client.connect();
    } catch (error) {
      throw new PaseoConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (await this.#discardStaleConnection(generation)) {
      return;
    }

    this.#lastError = null;
    this.#logger.log('info', 'runtime.reconnected', {
      provider: 'opencode',
      ...(this.#model ? { model: this.#model.id } : {}),
      ...(this.#workspaceId ? { workspace_id: this.#workspaceId } : {}),
    });
  }

  async #initializeOnce(generation: number): Promise<void> {
    await mkdir(this.#options.cwd, { recursive: true });
    try {
      await this.#client.connect();
    } catch (error) {
      throw new PaseoConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (await this.#discardStaleConnection(generation)) {
      return;
    }

    const workspaceId = await this.#client.openWorkspace(this.#options.cwd);
    await this.#client.setWorkspaceTitle(
      workspaceId,
      this.#options.workspaceTitle,
    );
    const models = await this.#client.listOpenCodeModels(this.#options.cwd);
    const model = selectOpenCodeModel(models, this.#options.requestedModel);

    if (this.#generation !== generation) {
      return;
    }

    this.#workspaceId = workspaceId;
    this.#model = model;
    this.#lastError = null;
    this.#logger.log('info', 'runtime.initialized', {
      provider: 'opencode',
      model: model.id,
      workspace_id: workspaceId,
    });
  }

  async #discardStaleConnection(generation: number): Promise<boolean> {
    if (this.#generation === generation) {
      this.#connectedGeneration = generation;
      return false;
    }
    if (this.#initialization === null && this.#connectedGeneration === null) {
      await this.#client.close();
    }
    return true;
  }

  public async execute(input: {
    readonly runId: string;
    readonly prompt: string;
  }): Promise<AgentRuntimeExecution> {
    await this.initialize();
    if (!this.#workspaceId || !this.#model) {
      throw new RuntimeExecutionError('Paseo runtime is not initialized.');
    }

    const artifactRelativePath = join(
      'scratchpad',
      'runs',
      input.runId,
      'memory-proposals.json',
    );
    const artifact = await this.#prepareArtifactPath(artifactRelativePath);
    await this.#clearArtifact(artifact);
    const agent = await this.#client.createOpenCodeAgent({
      cwd: this.#options.cwd,
      workspaceId: this.#workspaceId,
      model: this.#model.id,
      prompt: `${input.prompt}\n\n${memoryArtifactInstruction(artifactRelativePath)}`,
      runId: input.runId,
    });
    this.#agents.set(input.runId, agent.id);
    const finished = await this.#client.waitForFinish(
      agent.id,
      this.#options.executionTimeoutMs,
    );
    const status = mapPaseoFinishStatus(finished.status);

    if (status === 'timed_out') {
      throw new RuntimeTimedOutError();
    }
    if (status === 'failed') {
      throw new RuntimeExecutionError(
        finished.error ?? `Paseo finished with status ${finished.status}`,
      );
    }
    if (finished.lastMessage === null) {
      throw new RuntimeExecutionError(
        'Paseo completed without a final assistant message.',
      );
    }

    const memory = await this.#readMemoryCandidates(artifact);
    return {
      provider: agent.provider || 'opencode',
      model: agent.model ?? this.#model.id,
      text: finished.lastMessage,
      ...(finished.usage ? { usage: finished.usage } : {}),
      ...(memory.memoryCandidates
        ? { memoryCandidates: memory.memoryCandidates }
        : {}),
    };
  }

  async #clearArtifact(path: string): Promise<void> {
    await this.#assertSafePath(path);
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async #readMemoryCandidates(path: string): Promise<{
    readonly memoryCandidates?: AgentRuntimeExecution['memoryCandidates'];
  }> {
    await this.#assertSafePath(path);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new RuntimeExecutionError(
        'Unable to inspect memory proposal artifact.',
      );
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > MEMORY_ARTIFACT_MAX_BYTES
    )
      throw new RuntimeExecutionError('Invalid memory proposal artifact.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new RuntimeExecutionError('Invalid memory proposal artifact.');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('proposals' in parsed) ||
      !Array.isArray(parsed.proposals) ||
      parsed.proposals.length > MEMORY_ARTIFACT_MAX_PROPOSALS
    )
      throw new RuntimeExecutionError('Invalid memory proposal artifact.');
    const proposals = parsed.proposals.map((proposal) => {
      if (
        !proposal ||
        typeof proposal !== 'object' ||
        Object.keys(proposal).some(
          (key) => key !== 'category' && key !== 'content',
        )
      )
        throw new RuntimeExecutionError('Invalid memory proposal artifact.');
      const candidate = proposal as { category?: unknown; content?: unknown };
      if (
        typeof candidate.category !== 'string' ||
        !MEMORY_CATEGORIES.has(candidate.category) ||
        typeof candidate.content !== 'string' ||
        candidate.content.trim() === '' ||
        candidate.content.length > MEMORY_CONTENT_MAX_CHARS
      )
        throw new RuntimeExecutionError('Invalid memory proposal artifact.');
      return { category: candidate.category, content: candidate.content };
    });
    return proposals.length ? { memoryCandidates: proposals } : {};
  }

  async #prepareArtifactPath(relativePath: string): Promise<string> {
    const scratchRoot = resolve(this.#options.cwd, 'scratchpad');
    await mkdir(scratchRoot, { recursive: true });
    const runDirectory = dirname(resolve(this.#options.cwd, relativePath));
    await mkdir(runDirectory, { recursive: true });
    const absolute = resolve(this.#options.cwd, relativePath);
    await this.#assertSafePath(absolute, scratchRoot);
    return absolute;
  }

  async #assertSafePath(
    path: string,
    configuredRoot = resolve(this.#options.cwd, 'scratchpad'),
  ): Promise<void> {
    const root = resolve(configuredRoot);
    const rootReal = await realpath(root);
    const candidate = resolve(path);
    const lexicalRelative = relative(root, candidate);
    if (
      lexicalRelative.startsWith('..') ||
      lexicalRelative.split('/').includes('..')
    ) {
      throw new RuntimeExecutionError(
        'Memory proposal artifact path is outside the runtime scratch root.',
      );
    }
    let lexical = root;
    for (const part of lexicalRelative.split('/').slice(0, -1)) {
      lexical = join(lexical, part);
      const stat = await lstat(lexical);
      if (stat.isSymbolicLink())
        throw new RuntimeExecutionError(
          'Memory proposal artifact path contains a symbolic-link ancestor.',
        );
    }
    const candidateParent = await realpath(dirname(candidate));
    const underRoot = relative(rootReal, candidateParent);
    if (underRoot.startsWith('..') || underRoot.split('/').includes('..')) {
      throw new RuntimeExecutionError(
        'Memory proposal artifact path is outside the runtime scratch root.',
      );
    }
    let current = candidateParent;
    while (current !== rootReal && current.startsWith(`${rootReal}/`)) {
      const stat = await lstat(current);
      if (stat.isSymbolicLink())
        throw new RuntimeExecutionError(
          'Memory proposal artifact path contains a symbolic-link ancestor.',
        );
      current = dirname(current);
    }
    const stat = await lstat(candidate).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (stat?.isSymbolicLink())
      throw new RuntimeExecutionError('Invalid memory proposal artifact.');
  }

  public async cancel(input: {
    readonly runId: string;
    readonly providerAgentId?: string;
  }): Promise<void> {
    const agentId = input.providerAgentId ?? this.#agents.get(input.runId);
    if (!agentId) return;
    try {
      await this.#client.cancelAgent?.(agentId);
    } catch (error) {
      // Cancellation is deliberately idempotent: a terminal/missing provider agent is done.
      this.#logger.log('warn', 'runtime.cancel.ignored', {
        run_id: input.runId,
        error_name: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.#agents.delete(input.runId);
    }
  }

  public async health(): Promise<AgentRuntimeHealth> {
    const connected = this.#client.connectionStatus() === 'connected';
    const workspaceReady = this.#workspaceId !== null;
    const modelReady = this.#model !== null;
    const errorDetail = this.#lastError ?? undefined;

    return {
      ready: connected && workspaceReady && modelReady,
      provider: 'opencode',
      ...(this.#model ? { model: this.#model.id } : {}),
      checks: [
        {
          name: 'paseo_websocket',
          ready: connected,
          ...(!connected && errorDetail ? { detail: errorDetail } : {}),
        },
        {
          name: 'paseo_workspace',
          ready: workspaceReady,
          ...(!workspaceReady && errorDetail ? { detail: errorDetail } : {}),
        },
        {
          name: 'opencode_model',
          ready: modelReady,
          ...(!modelReady && errorDetail ? { detail: errorDetail } : {}),
        },
      ],
    };
  }

  public async close(): Promise<void> {
    this.#generation += 1;
    this.#connectedGeneration = null;
    this.#workspaceId = null;
    this.#model = null;
    this.#agents.clear();
    this.#initialization = null;
    await this.#client.close();
  }
}

function memoryArtifactInstruction(relativePath: string): string {
  return [
    'Internal runtime artifact contract (server-controlled; do not mention host paths):',
    `Write proposals only to the exact relative path ${JSON.stringify(relativePath)}.`,
    'The complete JSON value must match exactly {"proposals":[{"category":string,"content":string}]} with no additional properties.',
    'Allowed category values: terminology, output_preference, project_constraint, confirmed_workflow_procedure.',
    `Maximum proposals: ${MEMORY_ARTIFACT_MAX_PROPOSALS}; maximum content length: ${MEMORY_CONTENT_MAX_CHARS} characters.`,
  ].join('\n');
}
