import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  type AgentRuntimeExecution,
  type AgentRuntimeExecuteInput,
  type AgentRuntimeHealth,
  type AgentRuntimePort,
  type RuntimeEventSink,
  type RuntimeEvent,
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../application/ports/agent-runtime.js';
import type { Logger } from '../../shared/observability/logger.js';
import { PaseoConnectionError } from './errors.js';
import {
  selectOpenCodeModel,
  type PaseoModelDescriptor,
} from './model-selector.js';
import {
  PaseoSdkClient,
  type PaseoAgentStreamEvent,
  type PaseoClientPort,
  type PaseoProviderSubagentDescriptor,
  type PaseoProviderSubagentTimeline,
  type PaseoProviderSubagentUpdate,
  type PaseoToolCall,
  type PaseoTimelinePage,
} from './paseo-client-port.js';
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
  readonly #sessionWorkspaces = new Map<string, string>();

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
    const initialized = this.#model !== null;
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

    const models = await this.#client.listOpenCodeModels(this.#options.cwd);
    const model = selectOpenCodeModel(models, this.#options.requestedModel);
    const workspaceId = await this.#client.openWorkspace(this.#options.cwd);
    await this.#client.setWorkspaceTitle(
      workspaceId,
      this.#options.workspaceTitle,
    );

    if (this.#generation !== generation) {
      return;
    }

    this.#model = model;
    this.#workspaceId = workspaceId;
    this.#lastError = null;
    this.#logger.log('info', 'runtime.initialized', {
      provider: 'opencode',
      model: model.id,
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

  public async execute(
    input: AgentRuntimeExecuteInput,
    sink?: RuntimeEventSink,
  ): Promise<AgentRuntimeExecution> {
    await this.initialize();
    if (!this.#model) {
      throw new RuntimeExecutionError('Paseo runtime is not initialized.');
    }

    const artifactRelativePath = join(
      'scratchpad',
      'runs',
      input.runId,
      'memory-proposals.json',
    );
    const memoryEnabled =
      (input.memoryCandidates?.maxCandidates ?? 0) > 0 ||
      (input.memoryCandidates?.proposalLimit ?? 0) > 0;
    const executionCwd = input.cellCwd ?? this.#options.cwd;
    const sanitizeText = (
      value: string,
      max = 8000,
      flush = true,
    ): string | null =>
      sanitizeStreamingText(
        value,
        max,
        [executionCwd, this.#options.cwd],
        flush,
      );
    const artifact = memoryEnabled
      ? await this.#prepareArtifactPath(artifactRelativePath, executionCwd)
      : null;
    if (artifact) await this.#clearArtifact(artifact, executionCwd);
    const prompt = artifact
      ? `${input.prompt}\n\n${memoryArtifactInstruction(artifactRelativePath)}`
      : input.prompt;
    const runtimeSessionId = input.runtimeSessionId;
    const managedCellExecution =
      Boolean(runtimeSessionId) ||
      Boolean(input.cellCwd) ||
      (input.operation === 'continue' && Boolean(input.paseoWorkspaceId));
    let workspaceId =
      input.paseoWorkspaceId ??
      (runtimeSessionId
        ? this.#sessionWorkspaces.get(runtimeSessionId)
        : undefined);
    if (input.operation === 'create' && managedCellExecution)
      await mkdir(input.cellCwd ?? this.#options.cwd, { recursive: true });
    if (input.operation === 'create' && managedCellExecution && !workspaceId) {
      const cwd = input.cellCwd ?? this.#options.cwd;
      if (!this.#client.createIndependentWorkspace)
        throw new RuntimeExecutionError(
          'Paseo independent workspace creation is unavailable.',
        );
      const workspaceStartedAt = Date.now();
      this.#logger.log('info', 'runtime.workspace.create.started', {
        run_id: input.runId,
        managed_cell: managedCellExecution,
        has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
        model_id: this.#model.id,
      });
      workspaceId = await this.#client.createIndependentWorkspace(cwd);
      this.#logger.log('info', 'runtime.workspace.create.completed', {
        run_id: input.runId,
        managed_cell: managedCellExecution,
        has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
        model_id: this.#model.id,
        elapsed_ms: Date.now() - workspaceStartedAt,
      });
      await this.#client.setWorkspaceTitle(
        workspaceId,
        input.workspaceTitle ?? this.#options.workspaceTitle,
      );
    }
    if (runtimeSessionId && workspaceId)
      this.#sessionWorkspaces.set(runtimeSessionId, workspaceId);
    if (!workspaceId && !managedCellExecution)
      workspaceId = this.#workspaceId ?? undefined;
    if (!workspaceId)
      throw new RuntimeExecutionError('Paseo workspace is not bound.');
    let activeAgentId: string | null = null;
    let baseline: PaseoTimelinePage | null = null;
    let streamReady = false;
    const seenLiveSequences = new Set<string>();
    const emittedSnapshots = new Map<string, string>();
    let assistantQuarantined = false;
    const parentCallActivities = new Map<string, string>();
    const publishedParentActivities = new Set<string>();
    const childSessionToParentActivity = new Map<string, string>();
    const conflictedChildSessionIds = new Set<string>();
    const childCallActivities = new Map<string, string>();
    const childTimelineActivities = new Map<
      string,
      {
        readonly activityId: string;
        readonly parentActivityId: string;
        readonly itemKind: 'assistant' | 'reasoning';
        sourceText: string;
        text: string;
        quarantined: boolean;
        emitted: boolean;
        status: 'running' | 'completed' | 'failed' | 'cancelled';
      }
    >();
    const currentChildTextSegments = new Map<
      string,
      {
        readonly itemKind: 'assistant' | 'reasoning';
        readonly timelineKey?: string;
        readonly key: string;
      }
    >();
    const childTextSegmentCounters = new Map<string, number>();
    const toolSourceDetails = new Map<string, string>();
    const quarantinedToolDetails = new Set<string>();
    const pendingSubagents = new Map<string, PaseoProviderSubagentDescriptor>();
    const childParents = new Map<string, string>();
    const childDescriptors = new Map<string, PaseoProviderSubagentDescriptor>();
    const conflictedDescriptorIds = new Set<string>();
    const parentActivityToDescriptor = new Map<string, string>();
    const parentActivityToChildSession = new Map<string, string>();
    const descriptorChildSessions = new Map<string, string>();
    const childSequenceKeys = new Set<string>();
    const activityStates = new Map<
      string,
      {
        readonly category: RuntimeToolCategory;
        status: string;
        label: string;
        summary: string;
        readonly toolName?: string | undefined;
        readonly detailKind?:
          'shell' | 'read' | 'write' | 'edit' | 'search' | 'fetch';
        readonly detailText?: string;
        readonly exitCode?: number;
        readonly quality: number;
        readonly parentActivityId?: string;
      }
    >();
    const deferredParentTerminals = new Map<
      string,
      {
        readonly category: RuntimeToolCategory;
        readonly status: 'completed' | 'failed' | 'cancelled';
        readonly label: string;
        readonly summary: string;
        readonly toolName: string;
        readonly quality: number;
      }
    >();
    const baselineSubagents = new Map<
      string,
      PaseoProviderSubagentDescriptor
    >();
    const permissionActivities = new Map<
      string,
      {
        readonly activityId: string;
        readonly status: string;
        readonly decision?: string;
      }
    >();
    let nextToolActivity = 1;
    let nextPermissionActivity = 1;
    let reasoningActive = false;
    let reasoningSourceText = '';
    let reasoningText = '';
    let reasoningQuarantined = false;
    let nestedActivityReady = false;
    let acceptingTurnActivity = true;
    let nestedPolling = true;
    let deferParentTerminals = true;
    let sinkQueue = Promise.resolve();
    let liveAssistant: {
      readonly epoch: string;
      readonly seq: number;
      readonly text: string;
    } | null = null;
    const emitSnapshot = (
      epoch: string,
      seq: number,
      text: string,
      flush = false,
    ): void => {
      if (!sink || !text) return;
      if (assistantQuarantined) return;
      const sanitized = sanitizeText(text, 8000, flush);
      if (sanitized === null) {
        assistantQuarantined = true;
        return;
      }
      if (!sanitized) return;
      if (
        baseline?.epoch === epoch &&
        baseline.endCursor &&
        seq <= baseline.endCursor.seq
      )
        return;
      const key = `${epoch}:${seq}`;
      if (emittedSnapshots.get(key) === sanitized) return;
      emittedSnapshots.set(key, sanitized);
      sinkQueue = sinkQueue.then(() =>
        sink.emit({ kind: 'assistant_text', text: sanitized }),
      );
    };
    const emit = (event: RuntimeEvent): void => {
      if (!sink) return;
      sinkQueue = sinkQueue.then(() => sink.emit(event));
    };
    const emitReasoningStarted = (): void => {
      if (reasoningActive) return;
      reasoningActive = true;
      emit({
        kind: 'reasoning_progress',
        status: 'started',
        ...(reasoningText ? { text: reasoningText } : {}),
      });
    };
    const completeReasoning = (): void => {
      if (!reasoningActive) return;
      reasoningActive = false;
      const finalText = reasoningQuarantined
        ? null
        : sanitizeText(reasoningSourceText, 8000, true);
      emit({
        kind: 'reasoning_progress',
        status: 'completed',
        ...(finalText ? { text: finalText } : {}),
      });
      reasoningText = '';
      reasoningSourceText = '';
      reasoningQuarantined = false;
    };
    const allocateActivityId = (): string => `activity-${nextToolActivity++}`;
    const publishToolState = (
      activityId: string,
      category: RuntimeToolCategory,
      status: 'running' | 'completed' | 'failed' | 'cancelled',
      label: string,
      summary: string,
      toolName?: string,
      parentActivityId?: string,
      quality = 0,
      detailText?: string,
      exitCode?: number,
    ): void => {
      const previous = activityStates.get(activityId);
      const nextDetailText = detailText ? capDetail(detailText) : undefined;
      const detailImproved =
        nextDetailText !== undefined &&
        nextDetailText.length > (previous?.detailText?.length ?? 0) &&
        nextDetailText !== previous?.detailText;
      const exitCodeImproved =
        exitCode !== undefined && previous?.exitCode === undefined;
      const bestDetailText =
        nextDetailText !== undefined &&
        (previous?.detailText === undefined || detailImproved)
          ? nextDetailText
          : previous?.detailText;
      if (
        deferParentTerminals &&
        !parentActivityId &&
        category === 'subagent' &&
        status !== 'running'
      ) {
        const deferred = deferredParentTerminals.get(activityId);
        if (deferred && deferred.status !== status) return;
        if (
          deferred?.category === category &&
          deferred?.label === label &&
          deferred?.summary === summary &&
          deferred?.toolName === (toolName ?? previous?.toolName ?? label)
        )
          return;
        if (deferred && quality <= deferred.quality) return;
        deferredParentTerminals.set(activityId, {
          category,
          status,
          label,
          summary,
          toolName: toolName ?? previous?.toolName ?? label,
          quality,
        });
        return;
      }
      if (previous && isTerminalToolStatus(previous.status)) {
        if (
          previous.status !== status ||
          (quality <= previous.quality && !detailImproved && !exitCodeImproved)
        )
          return;
      }
      if (
        previous?.status === status &&
        quality <= previous.quality &&
        !detailImproved &&
        !exitCodeImproved
      )
        return;
      const bestLabel =
        previous && previous.quality >= quality ? previous.label : label;
      const bestSummary =
        previous && previous.quality >= quality ? previous.summary : summary;
      const bestQuality = Math.max(previous?.quality ?? 0, quality);
      if (
        previous?.status === status &&
        previous.category === category &&
        previous.label === bestLabel &&
        previous.summary === bestSummary &&
        previous.parentActivityId === parentActivityId &&
        !detailImproved &&
        !exitCodeImproved
      )
        return;
      activityStates.set(activityId, {
        category,
        status,
        label: bestLabel,
        summary: bestSummary,
        ...((toolName ?? previous?.toolName)
          ? { toolName: toolName ?? previous?.toolName }
          : {}),
        ...runtimeToolDetail(category, detailText, exitCode),
        ...(bestDetailText !== undefined ? { detailText: bestDetailText } : {}),
        ...(exitCode !== undefined
          ? { exitCode }
          : previous?.exitCode !== undefined
            ? { exitCode: previous.exitCode }
            : {}),
        quality: bestQuality,
        ...(parentActivityId ? { parentActivityId } : {}),
      });
      emit({
        kind: 'tool_status',
        activityId,
        category,
        status,
        label: bestLabel,
        summary: bestSummary,
        ...((toolName ?? previous?.toolName)
          ? { toolName: toolName ?? previous?.toolName }
          : {}),
        ...(bestDetailText !== undefined ? { detailText: bestDetailText } : {}),
        ...(exitCode !== undefined
          ? { exitCode }
          : previous?.exitCode !== undefined
            ? { exitCode: previous.exitCode }
            : {}),
        ...(parentActivityId ? { parentActivityId } : {}),
      });
    };
    const flushDeferredParentTerminals = (): void => {
      deferParentTerminals = false;
      for (const [activityId, state] of deferredParentTerminals) {
        const current = activityStates.get(activityId);
        const quality = Math.max(current?.quality ?? 0, state.quality);
        publishToolState(
          activityId,
          state.category,
          state.status,
          current && current.quality >= state.quality
            ? current.label
            : state.label,
          current && current.quality >= state.quality
            ? current.summary
            : state.summary,
          current?.toolName ?? state.toolName,
          undefined,
          quality,
        );
      }
      deferredParentTerminals.clear();
    };
    const publishToolCall = (
      call: PaseoToolCall,
      key: string,
      parentActivityId?: string,
    ): string | null => {
      const status = normalizeToolStatus(call.status);
      if (!status) return null;
      const activityId =
        (parentActivityId
          ? childCallActivities.get(key)
          : parentCallActivities.get(call.callId)) ?? allocateActivityId();
      if (parentActivityId) childCallActivities.set(key, activityId);
      else parentCallActivities.set(call.callId, activityId);
      let projectedCall = call;
      if (call.detailText && !quarantinedToolDetails.has(activityId)) {
        const sourceDetail = mergeProjectedText(
          toolSourceDetails.get(activityId) ?? '',
          call.detailText,
        );
        toolSourceDetails.set(activityId, sourceDetail);
        const sanitizedDetail = sanitizeText(
          sourceDetail,
          8000,
          isTerminalToolStatus(status),
        );
        if (sanitizedDetail === null) {
          quarantinedToolDetails.add(activityId);
          const { detailText: _detailText, ...withoutDetail } = call;
          projectedCall = withoutDetail;
        } else {
          projectedCall = { ...call, detailText: sanitizedDetail };
        }
      }
      if (quarantinedToolDetails.has(activityId)) {
        const { detailText: _detailText, ...withoutDetail } = call;
        projectedCall = withoutDetail;
      } else if (isTerminalToolStatus(status)) {
        const sourceDetail = toolSourceDetails.get(activityId);
        if (sourceDetail) {
          const finalDetail = sanitizeText(sourceDetail, 8000, true);
          if (finalDetail === null) {
            quarantinedToolDetails.add(activityId);
            const { detailText: _detailText, ...withoutDetail } = call;
            projectedCall = withoutDetail;
          } else {
            projectedCall = { ...call, detailText: finalDetail };
          }
        }
      }
      const category = toolCategory(call.name, call.detailType);
      const presentation = toolPresentation(
        projectedCall,
        category,
        executionCwd,
        sanitizeText,
      );
      if (
        !parentActivityId &&
        deferParentTerminals &&
        category === 'subagent' &&
        isTerminalToolStatus(status) &&
        !activityStates.has(activityId)
      )
        publishToolState(
          activityId,
          category,
          'running',
          presentation.label,
          presentation.summary,
          call.name,
          undefined,
          presentation.quality,
          presentation.detailText,
          presentation.exitCode,
        );
      publishToolState(
        activityId,
        category,
        status,
        presentation.label,
        presentation.summary,
        call.name,
        parentActivityId,
        presentation.quality,
        presentation.detailText,
        presentation.exitCode,
      );
      if (!parentActivityId && activityStates.has(activityId))
        publishedParentActivities.add(activityId);
      if (!parentActivityId && activityStates.has(activityId))
        recordChildSessionCorrelation(call.input?.childSessionId, activityId);
      return activityId;
    };
    const removeDescriptorBinding = (descriptorId: string): void => {
      const parentActivityId = childParents.get(descriptorId);
      if (
        parentActivityId &&
        parentActivityToDescriptor.get(parentActivityId) === descriptorId
      )
        parentActivityToDescriptor.delete(parentActivityId);
      const childSessionId = descriptorChildSessions.get(descriptorId);
      if (
        childSessionId &&
        childSessionToParentActivity.get(childSessionId) === parentActivityId
      )
        childSessionToParentActivity.delete(childSessionId);
      if (
        childSessionId &&
        parentActivityId &&
        parentActivityToChildSession.get(parentActivityId) === childSessionId
      )
        parentActivityToChildSession.delete(parentActivityId);
      descriptorChildSessions.delete(descriptorId);
      childParents.delete(descriptorId);
      childDescriptors.delete(descriptorId);
      pendingSubagents.delete(descriptorId);
    };
    const markDescriptorConflicted = (descriptorId: string): void => {
      conflictedDescriptorIds.add(descriptorId);
      removeDescriptorBinding(descriptorId);
    };
    const quarantineParentCompetition = (
      parentActivityId: string,
      descriptorId: string,
    ): void => {
      const existing = parentActivityToDescriptor.get(parentActivityId);
      if (existing && existing !== descriptorId)
        markDescriptorConflicted(existing);
      markDescriptorConflicted(descriptorId);
      parentActivityToDescriptor.delete(parentActivityId);
    };
    const quarantineChildCompetition = (
      parentActivityId: string,
      incomingChildSessionId: string,
      competingParentActivityId?: string,
    ): void => {
      const childIds = new Set<string>([incomingChildSessionId]);
      const competingParents = new Set<string>([parentActivityId]);
      if (competingParentActivityId)
        competingParents.add(competingParentActivityId);
      const existingChildSessionId =
        parentActivityToChildSession.get(parentActivityId);
      if (existingChildSessionId) childIds.add(existingChildSessionId);
      for (const [parent, childSessionId] of parentActivityToChildSession) {
        if (competingParents.has(parent) || childIds.has(childSessionId)) {
          childIds.add(childSessionId);
          parentActivityToChildSession.delete(parent);
        }
      }
      for (const [childSessionId, parent] of childSessionToParentActivity) {
        if (competingParents.has(parent)) childIds.add(childSessionId);
      }
      for (const childSessionId of childIds) {
        conflictedChildSessionIds.add(childSessionId);
        if (childSessionToParentActivity.get(childSessionId) !== undefined)
          childSessionToParentActivity.delete(childSessionId);
        markDescriptorConflicted(childSessionId);
      }
    };
    const recordChildSessionCorrelation = (
      childSessionId: string | undefined,
      parentActivityId: string,
    ): void => {
      if (!childSessionId || conflictedChildSessionIds.has(childSessionId))
        return;
      const previous = childSessionToParentActivity.get(childSessionId);
      const previousChild = parentActivityToChildSession.get(parentActivityId);
      if (
        (previous && previous !== parentActivityId) ||
        (previousChild && previousChild !== childSessionId)
      ) {
        quarantineChildCompetition(
          parentActivityId,
          childSessionId,
          previous && previous !== parentActivityId ? previous : undefined,
        );
        return;
      }
      const currentDescriptor =
        parentActivityToDescriptor.get(parentActivityId);
      if (currentDescriptor && currentDescriptor !== childSessionId) {
        conflictedChildSessionIds.add(childSessionId);
        markDescriptorConflicted(currentDescriptor);
        markDescriptorConflicted(childSessionId);
        parentActivityToDescriptor.delete(parentActivityId);
        return;
      }
      childSessionToParentActivity.set(childSessionId, parentActivityId);
      parentActivityToChildSession.set(parentActivityId, childSessionId);
      const pending = pendingSubagents.get(childSessionId);
      if (pending) bindProviderSubagent(pending);
    };
    const bindProviderSubagent = (
      descriptor: PaseoProviderSubagentDescriptor,
    ): string | null => {
      if (descriptor.parentAgentId !== activeAgentId) return null;
      if (conflictedDescriptorIds.has(descriptor.id)) return null;
      if (conflictedChildSessionIds.has(descriptor.id)) return null;
      // COMPAT(opencode-subagent-child-session-correlation): Paseo v0.1.110 omits descriptor.toolCallId for OpenCode. Remove when minimum Paseo supplies it. Target: 2027-02-01.
      const parentActivityId = descriptor.toolCallId
        ? parentCallActivities.get(descriptor.toolCallId)
        : childSessionToParentActivity.get(descriptor.id);
      if (
        !parentActivityId ||
        !publishedParentActivities.has(parentActivityId)
      ) {
        pendingSubagents.set(descriptor.id, descriptor);
        return null;
      }
      const existingParent = childParents.get(descriptor.id);
      if (existingParent && existingParent !== parentActivityId) {
        const competingDescriptor =
          parentActivityToDescriptor.get(parentActivityId);
        markDescriptorConflicted(descriptor.id);
        if (competingDescriptor) markDescriptorConflicted(competingDescriptor);
        return null;
      }
      const childSessionParent = childSessionToParentActivity.get(
        descriptor.id,
      );
      if (childSessionParent && childSessionParent !== parentActivityId) {
        quarantineChildCompetition(
          parentActivityId,
          descriptor.id,
          childSessionParent,
        );
        return null;
      }
      const parentChildSession =
        parentActivityToChildSession.get(parentActivityId);
      if (parentChildSession && parentChildSession !== descriptor.id) {
        quarantineChildCompetition(parentActivityId, descriptor.id);
        return null;
      }
      const competingDescriptor =
        parentActivityToDescriptor.get(parentActivityId);
      if (competingDescriptor && competingDescriptor !== descriptor.id) {
        quarantineParentCompetition(parentActivityId, descriptor.id);
        return null;
      }
      childDescriptors.set(descriptor.id, descriptor);
      childParents.set(descriptor.id, parentActivityId);
      descriptorChildSessions.set(descriptor.id, descriptor.id);
      parentActivityToDescriptor.set(parentActivityId, descriptor.id);
      childSessionToParentActivity.set(descriptor.id, parentActivityId);
      parentActivityToChildSession.set(parentActivityId, descriptor.id);
      pendingSubagents.delete(descriptor.id);
      const parentState = activityStates.get(parentActivityId);
      const descriptorText = descriptor.title ?? descriptor.description ?? '';
      const descriptorLabel = safeSingleLine(
        sanitizeText(descriptorText, 8000) ?? '',
        80,
        true,
      );
      if (parentState && descriptorLabel) {
        publishToolState(
          parentActivityId,
          parentState.category,
          normalizeToolStatus(parentState.status) ?? 'running',
          safeSingleLine(`Sub-agent task: ${descriptorLabel}`, 80, false) ??
            parentState.label,
          parentState.summary,
          parentState.toolName,
          undefined,
          2,
        );
      }
      return parentActivityId;
    };
    const consumeParentToolCall = (call: PaseoToolCall): void => {
      const activityId = publishToolCall(call, `parent:${call.callId}`);
      if (!activityId) return;
      if (publishedParentActivities.has(activityId)) {
        for (const pending of pendingSubagents.values()) {
          if (pending.toolCallId === call.callId) bindProviderSubagent(pending);
        }
      }
    };
    const consumeChildTimeline = (
      descriptor: PaseoProviderSubagentDescriptor,
      timeline: PaseoProviderSubagentTimeline,
    ): void => {
      if (
        descriptor.parentAgentId !== activeAgentId ||
        timeline.parentAgentId !== activeAgentId ||
        timeline.subagentId !== descriptor.id
      )
        return;
      const parentActivityId = childParents.get(descriptor.id);
      if (!parentActivityId || timeline.epoch === undefined) return;
      for (const row of [...timeline.rows].sort((a, b) => a.seq - b.seq)) {
        const rowKey = `${descriptor.id}:${timeline.epoch}:${row.seq}`;
        if (childSequenceKeys.has(rowKey)) continue;
        childSequenceKeys.add(rowKey);
        if (row.item.toolCall) {
          currentChildTextSegments.delete(descriptor.id);
          publishToolCall(
            row.item.toolCall,
            `${descriptor.id}:${timeline.epoch}:${row.item.toolCall.callId}`,
            parentActivityId,
          );
        } else if (row.item.assistantText || row.item.reasoningText) {
          const itemKind = row.item.assistantText ? 'assistant' : 'reasoning';
          const text = row.item.assistantText ?? row.item.reasoningText ?? '';
          const current = currentChildTextSegments.get(descriptor.id);
          const sameSegment =
            current?.itemKind === itemKind &&
            (!row.item.timelineKey ||
              !current.timelineKey ||
              current.timelineKey === row.item.timelineKey);
          let segment = sameSegment ? current : undefined;
          if (!segment) {
            const nextCounter =
              (childTextSegmentCounters.get(descriptor.id) ?? 0) + 1;
            childTextSegmentCounters.set(descriptor.id, nextCounter);
            segment = {
              itemKind,
              key: `${descriptor.id}:${itemKind}:${nextCounter}`,
              ...(row.item.timelineKey
                ? { timelineKey: row.item.timelineKey }
                : {}),
            };
            currentChildTextSegments.set(descriptor.id, segment);
          }
          emitChildTimeline(parentActivityId, segment.key, itemKind, text);
        }
      }
    };
    const emitChildTimeline = (
      parentActivityId: string,
      key: string,
      itemKind: 'assistant' | 'reasoning',
      text: string,
    ): void => {
      const previous = childTimelineActivities.get(key);
      if (previous && (previous.status !== 'running' || previous.quarantined))
        return;
      const activityId = previous?.activityId ?? allocateActivityId();
      const sourceText = mergeProjectedText(previous?.sourceText ?? '', text);
      const sanitized = sanitizeText(sourceText, 8000, false);
      if (sanitized === null) {
        childTimelineActivities.set(key, {
          activityId,
          parentActivityId,
          itemKind,
          sourceText,
          text: previous?.text ?? '',
          quarantined: true,
          emitted: previous?.emitted ?? false,
          status: 'running',
        });
        return;
      }
      if (!sanitized) {
        childTimelineActivities.set(key, {
          activityId,
          parentActivityId,
          itemKind,
          sourceText,
          text: previous?.text ?? '',
          quarantined: false,
          emitted: previous?.emitted ?? false,
          status: 'running',
        });
        return;
      }
      const nextText = sanitized;
      const summary =
        safeSingleLine(nextText, 160, false) ??
        (itemKind === 'assistant' ? 'Assistant' : 'Thinking');
      childTimelineActivities.set(key, {
        activityId,
        parentActivityId,
        itemKind,
        sourceText,
        text: nextText,
        quarantined: false,
        emitted: true,
        status: 'running',
      });
      emit({
        kind: 'child_timeline_item',
        activityId,
        parentActivityId,
        itemKind,
        status: 'running',
        label: itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
        summary,
        detailText: nextText,
      });
    };
    const finalizeProviderSubagent = (
      descriptor: PaseoProviderSubagentDescriptor,
    ): void => {
      const parentActivityId = childParents.get(descriptor.id);
      if (!parentActivityId) return;
      if (descriptor.status === 'running') return;
      const terminalStatus =
        descriptor.status === 'completed'
          ? 'completed'
          : descriptor.status === 'failed'
            ? 'failed'
            : 'cancelled';
      for (const item of childTimelineActivities.values()) {
        if (item.parentActivityId !== parentActivityId) continue;
        if (item.quarantined) {
          if (!item.emitted) continue;
          // Previously visible row must terminalize with last safe public text.
          const summary =
            safeSingleLine(item.text, 160, false) ??
            (item.itemKind === 'assistant' ? 'Assistant' : 'Thinking');
          emit({
            kind: 'child_timeline_item',
            activityId: item.activityId,
            parentActivityId,
            itemKind: item.itemKind,
            status: terminalStatus,
            label: item.itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
            summary,
            ...(item.text ? { detailText: item.text } : {}),
          });
          item.status = terminalStatus;
          continue;
        }
        const finalText = sanitizeText(item.sourceText, 8000, true);
        if (finalText === null || !finalText) {
          item.quarantined = true;
          if (!item.emitted) continue;
          // Previously visible row must terminalize with last safe public text.
          const fallbackSummary =
            safeSingleLine(item.text, 160, false) ??
            (item.itemKind === 'assistant' ? 'Assistant' : 'Thinking');
          emit({
            kind: 'child_timeline_item',
            activityId: item.activityId,
            parentActivityId,
            itemKind: item.itemKind,
            status: terminalStatus,
            label: item.itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
            summary: fallbackSummary,
            ...(item.text ? { detailText: item.text } : {}),
          });
          item.status = terminalStatus;
          continue;
        }
        item.text = finalText;
        emit({
          kind: 'child_timeline_item',
          activityId: item.activityId,
          parentActivityId,
          itemKind: item.itemKind,
          status: terminalStatus,
          label: item.itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
          summary:
            safeSingleLine(finalText, 160, false) ??
            (item.itemKind === 'assistant' ? 'Assistant' : 'Thinking'),
          detailText: finalText,
        });
        item.status = terminalStatus;
      }
      const parentState = activityStates.get(parentActivityId);
      if (!parentState) return;
      const status =
        descriptor.status === 'completed'
          ? 'completed'
          : descriptor.status === 'failed'
            ? 'failed'
            : 'cancelled';
      publishToolState(
        parentActivityId,
        parentState.category,
        status,
        parentState.label,
        parentState.summary,
        parentState.toolName,
        undefined,
        parentState.quality,
      );
    };
    const consumeProviderSubagentUpdate = (
      update: PaseoProviderSubagentUpdate,
    ): void => {
      const updateParentAgentId =
        update.kind === 'upsert'
          ? update.subagent.parentAgentId
          : update.parentAgentId;
      if (updateParentAgentId !== activeAgentId) return;
      if (update.kind === 'upsert') {
        bindProviderSubagent(update.subagent);
        if (update.subagent.status !== 'running')
          finalizeProviderSubagent(update.subagent);
        return;
      }
      if (update.kind === 'remove') return;
      const descriptor = childDescriptors.get(update.subagentId);
      const parentActivityId = childParents.get(update.subagentId);
      if (!descriptor || !parentActivityId) return;
      consumeChildTimeline(descriptor, {
        parentAgentId: update.parentAgentId,
        subagentId: update.subagentId,
        epoch: update.epoch,
        direction: 'tail',
        rows: [
          { item: update.item, timestamp: update.timestamp, seq: update.seq },
        ],
        hasOlder: false,
      });
    };
    const reconcileNestedActivity = async (final: boolean): Promise<void> => {
      if (this.#client.fetchAgentTimeline && activeAgentId) {
        try {
          const page = await this.#client.fetchAgentTimeline(activeAgentId, {
            direction: 'tail',
            limit: 100,
            projection: 'projected',
          });
          for (const entry of page.entries) {
            if (isAfterBaseline(page.epoch, entry.seqEnd) && entry.toolCall)
              consumeParentToolCall(entry.toolCall);
          }
        } catch {
          // Nested activity is best-effort telemetry and never fails the Run.
        }
      }
      if (!this.#client.listProviderSubagents || !activeAgentId) return;
      let descriptors: readonly PaseoProviderSubagentDescriptor[];
      try {
        descriptors = await this.#client.listProviderSubagents(activeAgentId);
      } catch {
        return;
      }
      for (const descriptor of descriptors) {
        const baselineDescriptor = baselineSubagents.get(descriptor.id);
        if (
          baselineDescriptor &&
          baselineDescriptor.status === descriptor.status &&
          !childDescriptors.has(descriptor.id)
        )
          continue;
        const parentActivityId = bindProviderSubagent(descriptor);
        if (!parentActivityId || !this.#client.fetchProviderSubagentTimeline)
          continue;
        try {
          const timeline = await this.#client.fetchProviderSubagentTimeline(
            activeAgentId,
            descriptor.id,
            { direction: 'tail', limit: 100 },
          );
          consumeChildTimeline(descriptor, timeline);
          if (final) finalizeProviderSubagent(descriptor);
        } catch {
          // A missing child timeline is not a Product Run failure.
        }
      }
    };
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeFallback: (() => void) | undefined;
    const waitForFallback = async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = undefined;
          }
          if (wakeFallback === finish) wakeFallback = undefined;
          resolve();
        };
        wakeFallback = finish;
        fallbackTimer = setTimeout(finish, 5_000);
        fallbackTimer.unref?.();
      });
    };
    const pollNestedActivity = async (): Promise<void> => {
      // Push subscriptions are the primary telemetry path. The slow fallback
      // starts with a full interval so a normal turn does not issue an eager RPC.
      while (nestedPolling && acceptingTurnActivity) {
        await waitForFallback();
        if (!nestedPolling || !acceptingTurnActivity) break;
        await reconcileNestedActivity(false);
      }
    };
    const isAfterBaseline = (
      epoch: string | null,
      seq: number | null,
    ): boolean => {
      if (epoch === null || seq === null) return false;
      return (
        !baseline ||
        baseline.epoch !== epoch ||
        !baseline.endCursor ||
        seq > baseline.endCursor.seq
      );
    };
    const consumeProjectedActivity = (event: PaseoAgentStreamEvent): void => {
      if (
        !acceptingTurnActivity ||
        event.agentId !== activeAgentId ||
        !isAfterBaseline(event.epoch, event.seq)
      )
        return;
      if (
        reasoningActive &&
        [
          'lifecycle',
          'agent_status',
          'finished',
          'completed',
          'failed',
          'cancelled',
        ].includes(event.eventType)
      )
        completeReasoning();
      if (event.reasoning) emitReasoningStarted();
      if (event.assistantText !== undefined) completeReasoning();
      if (event.toolCall) {
        completeReasoning();
        liveAssistant = null;
        assistantQuarantined = false;
        consumeParentToolCall(event.toolCall);
      }
      if (event.permission) {
        const previous = permissionActivities.get(event.permission.requestId);
        const activityId =
          previous?.activityId ?? `permission-${nextPermissionActivity++}`;
        if (previous?.status === 'resolved') return;
        if (
          previous?.status === event.permission.status &&
          previous.decision === event.permission.decision
        )
          return;
        permissionActivities.set(event.permission.requestId, {
          activityId,
          status: event.permission.status,
          ...(event.permission.decision
            ? { decision: event.permission.decision }
            : {}),
        });
        emit({
          kind: 'permission',
          activityId,
          category: permissionCategory(event.permission.kind),
          status: event.permission.status,
          ...(event.permission.decision
            ? { decision: event.permission.decision }
            : {}),
          summary: 'Permission activity is read-only.',
        });
      }
    };
    const consumeStreamEvent = (event: PaseoAgentStreamEvent): void => {
      if (event.reasoningText) {
        if (reasoningQuarantined) return;
        reasoningSourceText = mergeProjectedText(
          reasoningSourceText,
          event.reasoningText,
        );
        const sanitized = sanitizeText(reasoningSourceText, 8000, false);
        if (sanitized === null) {
          reasoningQuarantined = true;
          reasoningText = '';
          return;
        }
        const changed = reasoningText !== sanitized;
        reasoningText = sanitized;
        reasoningActive = true;
        if (changed)
          emit({
            kind: 'reasoning_progress',
            status: 'started',
            text: reasoningText,
          });
      }
      consumeProjectedActivity(event);
      if (
        event.agentId !== activeAgentId ||
        event.timelineItemType !== 'assistant_message' ||
        event.assistantText === undefined ||
        event.seq === null ||
        event.epoch === null
      )
        return;
      if (
        baseline?.epoch === event.epoch &&
        baseline.endCursor &&
        event.seq <= baseline.endCursor.seq
      )
        return;
      if (seenLiveSequences.has(`${event.epoch}:${event.seq}`)) return;
      if (liveAssistant === null || liveAssistant.epoch !== event.epoch) {
        assistantQuarantined = false;
        liveAssistant = {
          epoch: event.epoch,
          seq: event.seq,
          text: event.assistantText,
        };
        seenLiveSequences.add(`${event.epoch}:${event.seq}`);
      } else if (event.seq > liveAssistant.seq) {
        seenLiveSequences.add(`${event.epoch}:${event.seq}`);
        liveAssistant = {
          ...liveAssistant,
          seq: event.seq,
          text: liveAssistant.text + event.assistantText,
        };
      } else {
        return;
      }
      emitSnapshot(liveAssistant.epoch, liveAssistant.seq, liveAssistant.text);
    };
    let unsubscribe = this.#client.subscribeAgentStream?.((event) => {
      if (streamReady) consumeStreamEvent(event);
    });
    let unsubscribeProviderSubagents =
      this.#client.subscribeProviderSubagentUpdates?.((update) => {
        const updateParentAgentId =
          update.kind === 'upsert'
            ? update.subagent.parentAgentId
            : update.parentAgentId;
        if (
          !nestedActivityReady ||
          !acceptingTurnActivity ||
          updateParentAgentId !== activeAgentId
        )
          return;
        consumeProviderSubagentUpdate(update);
      });
    let nestedPollPromise: Promise<void> | null = null;

    try {
      const modelId = this.#model.id;
      const agent =
        input.operation === 'continue'
          ? {
              id: input.providerAgentId,
              provider: 'opencode',
              model: this.#model.id,
            }
          : await (async () => {
              const agentStartedAt = Date.now();
              this.#logger.log('info', 'runtime.agent.create.started', {
                run_id: input.runId,
                managed_cell: managedCellExecution,
                has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
                model_id: modelId,
              });
              const created = await this.#client.createOpenCodeAgent({
                cwd: input.cellCwd ?? this.#options.cwd,
                workspaceId,
                model: modelId,
                systemPrompt: input.systemPrompt,
                initialPrompt: prompt,
                runId: input.runId,
                ...(input.agentTitle ? { title: input.agentTitle } : {}),
                ...(input.agentLabels ? { labels: input.agentLabels } : {}),
                ...(input.extensions?.mcpServers
                  ? { mcpServers: input.extensions.mcpServers }
                  : {}),
              });
              this.#logger.log('info', 'runtime.agent.create.completed', {
                run_id: input.runId,
                managed_cell: managedCellExecution,
                has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
                model_id: modelId,
                elapsed_ms: Date.now() - agentStartedAt,
              });
              return created;
            })();
      activeAgentId = agent.id;
      this.#agents.set(input.runId, agent.id);

      if (this.#client.fetchAgentTimeline) {
        baseline = await this.#client.fetchAgentTimeline(agent.id, {
          direction: 'tail',
          limit: 100,
          projection: 'projected',
        });
      }
      if (this.#client.listProviderSubagents) {
        try {
          const descriptors = await this.#client.listProviderSubagents(
            agent.id,
          );
          for (const descriptor of descriptors) {
            if (descriptor.parentAgentId === agent.id)
              baselineSubagents.set(descriptor.id, descriptor);
          }
        } catch {
          // Baseline discovery is best-effort telemetry.
        }
      }
      nestedActivityReady = true;
      streamReady = true;

      const sendStartedAt = Date.now();
      this.#logger.log('info', 'runtime.message.send.started', {
        run_id: input.runId,
        elapsed_ms: 0,
        status: 'started',
      });
      await this.#client.sendAgentMessage(agent.id, prompt);
      this.#logger.log('info', 'runtime.message.send.completed', {
        run_id: input.runId,
        elapsed_ms: Date.now() - sendStartedAt,
        status: 'completed',
      });
      nestedPollPromise = pollNestedActivity();
      let finished;
      const waitStartedAt = Date.now();
      this.#logger.log('info', 'runtime.wait.started', {
        run_id: input.runId,
        elapsed_ms: 0,
        status: 'started',
      });
      try {
        finished = await this.#client.waitForFinish(
          agent.id,
          this.#options.executionTimeoutMs,
        );
        this.#logger.log('info', 'runtime.wait.completed', {
          run_id: input.runId,
          elapsed_ms: Date.now() - waitStartedAt,
          status: finished.status,
        });
      } catch (error) {
        void error;
        this.#logger.log('info', 'runtime.wait.completed', {
          run_id: input.runId,
          elapsed_ms: Date.now() - waitStartedAt,
          status: 'error',
        });
        acceptingTurnActivity = false;
        nestedActivityReady = false;
        nestedPolling = false;
        streamReady = false;
        deferParentTerminals = true;
        wakeFallback?.();
        await nestedPollPromise;
        await reconcileNestedActivity(true);
        flushDeferredParentTerminals();
        unsubscribe?.();
        unsubscribe = undefined;
        unsubscribeProviderSubagents?.();
        unsubscribeProviderSubagents = undefined;
        throw error;
      }
      acceptingTurnActivity = false;
      nestedActivityReady = false;
      nestedPolling = false;
      streamReady = false;
      deferParentTerminals = true;
      wakeFallback?.();
      await nestedPollPromise;
      await reconcileNestedActivity(true);
      if (this.#client.fetchAgentTimeline) {
        const page = await this.#client.fetchAgentTimeline(agent.id, {
          direction: 'tail',
          limit: 100,
          projection: 'projected',
        });
        for (const entry of page.entries) {
          if (!isAfterBaseline(page.epoch, entry.seqEnd)) continue;
          if (entry.reasoningText) {
            if (!reasoningQuarantined) {
              reasoningSourceText = mergeProjectedText(
                reasoningSourceText,
                entry.reasoningText,
              );
              const sanitized = sanitizeText(reasoningSourceText);
              if (sanitized === null) {
                reasoningQuarantined = true;
                reasoningText = '';
              } else {
                const changed = reasoningText !== sanitized;
                reasoningText = sanitized;
                if (changed) {
                  emit({
                    kind: 'reasoning_progress',
                    status: 'started',
                    text: reasoningText,
                  });
                }
              }
            }
            if (!reasoningQuarantined) {
              reasoningActive = true;
            }
          }
          if (entry.toolCall) {
            completeReasoning();
            consumeParentToolCall(entry.toolCall);
          }
          if (
            entry.timelineItemType !== 'assistant_message' ||
            entry.assistantText === undefined ||
            (baseline?.epoch === page.epoch &&
              baseline.endCursor &&
              entry.seqEnd <= baseline.endCursor.seq)
          )
            continue;
          emitSnapshot(page.epoch, entry.seqEnd, entry.assistantText, true);
        }
      }
      flushDeferredParentTerminals();
      completeReasoning();
      if (finished.usage) {
        const usage = normalizeUsage(finished.usage);
        if (usage) emit({ kind: 'usage', ...usage });
      }
      await sinkQueue;
      unsubscribe?.();
      unsubscribe = undefined;
      unsubscribeProviderSubagents?.();
      unsubscribeProviderSubagents = undefined;

      const status = mapPaseoFinishStatus(finished.status);
      if (status === 'timed_out') throw new RuntimeTimedOutError();
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

      const memory = artifact
        ? await this.#readMemoryCandidates(artifact, executionCwd)
        : {};
      return {
        provider: agent.provider || 'opencode',
        model: agent.model ?? this.#model.id,
        text: finished.lastMessage,
        providerAgentId: agent.id,
        paseoWorkspaceId: workspaceId,
        ...(finished.usage ? { usage: finished.usage } : {}),
        ...(memory.memoryCandidates
          ? { memoryCandidates: memory.memoryCandidates }
          : {}),
      };
    } finally {
      await sinkQueue.catch(() => undefined);
      unsubscribe?.();
      unsubscribe = undefined;
      unsubscribeProviderSubagents?.();
      unsubscribeProviderSubagents = undefined;
    }
  }

  async #clearArtifact(path: string, cwd: string): Promise<void> {
    await this.#assertSafePath(path, resolve(cwd, 'scratchpad'));
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async #readMemoryCandidates(
    path: string,
    cwd: string,
  ): Promise<{
    readonly memoryCandidates?: AgentRuntimeExecution['memoryCandidates'];
  }> {
    await this.#assertSafePath(path, resolve(cwd, 'scratchpad'));
    let handle;
    try {
      handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new RuntimeExecutionError(
        'Unable to inspect memory proposal artifact.',
      );
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new RuntimeExecutionError('Invalid memory proposal artifact.');
      const buffer = Buffer.alloc(MEMORY_ARTIFACT_MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(
          buffer,
          offset,
          buffer.length - offset,
          null,
        );
        offset += read.bytesRead;
        if (read.bytesRead === 0) break;
      }
      if (offset > MEMORY_ARTIFACT_MAX_BYTES)
        throw new RuntimeExecutionError('Invalid memory proposal artifact.');
      const parsed: unknown = JSON.parse(
        buffer.subarray(0, offset).toString('utf8'),
      );
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Object.keys(parsed).length !== 1 ||
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
    } catch {
      throw new RuntimeExecutionError('Invalid memory proposal artifact.');
    } finally {
      await handle.close();
    }
  }

  async #prepareArtifactPath(
    relativePath: string,
    cwd: string,
  ): Promise<string> {
    const scratchRoot = resolve(cwd, 'scratchpad');
    await this.#assertSafePath(scratchRoot, scratchRoot);
    await mkdir(scratchRoot, { recursive: true });
    const runDirectory = dirname(resolve(cwd, relativePath));
    await this.#assertSafePath(runDirectory, scratchRoot);
    await mkdir(runDirectory, { recursive: true });
    const absolute = resolve(cwd, relativePath);
    await this.#assertSafePath(absolute, scratchRoot);
    return absolute;
  }

  async #assertSafePath(
    path: string,
    configuredRoot = resolve(this.#options.cwd, 'scratchpad'),
  ): Promise<void> {
    const root = resolve(configuredRoot);
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
    await rejectSymlinkIfPresent(root, true);
    let current = root;
    for (const part of lexicalRelative.split('/').filter(Boolean)) {
      current = join(current, part);
      await rejectSymlinkIfPresent(current, current === candidate);
    }
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
    this.#sessionWorkspaces.clear();
    this.#initialization = null;
    await this.#client.close();
  }
}

