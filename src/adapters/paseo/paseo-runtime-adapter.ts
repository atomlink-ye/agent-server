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
  type RuntimeToolDetail,
  RuntimeExecutionError,
  RuntimeTimedOutError,
} from '../../application/ports/agent-runtime.js';
import type { Logger } from '../../shared/observability/logger.js';
import type { ManagedEnvironmentProvider } from '../../domain/environments/managed-environment-package.js';
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
import {
  hasPositiveModelUsage,
  mapPaseoFinishStatus,
} from './status-mapper.js';

export interface PaseoRuntimeOptions {
  readonly wsUrl: string;
  readonly cwd: string;
  readonly provider: ManagedEnvironmentProvider;
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
  readonly #agentBindings = new Map<
    string,
    { readonly provider: string; readonly model: string }
  >();
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
      provider: this.#options.provider,
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

    const models = await this.#client.listModels(
      this.#options.provider,
      this.#options.cwd,
    );
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
      provider: this.#options.provider,
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

    const continuationBinding =
      input.operation === 'continue'
        ? this.#agentBindings.get(input.providerAgentId)
        : undefined;
    if (input.operation === 'continue' && !continuationBinding)
      throw new RuntimeExecutionError(
        'Paseo continuation provenance is unavailable.',
      );
    const createProvider: ManagedEnvironmentProvider =
      input.operation === 'create' && input.provider !== undefined
        ? input.provider
        : this.#options.provider;
    const effectiveProvider =
      input.operation === 'continue'
        ? continuationBinding!.provider
        : createProvider;
    const effectiveModel =
      input.operation === 'create' && input.model !== undefined
        ? input.model
        : input.operation === 'continue'
          ? continuationBinding!.model
          : this.#model.id;
    let activeProvider = effectiveProvider;

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
        model_id: effectiveModel,
      });
      workspaceId = await this.#client.createIndependentWorkspace(cwd);
      this.#logger.log('info', 'runtime.workspace.create.completed', {
        run_id: input.runId,
        managed_cell: managedCellExecution,
        has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
        model_id: effectiveModel,
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
        readonly detail?: RuntimeToolDetail;
        readonly provider: string;
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
    let assistantBlockObserved = false;
    let assistantBlockBlocked = false;
    let assistantBlockLastPublicText = '';
    const observedAssistantTexts = new Set<string>();
    const emitSnapshot = (
      epoch: string,
      seq: number,
      text: string,
      flush = false,
    ): void => {
      if (!sink || !text) return;
      const projection = projectText(
        text,
        8000,
        [executionCwd, this.#options.cwd],
        flush,
      );
      if (projection.kind === 'blocked') {
        if (assistantBlockBlocked) return;
        assistantBlockBlocked = true;
        const redactedText = assistantBlockLastPublicText
          ? `${assistantBlockLastPublicText}\n\n[Content redacted by credential screening]`
          : '[Content redacted by credential screening]';
        const key = `${epoch}:${seq}`;
        if (emittedSnapshots.get(key) === redactedText) return;
        emittedSnapshots.set(key, redactedText);
        assistantBlockLastPublicText = redactedText;
        sinkQueue = sinkQueue.then(() =>
          sink.emit({
            kind: 'assistant_text',
            text: redactedText,
          }),
        );
        return;
      }
      if (projection.kind !== 'visible' || !projection.text) return;
      const sanitized = projection.text;
      if (
        baseline?.epoch === epoch &&
        baseline.endCursor &&
        seq <= baseline.endCursor.seq
      )
        return;
      const key = `${epoch}:${seq}`;
      if (emittedSnapshots.get(key) === sanitized) return;
      emittedSnapshots.set(key, sanitized);
      assistantBlockLastPublicText = sanitized;
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
      detail?: RuntimeToolDetail,
    ): void => {
      const previous = activityStates.get(activityId);
      const detailImproved =
        detail !== undefined &&
        JSON.stringify(detail).length >
          JSON.stringify(previous?.detail ?? {}).length &&
        JSON.stringify(detail) !== JSON.stringify(previous?.detail);
      const bestDetail = detailImproved ? detail : previous?.detail;
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
          (quality <= previous.quality && !detailImproved)
        )
          return;
      }
      if (
        previous?.status === status &&
        quality <= previous.quality &&
        !detailImproved
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
        !detailImproved
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
        ...(bestDetail ? { detail: bestDetail } : {}),
        provider: activeProvider,
        quality: bestQuality,
        ...(parentActivityId ? { parentActivityId } : {}),
      });
      if (parentActivityId) {
        emit({
          kind: 'child_timeline_item',
          activityId,
          parentActivityId,
          itemKind: 'tool',
          status,
          label: bestLabel,
          summary: bestSummary,
          ...(bestDetail ? { detail: bestDetail } : {}),
          provider: activeProvider,
        });
      } else {
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
          ...(bestDetail ? { detail: bestDetail } : {}),
          provider: activeProvider,
        });
      }
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
      const category = toolCategory(call.name, call.detail?.type);
      const presentation = toolPresentation(
        call,
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
          presentation.detail,
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
        presentation.detail,
      );
      if (!parentActivityId && activityStates.has(activityId))
        publishedParentActivities.add(activityId);
      if (!parentActivityId && activityStates.has(activityId))
        recordChildSessionCorrelation(
          call.childSessionId ??
            (call.detail?.type === 'sub_agent'
              ? call.detail.childSessionId
              : undefined),
          activityId,
        );
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
        text: nextText,
        provider: activeProvider,
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
            ...(item.text ? { text: item.text } : {}),
            provider: activeProvider,
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
            ...(item.text ? { text: item.text } : {}),
            provider: activeProvider,
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
          text: finalText,
          provider: activeProvider,
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
    const flushAssistantBlock = (): void => {
      if (!liveAssistant) return;
      emitSnapshot(
        liveAssistant.epoch,
        liveAssistant.seq,
        liveAssistant.text,
        true,
      );
      liveAssistant = null;
    };
    const resetAssistantBlock = (): void => {
      flushAssistantBlock();
      assistantBlockObserved = false;
      assistantBlockBlocked = false;
      assistantBlockLastPublicText = '';
    };
    const consumeAssistantSnapshot = (
      epoch: string,
      seq: number,
      text: string,
      flush = false,
    ): void => {
      if (!isAfterBaseline(epoch, seq)) return;
      observedAssistantTexts.add(text);
      if (seenLiveSequences.has(`${epoch}:${seq}`)) return;
      if (liveAssistant === null || liveAssistant.epoch !== epoch) {
        if (liveAssistant) resetAssistantBlock();
        assistantBlockObserved = false;
        assistantBlockBlocked = false;
        assistantBlockLastPublicText = '';
        liveAssistant = { epoch, seq, text };
      } else if (seq <= liveAssistant.seq) {
        return;
      } else {
        liveAssistant = {
          ...liveAssistant,
          seq,
          text: mergeProjectedText(liveAssistant.text, text),
        };
      }
      seenLiveSequences.add(`${epoch}:${seq}`);
      assistantBlockObserved = true;
      emitSnapshot(epoch, seq, liveAssistant.text, flush);
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
        resetAssistantBlock();
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
      consumeAssistantSnapshot(event.epoch, event.seq, event.assistantText);
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
      const modelId = effectiveModel;
      const agent =
        input.operation === 'continue'
          ? {
              id: input.providerAgentId,
              provider: effectiveProvider,
              model: effectiveModel,
            }
          : await (async () => {
              const agentStartedAt = Date.now();
              this.#logger.log('info', 'runtime.agent.create.started', {
                run_id: input.runId,
                managed_cell: managedCellExecution,
                has_mcp_servers: Boolean(input.extensions?.mcpServers?.length),
                model_id: modelId,
              });
              const created = await this.#client.createAgent({
                provider: createProvider,
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
              return {
                ...created,
                provider: created.provider,
                model: created.model,
              };
            })();
      activeAgentId = agent.id;
      activeProvider = agent.provider;
      this.#agents.set(input.runId, agent.id);
      if (input.operation === 'create')
        this.#agentBindings.set(agent.id, {
          provider: agent.provider,
          model: agent.model,
        });
      if (input.operation === 'create' && input.onProviderBinding)
        await input.onProviderBinding({
          providerAgentId: agent.id,
          paseoWorkspaceId: workspaceId,
        });

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
        resetAssistantBlock();
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
            resetAssistantBlock();
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
          consumeAssistantSnapshot(
            page.epoch,
            entry.seqEnd,
            entry.assistantText,
            true,
          );
        }
        flushAssistantBlock();
        if (
          !assistantBlockObserved &&
          finished.lastMessage &&
          !observedAssistantTexts.has(finished.lastMessage) &&
          page.endCursor
        ) {
          consumeAssistantSnapshot(
            page.epoch,
            page.endCursor.seq,
            finished.lastMessage,
            true,
          );
          flushAssistantBlock();
        }
      }
      flushAssistantBlock();
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
      if (!hasPositiveModelUsage(finished.usage)) {
        throw new RuntimeExecutionError(
          `Paseo completed without positive model usage evidence (provider=${agent.provider}, model=${agent.model}).`,
        );
      }

      const memory = artifact
        ? await this.#readMemoryCandidates(artifact, executionCwd)
        : {};
      return {
        provider: agent.provider,
        model: agent.model,
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
      this.#agentBindings.delete(agentId);
    }
  }

  public async health(): Promise<AgentRuntimeHealth> {
    const connected = this.#client.connectionStatus() === 'connected';
    const workspaceReady = this.#workspaceId !== null;
    const modelReady = this.#model !== null;
    const errorDetail = this.#lastError ?? undefined;

    return {
      ready: connected && workspaceReady && modelReady,
      provider: this.#options.provider,
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
    this.#agentBindings.clear();
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

type TextProjection =
  | { readonly kind: 'absent' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'visible';
      readonly text: string;
      readonly redacted: boolean;
    }
  | { readonly kind: 'blocked'; readonly reason: 'credential' };

function toolPresentation(
  call: PaseoToolCall,
  category: RuntimeToolCategory,
  executionCwd: string,
  sanitizeText: (value: string, max?: number, flush?: boolean) => string | null,
): {
  readonly label: string;
  readonly summary: string;
  readonly quality: number;
  readonly detail?: RuntimeToolDetail;
} {
  const fallback = categoryLabel(category);
  const typedDetail = projectRuntimeToolDetail(
    call.detail,
    executionCwd,
    sanitizeText,
    call.error,
  );
  const detailLabel = typedDetail
    ? 'command' in typedDetail
      ? typedDetail.command
      : 'filePath' in typedDetail
        ? typedDetail.filePath
        : 'query' in typedDetail
          ? typedDetail.query
          : 'url' in typedDetail
            ? typedDetail.url
            : 'description' in typedDetail
              ? typedDetail.description
              : undefined
    : undefined;
  const titleProjection = projectText(call.title, 8000, [executionCwd], true);
  const providerTitle =
    titleProjection.kind === 'visible'
      ? flattenProviderTitle(titleProjection.text, 80)
      : null;
  const titleWasRedacted = titleProjection.kind === 'blocked';
  const quality = call.title !== undefined ? 2 : typedDetail ? 1 : 0;
  return {
    label: providerTitle
      ? providerTitle
      : titleWasRedacted
        ? 'Tool title hidden by credential screening'
        : detailLabel
          ? (safeSingleLine(`${fallback}: ${detailLabel}`, 80, false) ??
            fallback)
          : fallback,
    summary: toolSummary(category),
    quality,
    ...(typedDetail ? { detail: typedDetail } : {}),
  };
}

function flattenProviderTitle(
  value: string,
  maxCodePoints: number,
): string | null {
  const flattened = value.replace(/[\r\n\t ]+/gu, ' ').trim();
  if (!flattened) return null;
  return Array.from(flattened).slice(0, maxCodePoints).join('');
}

function projectRuntimeToolDetail(
  source: PaseoToolCall['detail'],
  executionCwd: string,
  sanitizeText: (value: string, max?: number, flush?: boolean) => string | null,
  failedError?: string,
): RuntimeToolDetail | undefined {
  if (!source) return undefined;
  const kind = source.type === 'sub_agent' ? 'subagent' : source.type;
  const output: Record<string, unknown> = { kind };
  const putText = (key: string, value: unknown): void => {
    if (typeof value !== 'string') return;
    const sanitized = sanitizeText(value, 8000, true);
    if (sanitized !== null) output[key] = sanitized;
  };
  if ('command' in source && source.command) putText('command', source.command);
  if ('cwd' in source && source.cwd) putText('cwd', source.cwd);
  if ('filePath' in source && source.filePath) {
    const path = workspaceRelativePath(executionCwd, source.filePath);
    if (path && !containsCredentialMarker(path)) output.filePath = path;
  }
  if ('content' in source && source.content) putText('content', source.content);
  if ('oldString' in source && source.oldString)
    putText('oldString', source.oldString);
  if ('newString' in source && source.newString)
    putText('newString', source.newString);
  if ('query' in source && source.query) putText('query', source.query);
  if ('toolName' in source && source.toolName)
    output.toolName = source.toolName;
  if ('filePaths' in source && Array.isArray(source.filePaths))
    output.filePaths = source.filePaths
      .slice(0, 64)
      .map((path) => workspaceRelativePath(executionCwd, path))
      .filter(Boolean);
  if ('webResults' in source && Array.isArray(source.webResults))
    output.webResults = source.webResults.slice(0, 64).map((item) => ({
      ...(item.title
        ? { title: sanitizeText(item.title, 8000, true) ?? undefined }
        : {}),
      ...(item.url ? { url: safeHttpUrl(item.url) ?? undefined } : {}),
    }));
  if ('annotations' in source && Array.isArray(source.annotations))
    output.annotations = source.annotations
      .slice(0, 64)
      .filter(
        (annotation): annotation is string => typeof annotation === 'string',
      )
      .map((annotation) => sanitizeText(annotation, 8000, true))
      .filter((annotation): annotation is string => annotation !== null);
  for (const key of [
    'offset',
    'limit',
    'numFiles',
    'numMatches',
    'durationMs',
    'durationSeconds',
    'code',
    'bytes',
  ]) {
    const value = (source as unknown as Record<string, unknown>)[key];
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (key === 'durationSeconds' || Number.isSafeInteger(value))
    )
      output[key] = value;
  }
  if ('truncated' in source && typeof source.truncated === 'boolean')
    output.truncated = source.truncated;
  if ('mode' in source && source.mode) output.mode = source.mode;
  if ('url' in source && source.url) {
    const url = safeHttpUrl(source.url);
    if (url) output.url = url;
  }
  if ('subAgentType' in source && source.subAgentType)
    putText('subAgentType', source.subAgentType);
  if ('description' in source && source.description)
    putText('description', source.description);
  for (const key of [
    'output',
    'result',
    'prompt',
    'codeText',
    'log',
    'unifiedDiff',
    'error',
  ]) {
    if (key in source)
      putText(key, (source as unknown as Record<string, unknown>)[key]);
  }
  if (
    'exitCode' in source &&
    (source.exitCode === null || Number.isSafeInteger(source.exitCode))
  )
    output.exitCode = source.exitCode;
  if ('actions' in source && Array.isArray(source.actions))
    output.actions = source.actions.slice(0, 64).map((action) => ({
      ...(typeof action.index === 'number' && Number.isSafeInteger(action.index)
        ? { index: action.index }
        : {}),
      ...(typeof action.toolName === 'string'
        ? { toolName: sanitizeText(action.toolName, 8000, true) ?? undefined }
        : {}),
      ...(typeof action.summary === 'string'
        ? { summary: sanitizeText(action.summary, 8000, true) ?? undefined }
        : {}),
    }));
  if (failedError) {
    const safeError = sanitizeText(failedError, 8000, true);
    if (safeError) output.error = safeError;
  }
  return output as RuntimeToolDetail;
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
  const projection = projectText(value, max, roots, true);
  return projection.kind === 'visible' ? projection.text : null;
}

function projectText(
  value: string | undefined,
  max: number,
  roots: readonly string[],
  flush: boolean,
): TextProjection {
  if (value === undefined) return { kind: 'absent' };
  if (!value.trim()) return { kind: 'empty' };
  const redacted = redactCredentialValues(value);
  if (redacted.blocked) return { kind: 'blocked', reason: 'credential' };
  if (!flush && credentialPrefixPending(value)) return { kind: 'pending' };
  let sanitized = formatProjectedText(redacted.text, roots);
  sanitized = Array.from(sanitized).slice(0, max).join('');
  if (!flush) {
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
    if (suspiciousStart >= 0 && value.length - suspiciousStart <= 4096)
      committedEnd = Math.min(
        committedEnd,
        Math.max(0, sanitized.length - (value.length - suspiciousStart)),
      );
    if (committedEnd === 0) return { kind: 'pending' };
    sanitized = sanitized.slice(0, committedEnd);
  }
  if (!sanitized.trim()) return { kind: 'empty' };
  return {
    kind: 'visible',
    text: sanitized,
    redacted: redacted.redacted,
  };
}

function formatProjectedText(value: string, roots: readonly string[]): string {
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
  sanitized = sanitized.replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '<redacted>');
  return sanitized;
}