async function rejectSymlinkIfPresent(
  path: string,
  existingRequired: boolean,
): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new RuntimeExecutionError(
        existingRequired
          ? 'Invalid memory proposal artifact path: the runtime scratch root or its ancestor is a symbolic link (symbolic-link ancestor).'
          : 'Memory proposal artifact path contains a symbolic-link ancestor (symbolic link).',
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
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

type RuntimeToolCategory =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'fetch'
  | 'subagent'
  | 'other';

function toolPresentation(
  call: PaseoToolCall,
  category: RuntimeToolCategory,
  executionCwd: string,
  sanitizeText: (value: string, max?: number) => string | null,
): {
  readonly label: string;
  readonly summary: string;
  readonly quality: number;
  readonly detailText?: string;
  readonly exitCode?: number;
} {
  const fallback = categoryLabel(category);
  const input = call.input;
  const preview = call.detailText
    ? sanitizeText(call.detailText, 8000)
    : undefined;
  let detail: string | null = null;
  let quality = 0;
  if (category === 'shell' && input?.command) {
    const command = sanitizeText(input.command, 8000);
    if (command && isSafeShell(command)) detail = command;
  } else if (['read', 'edit', 'write'].includes(category) && input?.filePath)
    detail = workspaceRelativePath(executionCwd, input.filePath);
  else if (category === 'search' && input?.query) {
    const query = sanitizeText(input.query, 8000);
    detail = query ? safeSingleLine(query, 80, true) : null;
  } else if (category === 'fetch' && input?.url)
    detail = safeHttpUrl(input.url);
  else if (category === 'subagent') {
    const description = input?.description
      ? (() => {
          const sanitized = sanitizeText(input.description, 8000);
          return sanitized ? safeSingleLine(sanitized, 80, true) : null;
        })()
      : null;
    const subtype = input?.subAgentType
      ? (() => {
          const sanitized = sanitizeText(input.subAgentType, 8000);
          return sanitized ? safeSingleLine(sanitized, 40, true) : null;
        })()
      : null;
    detail = description ?? subtype;
  }
  if (detail) quality = category === 'subagent' ? 1 : 1;
  return {
    label: detail
      ? (safeSingleLine(`${fallback}: ${detail}`, 80, false) ?? fallback)
      : fallback,
    summary: toolSummary(category),
    quality,
    ...(preview ? { detailText: preview } : {}),
    ...(call.exitCode !== undefined ? { exitCode: call.exitCode } : {}),
  };
}

function categoryLabel(category: RuntimeToolCategory): string {
  if (category === 'subagent') return 'Sub-agent task';
  return `${category.charAt(0).toUpperCase()}${category.slice(1)} activity`;
}

function safeSingleLine(
  value: string,
  maxCodePoints: number,
  screenCredentials: boolean,
): string | null {
  if (/\r|\n|[\u0000-\u001f\u007f]/u.test(value)) return null;
  if (screenCredentials && containsCredentialMarker(value)) return null;
  const normalized = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, maxCodePoints).join('');
}