function sanitizeStreamingText(
  value: string,
  max: number,
  roots: readonly string[],
  flush: boolean,
): string | null {
  const projection = projectText(value, max, roots, flush);
  return projection.kind === 'visible' ? projection.text : null;
}

function mergeProjectedText(existing: string, incoming: string): string {
  const next = capDetail(incoming);
  if (!existing) return next;
  if (next.startsWith(existing)) return next;
  if (existing.endsWith(next)) return existing;
  return capDetail(existing + next);
}

const credentialAssignmentPattern =
  /(?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s,;]+)/i;
const credentialHeaderPattern =
  /(?:^|\s)(?:-u|--user|-H|--header|--auth|--authentication|--password|--secret|--token|--credential|--access[_-]?key|--session[_-]?key|--api[_-]?key|--private[_-]?key)(?:=|\s+)(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s]+)/i;
const credentialBearerPattern =
  /\b(?:bearer|basic)\s+(?!\[REDACTED\])[A-Za-z0-9+/._~=-]+/i;
const credentialUrlPattern = /:\/\/(?!\[REDACTED\])[^/?#\s]+@/i;
const credentialPemPattern = /-----BEGIN [^-]+-----/i;

function redactCredentialValues(value: string): {
  readonly text: string;
  readonly redacted: boolean;
  readonly blocked: boolean;
} {
  let text = value;
  let redacted = false;
  const replace = (pattern: RegExp, replacement: string): void => {
    const next = text.replace(pattern, replacement);
    if (next !== text) redacted = true;
    text = next;
  };
  replace(
    /((?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*)(?:(?:bearer|basic)\s+[^\s,;]+|"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    '$1[REDACTED]',
  );
  replace(
    /((?:^|\s)(?:-u|--user|-H|--header|--auth|--authentication|--password|--secret|--token|--credential|--access[_-]?key|--session[_-]?key|--api[_-]?key|--private[_-]?key)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
    '$1[REDACTED]',
  );
  replace(/(\b(?:bearer|basic)\s+)[A-Za-z0-9+/._~=-]+/giu, '$1[REDACTED]');
  replace(/((?:https?|ftp):\/\/)[^/?#\s]+@/giu, '$1[REDACTED]@');
  replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/giu, '[REDACTED]');
  return {
    text,
    redacted,
    blocked: containsCredentialMarker(text),
  };
}

function credentialPrefixPending(value: string): boolean {
  return /(?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*$/i.test(
    value,
  );
}

function containsCredentialMarker(value: string): boolean {
  return (
    credentialAssignmentPattern.test(value) ||
    credentialHeaderPattern.test(value) ||
    credentialBearerPattern.test(value) ||
    credentialUrlPattern.test(value) ||
    credentialPemPattern.test(value)
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