function capDetail(value: string): string {
  return Array.from(
    value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ''),
  )
    .slice(0, 8000)
    .join('');
}

function sanitizeRuntimeText(
  value: string,
  max: number,
  roots: readonly string[],
): string | null {
  if (containsCredentialMarker(value)) return null;
  let sanitized = capDetail(value);
  sanitized = sanitized.replace(
    /\/workspace\/\.local\/runtime-cells\/[A-Za-z0-9_-]+\/?/gu,
    './',
  );
  const normalizedRoots = roots
    .map((root) => resolve(root).replaceAll('\\', '/').replace(/\/$/u, ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const root of normalizedRoots) {
    sanitized = sanitized.split(root).join('./');
  }
  sanitized = sanitized
    .replace(/(?<![\w:./])\/(?!\/)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(
      /(?<![A-Za-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?![A-Za-z0-9])/giu,
      '<id>',
    );
  const bounded = Array.from(sanitized).slice(0, max).join('');
  return bounded || null;
}

function sanitizeStreamingText(
  value: string,
  max: number,
  roots: readonly string[],
  flush: boolean,
): string | null {
  const sanitized = sanitizeRuntimeText(value, max, roots);
  if (sanitized === null || flush) return sanitized;
  const tailSize = 512;
  let committedEnd = Math.max(0, sanitized.length - tailSize);
  const suspiciousStart = Math.max(
    value.lastIndexOf('/'),
    value.lastIndexOf('\\'),
    value.toLowerCase().lastIndexOf('authorization'),
    value.toLowerCase().lastIndexOf('password'),
    value.toLowerCase().lastIndexOf('secret'),
    value.toLowerCase().lastIndexOf('token'),
  );
  if (suspiciousStart >= 0 && value.length - suspiciousStart <= 4096) {
    committedEnd = Math.min(
      committedEnd,
      Math.max(0, sanitized.length - (value.length - suspiciousStart)),
    );
  }
  return sanitized.slice(0, committedEnd);
}

function mergeProjectedText(existing: string, incoming: string): string {
  const next = capDetail(incoming);
  if (!existing) return next;
  if (next.startsWith(existing)) return next;
  if (existing.endsWith(next)) return existing;
  return capDetail(existing + next);
}

function runtimeToolDetail(
  category: RuntimeToolCategory,
  detailText?: string,
  exitCode?: number,
): Record<string, string | number> {
  const detailKind = [
    'shell',
    'read',
    'write',
    'edit',
    'search',
    'fetch',
  ].includes(category)
    ? category
    : undefined;
  return {
    ...(detailKind ? { detailKind } : {}),
    ...(detailText ? { detailText: capDetail(detailText) } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function containsCredentialMarker(value: string): boolean {
  return (
    /authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key/i.test(
      value,
    ) ||
    /(?:^|\s)(?:-u|--user|-H|--header|--auth|--authentication)(?:=|\s)/i.test(
      value,
    ) ||
    /\b(?:bearer|basic)\s+[A-Za-z0-9+/._~=-]+/i.test(value) ||
    /(?:^|\s)[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD)\s*=/i.test(value) ||
    /(?:^|\s)--?(?:password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key)(?:=|\s)/i.test(
      value,
    ) ||
    /(?:password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key)\s*[:=]/i.test(
      value,
    ) ||
    /:\/\/[^/?#:@]+:[^@]+@/i.test(value) ||
    /\b[A-Za-z0-9_-]{32,}\b/.test(value)
  );
}

function isSafeShell(value: string): boolean {
  return safeSingleLine(value, 80, true) !== null;
}

function workspaceRelativePath(cwd: string, value: string): string | null {
  if (!value || value.length > 4096) return null;
  const absolute = resolve(cwd, value);
  const relativePath = relative(resolve(cwd), absolute).replaceAll('\\', '/');
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.split('/').includes('..')
  )
    return null;
  const projectedPath = relativePath
    .split('/')
    .map((part) => redactPathIdentifier(part))
    .join('/');
  return safeSingleLine(projectedPath, 120, false);
}

function redactPathIdentifier(value: string): string {
  const uuid =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu;
  const withUuidRedacted = value.replace(uuid, '<id>');
  if (/^[0-9a-f]{32,}(\.[A-Za-z0-9._-]+)?$/iu.test(withUuidRedacted))
    return withUuidRedacted.replace(/^[0-9a-f]{32,}/iu, '<id>');
  return withUuidRedacted;
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return safeSingleLine(`${parsed.origin}${parsed.pathname}`, 80, true);
  } catch {
    return null;
  }
}

function normalizeToolStatus(
  value: string,
): 'running' | 'completed' | 'failed' | 'cancelled' | null {
  const status = value.toLowerCase();
  if (['running', 'started', 'pending', 'in_progress'].includes(status))
    return 'running';
  if (
    ['completed', 'complete', 'success', 'succeeded', 'done'].includes(status)
  )
    return 'completed';
  if (['failed', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled', 'cancel'].includes(status)) return 'cancelled';
  return null;
}

function toolCategory(name: string, detailType?: string): RuntimeToolCategory {
  const value = `${name} ${detailType ?? ''}`.toLowerCase();
  if (/(shell|command|terminal|exec)/.test(value)) return 'shell';
  if (/(read|cat|list|glob|file)/.test(value)) return 'read';
  if (/(edit|patch|replace)/.test(value)) return 'edit';
  if (/(write|create|save)/.test(value)) return 'write';
  if (/(search|grep|find)/.test(value)) return 'search';
  if (/(fetch|http|url|web)/.test(value)) return 'fetch';
  if (/(agent|delegate|task)/.test(value)) return 'subagent';
  return 'other';
}

function toolSummary(category: RuntimeToolCategory): string {
  return `${category.charAt(0).toUpperCase()}${category.slice(1)} activity.`;
}

function permissionCategory(
  kind?: string,
): 'tool' | 'plan' | 'question' | 'mode' | 'other' {
  const value = (kind ?? '').toLowerCase();
  if (value.includes('tool')) return 'tool';
  if (value.includes('plan')) return 'plan';
  if (value.includes('question')) return 'question';
  if (value.includes('mode')) return 'mode';
  return 'other';
}

function normalizeUsage(
  usage: NonNullable<AgentRuntimeExecution['usage']>,
): Record<string, number> | null {
  const output: Record<string, number> = {};
  for (const key of [
    'inputTokens',
    'cachedInputTokens',
    'outputTokens',
    'contextWindowMaxTokens',
    'contextWindowUsedTokens',
  ] as const) {
    const value = usage[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0)
      output[key] = value;
  }
  if (
    usage.totalCostUsd !== undefined &&
    Number.isFinite(usage.totalCostUsd) &&
    usage.totalCostUsd >= 0
  )
    output.totalCostUsd = usage.totalCostUsd;
  return Object.keys(output).length ? output : null;
}

function isTerminalToolStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
