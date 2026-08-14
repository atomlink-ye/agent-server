import { relative, resolve } from 'node:path';

import type {
  ExecutionObservation,
  ExecutionObservationSink,
  ExecutionToolCategory,
  ExecutionToolDetail,
  ExecutionToolStatus,
} from '../../application/ports/execution-plane.js';
import type { RunUsage } from '../../domain/runs/run.js';
import type {
  PaseoAgentStreamEvent,
  PaseoProviderSubagentDescriptor,
  PaseoProviderSubagentTimeline,
  PaseoProviderSubagentUpdate,
  PaseoTimelinePage,
  PaseoToolCall,
} from './paseo-client-port.js';

/**
 * Stateful reducer for one Paseo Turn. It is the only Paseo integration object
 * that owns timeline sequence/deduplication and nested-activity projection.
 */
export class PaseoObservationProjector {
  readonly #agentId: string;
  readonly #provider: string;
  readonly #executionCwd: string;
  readonly #roots: readonly string[];
  readonly #sink?: ExecutionObservationSink;
  #baseline: PaseoTimelinePage | null = null;
  #queue = Promise.resolve();

  readonly #seenSequences = new Set<string>();
  readonly #emittedSnapshots = new Map<string, string>();
  readonly #observedAssistantTexts = new Set<string>();
  readonly #parentCallActivities = new Map<string, string>();
  readonly #publishedParentActivities = new Set<string>();
  readonly #childSessionToParentActivity = new Map<string, string>();
  readonly #parentActivityToChildSession = new Map<string, string>();
  readonly #conflictedChildSessionIds = new Set<string>();
  readonly #childCallActivities = new Map<string, string>();
  readonly #childSequenceKeys = new Set<string>();
  readonly #childParents = new Map<string, string>();
  readonly #childDescriptors = new Map<string, PaseoProviderSubagentDescriptor>();
  readonly #pendingSubagents = new Map<string, PaseoProviderSubagentDescriptor>();
  readonly #conflictedDescriptorIds = new Set<string>();
  readonly #parentActivityToDescriptor = new Map<string, string>();
  readonly #descriptorChildSessions = new Map<string, string>();
  readonly #baselineSubagents = new Map<string, PaseoProviderSubagentDescriptor>();
  readonly #activityStates = new Map<string, ProjectedToolState>();
  readonly #deferredParentTerminals = new Map<string, DeferredTerminal>();
  readonly #permissionActivities = new Map<
    string,
    { readonly activityId: string; readonly status: string; readonly decision?: string }
  >();
  readonly #childTimelineActivities = new Map<string, ChildTextState>();
  readonly #currentChildTextSegments = new Map<
    string,
    { readonly itemKind: 'assistant' | 'reasoning'; readonly timelineKey?: string; readonly key: string }
  >();
  readonly #childTextSegmentCounters = new Map<string, number>();

  #nextActivity = 1;
  #nextPermission = 1;
  #reasoningActive = false;
  #reasoningSourceText = '';
  #reasoningText = '';
  #reasoningQuarantined = false;
  #liveAssistant: { readonly epoch: string; readonly seq: number; readonly text: string } | null = null;
  #assistantBlockObserved = false;
  #assistantBlockBlocked = false;
  #assistantBlockLastPublicText = '';
  #deferParentTerminals = true;

  public constructor(input: {
    readonly agentId: string;
    readonly provider: string;
    readonly executionCwd: string;
    readonly additionalRoots?: readonly string[];
    readonly sink?: ExecutionObservationSink;
  }) {
    this.#agentId = input.agentId;
    this.#provider = input.provider;
    this.#executionCwd = input.executionCwd;
    this.#roots = [input.executionCwd, ...(input.additionalRoots ?? [])];
    this.#sink = input.sink;
  }

  public setBaseline(
    timeline: PaseoTimelinePage | null,
    subagents: readonly PaseoProviderSubagentDescriptor[] = [],
  ): void {
    this.#baseline = timeline;
    this.#baselineSubagents.clear();
    for (const descriptor of subagents) {
      if (descriptor.parentAgentId === this.#agentId)
        this.#baselineSubagents.set(descriptor.id, descriptor);
    }
  }

  public emitTurnStarted(runId: string): void {
    this.#emit({ kind: 'turn_started', runId });
  }

  public isAfterBaseline(epoch: string | null, seq: number | null): boolean {
    if (epoch === null || seq === null) return false;
    return (
      !this.#baseline ||
      this.#baseline.epoch !== epoch ||
      !this.#baseline.endCursor ||
      seq > this.#baseline.endCursor.seq
    );
  }

  public consumeStreamEvent(event: PaseoAgentStreamEvent): void {
    if (event.agentId !== this.#agentId) return;
    if (event.reasoningText) this.#consumeReasoningText(event.reasoningText);
    this.#consumeProjectedActivity(event);
    if (
      event.timelineItemType !== 'assistant_message' ||
      event.assistantText === undefined ||
      event.seq === null ||
      event.epoch === null
    )
      return;
    this.#consumeAssistantSnapshot(event.epoch, event.seq, event.assistantText);
  }

  public consumeParentTimeline(page: PaseoTimelinePage): void {
    for (const entry of [...page.entries].sort((a, b) => a.seqEnd - b.seqEnd)) {
      if (!this.isAfterBaseline(page.epoch, entry.seqEnd)) continue;
      if (entry.reasoningText) this.#consumeReasoningText(entry.reasoningText);
      if (entry.toolCall) {
        this.#completeReasoning();
        this.#resetAssistantBlock();
        this.#consumeParentToolCall(entry.toolCall);
      }
      if (
        entry.timelineItemType === 'assistant_message' &&
        entry.assistantText !== undefined
      )
        this.#consumeAssistantSnapshot(
          page.epoch,
          entry.seqEnd,
          entry.assistantText,
          true,
        );
    }
  }

  public consumeProviderSubagentUpdate(update: PaseoProviderSubagentUpdate): void {
    const parentAgentId =
      update.kind === 'upsert'
        ? update.subagent.parentAgentId
        : update.parentAgentId;
    if (parentAgentId !== this.#agentId) return;
    if (update.kind === 'upsert') {
      this.consumeProviderSubagentDescriptor(update.subagent);
      if (update.subagent.status !== 'running')
        this.finalizeProviderSubagent(update.subagent);
      return;
    }
    if (update.kind === 'remove') return;
    const descriptor = this.#childDescriptors.get(update.subagentId);
    if (!descriptor || !this.#childParents.has(update.subagentId)) return;
    this.consumeChildTimeline(descriptor, {
      parentAgentId: update.parentAgentId,
      subagentId: update.subagentId,
      epoch: update.epoch,
      direction: 'tail',
      rows: [{ item: update.item, timestamp: update.timestamp, seq: update.seq }],
      hasOlder: false,
    });
  }

  /** Returns true when a descriptor has a safe parent correlation. */
  public consumeProviderSubagentDescriptor(
    descriptor: PaseoProviderSubagentDescriptor,
  ): boolean {
    if (descriptor.parentAgentId !== this.#agentId) return false;
    if (
      this.#conflictedDescriptorIds.has(descriptor.id) ||
      this.#conflictedChildSessionIds.has(descriptor.id)
    )
      return false;
    const baseline = this.#baselineSubagents.get(descriptor.id);
    if (
      baseline &&
      baseline.status === descriptor.status &&
      !this.#childDescriptors.has(descriptor.id)
    )
      return false;

    // COMPAT(opencode-subagent-child-session-correlation): Paseo 0.1.110 may
    // omit toolCallId, so childSessionId correlation remains the safe fallback.
    const parentActivityId = descriptor.toolCallId
      ? this.#parentCallActivities.get(descriptor.toolCallId)
      : this.#childSessionToParentActivity.get(descriptor.id);
    if (!parentActivityId || !this.#publishedParentActivities.has(parentActivityId)) {
      this.#pendingSubagents.set(descriptor.id, descriptor);
      return false;
    }

    const existingParent = this.#childParents.get(descriptor.id);
    if (existingParent && existingParent !== parentActivityId) {
      this.#markDescriptorConflicted(descriptor.id);
      const competing = this.#parentActivityToDescriptor.get(parentActivityId);
      if (competing) this.#markDescriptorConflicted(competing);
      return false;
    }
    const childSessionParent = this.#childSessionToParentActivity.get(descriptor.id);
    if (childSessionParent && childSessionParent !== parentActivityId) {
      this.#quarantineChildCompetition(
        parentActivityId,
        descriptor.id,
        childSessionParent,
      );
      return false;
    }
    const parentChild = this.#parentActivityToChildSession.get(parentActivityId);
    if (parentChild && parentChild !== descriptor.id) {
      this.#quarantineChildCompetition(parentActivityId, descriptor.id);
      return false;
    }
    const competing = this.#parentActivityToDescriptor.get(parentActivityId);
    if (competing && competing !== descriptor.id) {
      this.#markDescriptorConflicted(competing);
      this.#markDescriptorConflicted(descriptor.id);
      this.#parentActivityToDescriptor.delete(parentActivityId);
      return false;
    }

    this.#childDescriptors.set(descriptor.id, descriptor);
    this.#childParents.set(descriptor.id, parentActivityId);
    this.#descriptorChildSessions.set(descriptor.id, descriptor.id);
    this.#parentActivityToDescriptor.set(parentActivityId, descriptor.id);
    this.#childSessionToParentActivity.set(descriptor.id, parentActivityId);
    this.#parentActivityToChildSession.set(parentActivityId, descriptor.id);
    this.#pendingSubagents.delete(descriptor.id);

    const parentState = this.#activityStates.get(parentActivityId);
    const descriptorText = descriptor.title ?? descriptor.description ?? '';
    const descriptorLabel = safeSingleLine(
      this.#sanitize(descriptorText, 8000, true) ?? '',
      80,
      true,
    );
    if (parentState && descriptorLabel)
      this.#publishToolState({
        activityId: parentActivityId,
        category: parentState.category,
        status: normalizeToolStatus(parentState.status) ?? 'running',
        label:
          safeSingleLine(`Sub-agent task: ${descriptorLabel}`, 80, false) ??
          parentState.label,
        summary: parentState.summary,
        toolName: parentState.toolName,
        quality: 2,
      });
    return true;
  }

  public consumeChildTimeline(
    descriptor: PaseoProviderSubagentDescriptor,
    timeline: PaseoProviderSubagentTimeline,
  ): void {
    if (
      descriptor.parentAgentId !== this.#agentId ||
      timeline.parentAgentId !== this.#agentId ||
      timeline.subagentId !== descriptor.id
    )
      return;
    const parentActivityId = this.#childParents.get(descriptor.id);
    if (!parentActivityId || !timeline.epoch) return;
    for (const row of [...timeline.rows].sort((a, b) => a.seq - b.seq)) {
      const rowKey = `${descriptor.id}:${timeline.epoch}:${row.seq}`;
      if (this.#childSequenceKeys.has(rowKey)) continue;
      this.#childSequenceKeys.add(rowKey);
      if (row.item.toolCall) {
        this.#currentChildTextSegments.delete(descriptor.id);
        this.#publishToolCall(
          row.item.toolCall,
          `${descriptor.id}:${timeline.epoch}:${row.item.toolCall.callId}`,
          parentActivityId,
        );
        continue;
      }
      if (!row.item.assistantText && !row.item.reasoningText) continue;
      const itemKind = row.item.assistantText ? 'assistant' : 'reasoning';
      const text = row.item.assistantText ?? row.item.reasoningText ?? '';
      const current = this.#currentChildTextSegments.get(descriptor.id);
      const sameSegment =
        current?.itemKind === itemKind &&
        (!row.item.timelineKey ||
          !current.timelineKey ||
          current.timelineKey === row.item.timelineKey);
      let segment = sameSegment ? current : undefined;
      if (!segment) {
        const counter = (this.#childTextSegmentCounters.get(descriptor.id) ?? 0) + 1;
        this.#childTextSegmentCounters.set(descriptor.id, counter);
        segment = {
          itemKind,
          key: `${descriptor.id}:${itemKind}:${counter}`,
          ...(row.item.timelineKey ? { timelineKey: row.item.timelineKey } : {}),
        };
        this.#currentChildTextSegments.set(descriptor.id, segment);
      }
      this.#emitChildTimeline(parentActivityId, segment.key, itemKind, text);
    }
  }

  public finalizeProviderSubagent(
    descriptor: PaseoProviderSubagentDescriptor,
  ): void {
    const parentActivityId = this.#childParents.get(descriptor.id);
    if (!parentActivityId || descriptor.status === 'running') return;
    const terminalStatus: ExecutionToolStatus =
      descriptor.status === 'completed'
        ? 'completed'
        : descriptor.status === 'failed'
          ? 'failed'
          : 'cancelled';
    for (const item of this.#childTimelineActivities.values()) {
      if (item.parentActivityId !== parentActivityId || item.status !== 'running')
        continue;
      const finalText = item.quarantined
        ? item.text
        : (this.#sanitize(item.sourceText, 8000, true) ?? item.text);
      if (!finalText && !item.emitted) continue;
      this.#emit({
        kind: 'child_activity_updated',
        activityId: item.activityId,
        parentActivityId,
        itemKind: item.itemKind,
        status: terminalStatus,
        label: item.itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
        summary:
          safeSingleLine(finalText, 160, false) ??
          (item.itemKind === 'assistant' ? 'Assistant' : 'Thinking'),
        ...(finalText ? { text: finalText } : {}),
        provider: this.#provider,
      });
      item.text = finalText;
      item.status = terminalStatus;
    }
    const parent = this.#activityStates.get(parentActivityId);
    if (parent)
      this.#publishToolState({
        activityId: parentActivityId,
        category: parent.category,
        status: terminalStatus,
        label: parent.label,
        summary: parent.summary,
        toolName: parent.toolName,
        quality: parent.quality,
        detail: parent.detail,
      });
  }

  public hasProviderSubagent(descriptorId: string): boolean {
    return this.#childParents.has(descriptorId);
  }

  public async finalize(input: {
    readonly finalTimeline?: PaseoTimelinePage;
    readonly finalMessage?: string | null;
    readonly usage?: RunUsage;
  } = {}): Promise<void> {
    if (input.finalTimeline) {
      this.#resetAssistantBlock();
      this.consumeParentTimeline(input.finalTimeline);
      if (
        !this.#assistantBlockObserved &&
        input.finalMessage &&
        !this.#observedAssistantTexts.has(input.finalMessage) &&
        input.finalTimeline.endCursor
      )
        this.#consumeAssistantSnapshot(
          input.finalTimeline.epoch,
          input.finalTimeline.endCursor.seq,
          input.finalMessage,
          true,
        );
    }
    this.#flushAssistantBlock();
    this.#flushDeferredParentTerminals();
    this.#completeReasoning();
    if (input.usage) this.#emit({ kind: 'usage_updated', usage: input.usage });
    await this.drain();
  }

  public async drain(): Promise<void> {
    await this.#queue;
  }

  #consumeProjectedActivity(event: PaseoAgentStreamEvent): void {
    if (!this.isAfterBaseline(event.epoch, event.seq)) return;
    if (
      this.#reasoningActive &&
      ['lifecycle', 'agent_status', 'finished', 'completed', 'failed', 'cancelled'].includes(
        event.eventType,
      )
    )
      this.#completeReasoning();
    if (event.reasoning) this.#emitReasoningStarted();
    if (event.assistantText !== undefined) this.#completeReasoning();
    if (event.toolCall) {
      this.#completeReasoning();
      this.#resetAssistantBlock();
      this.#consumeParentToolCall(event.toolCall);
    }
    if (event.permission) {
      const previous = this.#permissionActivities.get(event.permission.requestId);
      const activityId = previous?.activityId ?? `permission-${this.#nextPermission++}`;
      if (previous?.status === 'resolved') return;
      if (
        previous?.status === event.permission.status &&
        previous.decision === event.permission.decision
      )
        return;
      this.#permissionActivities.set(event.permission.requestId, {
        activityId,
        status: event.permission.status,
        ...(event.permission.decision ? { decision: event.permission.decision } : {}),
      });
      this.#emit({
        kind: 'permission_updated',
        activityId,
        category: permissionCategory(event.permission.kind),
        status: event.permission.status,
        ...(event.permission.decision ? { decision: event.permission.decision } : {}),
        summary: 'Permission activity is read-only.',
      });
    }
  }

  #consumeReasoningText(text: string): void {
    if (this.#reasoningQuarantined) return;
    this.#reasoningSourceText = mergeProjectedText(this.#reasoningSourceText, text);
    const sanitized = this.#sanitize(this.#reasoningSourceText, 8000, false);
    if (sanitized === null) {
      this.#reasoningQuarantined = true;
      this.#reasoningText = '';
      return;
    }
    const changed = this.#reasoningText !== sanitized;
    this.#reasoningText = sanitized;
    this.#reasoningActive = true;
    if (changed)
      this.#emit({
        kind: 'reasoning_updated',
        status: 'started',
        ...(this.#reasoningText ? { text: this.#reasoningText } : {}),
      });
  }

  #emitReasoningStarted(): void {
    if (this.#reasoningActive) return;
    this.#reasoningActive = true;
    this.#emit({
      kind: 'reasoning_updated',
      status: 'started',
      ...(this.#reasoningText ? { text: this.#reasoningText } : {}),
    });
  }

  #completeReasoning(): void {
    if (!this.#reasoningActive) return;
    this.#reasoningActive = false;
    const finalText = this.#reasoningQuarantined
      ? null
      : this.#sanitize(this.#reasoningSourceText, 8000, true);
    this.#emit({
      kind: 'reasoning_updated',
      status: 'completed',
      ...(finalText ? { text: finalText } : {}),
    });
    this.#reasoningText = '';
    this.#reasoningSourceText = '';
    this.#reasoningQuarantined = false;
  }

  #consumeAssistantSnapshot(
    epoch: string,
    seq: number,
    text: string,
    flush = false,
  ): void {
    if (!this.isAfterBaseline(epoch, seq)) return;
    this.#observedAssistantTexts.add(text);
    const sequenceKey = `${epoch}:${seq}`;
    if (this.#seenSequences.has(sequenceKey)) return;
    if (!this.#liveAssistant || this.#liveAssistant.epoch !== epoch) {
      if (this.#liveAssistant) this.#resetAssistantBlock();
      this.#assistantBlockObserved = false;
      this.#assistantBlockBlocked = false;
      this.#assistantBlockLastPublicText = '';
      this.#liveAssistant = { epoch, seq, text };
    } else if (seq <= this.#liveAssistant.seq) {
      return;
    } else {
      this.#liveAssistant = {
        ...this.#liveAssistant,
        seq,
        text: mergeProjectedText(this.#liveAssistant.text, text),
      };
    }
    this.#seenSequences.add(sequenceKey);
    this.#assistantBlockObserved = true;
    this.#emitAssistantSnapshot(epoch, seq, this.#liveAssistant.text, flush);
  }

  #emitAssistantSnapshot(
    epoch: string,
    seq: number,
    text: string,
    flush: boolean,
  ): void {
    if (!text) return;
    const projection = projectText(text, 8000, this.#roots, flush);
    if (projection.kind === 'blocked') {
      if (this.#assistantBlockBlocked) return;
      this.#assistantBlockBlocked = true;
      const redactedText = this.#assistantBlockLastPublicText
        ? `${this.#assistantBlockLastPublicText}\n\n[Content redacted by credential screening]`
        : '[Content redacted by credential screening]';
      const key = `${epoch}:${seq}`;
      if (this.#emittedSnapshots.get(key) === redactedText) return;
      this.#emittedSnapshots.set(key, redactedText);
      this.#assistantBlockLastPublicText = redactedText;
      this.#emit({ kind: 'assistant_updated', text: redactedText });
      return;
    }
    if (projection.kind !== 'visible' || !projection.text) return;
    if (
      this.#baseline?.epoch === epoch &&
      this.#baseline.endCursor &&
      seq <= this.#baseline.endCursor.seq
    )
      return;
    const key = `${epoch}:${seq}`;
    if (this.#emittedSnapshots.get(key) === projection.text) return;
    this.#emittedSnapshots.set(key, projection.text);
    this.#assistantBlockLastPublicText = projection.text;
    this.#emit({ kind: 'assistant_updated', text: projection.text });
  }

  #flushAssistantBlock(): void {
    if (!this.#liveAssistant) return;
    this.#emitAssistantSnapshot(
      this.#liveAssistant.epoch,
      this.#liveAssistant.seq,
      this.#liveAssistant.text,
      true,
    );
    this.#liveAssistant = null;
  }

  #resetAssistantBlock(): void {
    this.#flushAssistantBlock();
    this.#assistantBlockObserved = false;
    this.#assistantBlockBlocked = false;
    this.#assistantBlockLastPublicText = '';
  }

  #consumeParentToolCall(call: PaseoToolCall): void {
    const activityId = this.#publishToolCall(call, `parent:${call.callId}`);
    if (!activityId) return;
    if (this.#publishedParentActivities.has(activityId)) {
      for (const pending of [...this.#pendingSubagents.values()]) {
        if (pending.toolCallId === call.callId)
          this.consumeProviderSubagentDescriptor(pending);
      }
    }
  }

  #publishToolCall(
    call: PaseoToolCall,
    key: string,
    parentActivityId?: string,
  ): string | null {
    const status = normalizeToolStatus(call.status);
    if (!status) return null;
    const activityId =
      (parentActivityId
        ? this.#childCallActivities.get(key)
        : this.#parentCallActivities.get(call.callId)) ?? this.#allocateActivityId();
    if (parentActivityId) this.#childCallActivities.set(key, activityId);
    else this.#parentCallActivities.set(call.callId, activityId);
    const category = toolCategory(call.name, call.detail?.type);
    const presentation = toolPresentation(
      call,
      category,
      this.#executionCwd,
      (value, max = 8000, flush = true) => this.#sanitize(value, max, flush),
    );
    if (
      !parentActivityId &&
      this.#deferParentTerminals &&
      category === 'subagent' &&
      status !== 'running' &&
      !this.#activityStates.has(activityId)
    )
      this.#publishToolState({
        activityId,
        category,
        status: 'running',
        label: presentation.label,
        summary: presentation.summary,
        toolName: call.name,
        quality: presentation.quality,
        detail: presentation.detail,
        resultObserved: call.resultObserved,
      });
    this.#publishToolState({
      activityId,
      category,
      status,
      label: presentation.label,
      summary: presentation.summary,
      toolName: call.name,
      parentActivityId,
      quality: presentation.quality,
      detail: presentation.detail,
      resultObserved: call.resultObserved,
    });
    if (!parentActivityId && this.#activityStates.has(activityId)) {
      this.#publishedParentActivities.add(activityId);
      this.#recordChildSessionCorrelation(
        call.childSessionId ??
          (call.detail?.type === 'sub_agent'
            ? call.detail.childSessionId
            : undefined),
        activityId,
      );
    }
    return activityId;
  }

  #publishToolState(input: {
    readonly activityId: string;
    readonly category: ExecutionToolCategory;
    readonly status: ExecutionToolStatus;
    readonly label: string;
    readonly summary: string;
    readonly toolName?: string;
    readonly parentActivityId?: string;
    readonly quality?: number;
    readonly detail?: ExecutionToolDetail;
    readonly resultObserved?: boolean;
  }): void {
    const quality = input.quality ?? 0;
    const previous = this.#activityStates.get(input.activityId);
    const detailImproved =
      input.detail !== undefined &&
      JSON.stringify(input.detail).length > JSON.stringify(previous?.detail ?? {}).length &&
      JSON.stringify(input.detail) !== JSON.stringify(previous?.detail);
    const bestDetail = detailImproved ? input.detail : previous?.detail;
    if (
      this.#deferParentTerminals &&
      !input.parentActivityId &&
      input.category === 'subagent' &&
      input.status !== 'running'
    ) {
      const deferred = this.#deferredParentTerminals.get(input.activityId);
      if (deferred && deferred.status !== input.status) return;
      if (deferred && quality <= deferred.quality) return;
      this.#deferredParentTerminals.set(input.activityId, {
        category: input.category,
        status: input.status,
        label: input.label,
        summary: input.summary,
        toolName: input.toolName ?? previous?.toolName ?? input.label,
        quality,
      });
      return;
    }
    if (previous && isTerminalToolStatus(previous.status)) {
      if (previous.status !== input.status || (quality <= previous.quality && !detailImproved))
        return;
    }
    if (previous?.status === input.status && quality <= previous.quality && !detailImproved)
      return;
    const bestLabel = previous && previous.quality >= quality ? previous.label : input.label;
    const bestSummary =
      previous && previous.quality >= quality ? previous.summary : input.summary;
    const bestQuality = Math.max(previous?.quality ?? 0, quality);
    if (
      previous?.status === input.status &&
      previous.category === input.category &&
      previous.label === bestLabel &&
      previous.summary === bestSummary &&
      previous.parentActivityId === input.parentActivityId &&
      !detailImproved
    )
      return;
    this.#activityStates.set(input.activityId, {
      category: input.category,
      status: input.status,
      label: bestLabel,
      summary: bestSummary,
      ...((input.toolName ?? previous?.toolName)
        ? { toolName: input.toolName ?? previous?.toolName }
        : {}),
      ...(bestDetail ? { detail: bestDetail } : {}),
      quality: bestQuality,
      ...(input.parentActivityId ? { parentActivityId: input.parentActivityId } : {}),
    });
    if (input.parentActivityId) {
      this.#emit({
        kind: 'child_activity_updated',
        activityId: input.activityId,
        parentActivityId: input.parentActivityId,
        itemKind: 'tool',
        status: input.status,
        label: bestLabel,
        summary: bestSummary,
        ...(bestDetail ? { detail: bestDetail } : {}),
        provider: this.#provider,
      });
    } else {
      this.#emit({
        kind: 'tool_updated',
        activityId: input.activityId,
        category: input.category,
        status: input.status,
        label: bestLabel,
        summary: bestSummary,
        ...((input.toolName ?? previous?.toolName)
          ? { toolName: input.toolName ?? previous?.toolName }
          : {}),
        resultObserved: input.resultObserved ?? hasObservedToolResult(bestDetail),
        ...(bestDetail ? { detail: bestDetail } : {}),
        provider: this.#provider,
      });
    }
  }

  #flushDeferredParentTerminals(): void {
    this.#deferParentTerminals = false;
    for (const [activityId, state] of this.#deferredParentTerminals) {
      const current = this.#activityStates.get(activityId);
      this.#publishToolState({
        activityId,
        category: state.category,
        status: state.status,
        label: current && current.quality >= state.quality ? current.label : state.label,
        summary:
          current && current.quality >= state.quality ? current.summary : state.summary,
        toolName: current?.toolName ?? state.toolName,
        quality: Math.max(current?.quality ?? 0, state.quality),
        detail: current?.detail,
      });
    }
    this.#deferredParentTerminals.clear();
  }

  #recordChildSessionCorrelation(
    childSessionId: string | undefined,
    parentActivityId: string,
  ): void {
    if (!childSessionId || this.#conflictedChildSessionIds.has(childSessionId)) return;
    const previousParent = this.#childSessionToParentActivity.get(childSessionId);
    const previousChild = this.#parentActivityToChildSession.get(parentActivityId);
    if (
      (previousParent && previousParent !== parentActivityId) ||
      (previousChild && previousChild !== childSessionId)
    ) {
      this.#quarantineChildCompetition(
        parentActivityId,
        childSessionId,
        previousParent && previousParent !== parentActivityId
          ? previousParent
          : undefined,
      );
      return;
    }
    const currentDescriptor = this.#parentActivityToDescriptor.get(parentActivityId);
    if (currentDescriptor && currentDescriptor !== childSessionId) {
      this.#conflictedChildSessionIds.add(childSessionId);
      this.#markDescriptorConflicted(currentDescriptor);
      this.#markDescriptorConflicted(childSessionId);
      this.#parentActivityToDescriptor.delete(parentActivityId);
      return;
    }
    this.#childSessionToParentActivity.set(childSessionId, parentActivityId);
    this.#parentActivityToChildSession.set(parentActivityId, childSessionId);
    const pending = this.#pendingSubagents.get(childSessionId);
    if (pending) this.consumeProviderSubagentDescriptor(pending);
  }

  #quarantineChildCompetition(
    parentActivityId: string,
    incomingChildSessionId: string,
    competingParentActivityId?: string,
  ): void {
    const childIds = new Set<string>([incomingChildSessionId]);
    const parents = new Set<string>([parentActivityId]);
    if (competingParentActivityId) parents.add(competingParentActivityId);
    const existingChild = this.#parentActivityToChildSession.get(parentActivityId);
    if (existingChild) childIds.add(existingChild);
    for (const [parent, child] of [...this.#parentActivityToChildSession]) {
      if (parents.has(parent) || childIds.has(child)) {
        childIds.add(child);
        this.#parentActivityToChildSession.delete(parent);
      }
    }
    for (const [child, parent] of [...this.#childSessionToParentActivity])
      if (parents.has(parent)) childIds.add(child);
    for (const child of childIds) {
      this.#conflictedChildSessionIds.add(child);
      this.#childSessionToParentActivity.delete(child);
      this.#markDescriptorConflicted(child);
    }
  }

  #markDescriptorConflicted(descriptorId: string): void {
    this.#conflictedDescriptorIds.add(descriptorId);
    const parentActivityId = this.#childParents.get(descriptorId);
    if (
      parentActivityId &&
      this.#parentActivityToDescriptor.get(parentActivityId) === descriptorId
    )
      this.#parentActivityToDescriptor.delete(parentActivityId);
    const childSessionId = this.#descriptorChildSessions.get(descriptorId);
    if (childSessionId) this.#childSessionToParentActivity.delete(childSessionId);
    if (parentActivityId) this.#parentActivityToChildSession.delete(parentActivityId);
    this.#descriptorChildSessions.delete(descriptorId);
    this.#childParents.delete(descriptorId);
    this.#childDescriptors.delete(descriptorId);
    this.#pendingSubagents.delete(descriptorId);
  }

  #emitChildTimeline(
    parentActivityId: string,
    key: string,
    itemKind: 'assistant' | 'reasoning',
    text: string,
  ): void {
    const previous = this.#childTimelineActivities.get(key);
    if (previous && (previous.status !== 'running' || previous.quarantined)) return;
    const activityId = previous?.activityId ?? this.#allocateActivityId();
    const sourceText = mergeProjectedText(previous?.sourceText ?? '', text);
    const sanitized = this.#sanitize(sourceText, 8000, false);
    if (sanitized === null) {
      this.#childTimelineActivities.set(key, {
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
      this.#childTimelineActivities.set(key, {
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
    const summary =
      safeSingleLine(sanitized, 160, false) ??
      (itemKind === 'assistant' ? 'Assistant' : 'Thinking');
    this.#childTimelineActivities.set(key, {
      activityId,
      parentActivityId,
      itemKind,
      sourceText,
      text: sanitized,
      quarantined: false,
      emitted: true,
      status: 'running',
    });
    this.#emit({
      kind: 'child_activity_updated',
      activityId,
      parentActivityId,
      itemKind,
      status: 'running',
      label: itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
      summary,
      text: sanitized,
      provider: this.#provider,
    });
  }

  #allocateActivityId(): string {
    return `activity-${this.#nextActivity++}`;
  }

  #sanitize(value: string, max: number, flush: boolean): string | null {
    const projection = projectText(value, max, this.#roots, flush);
    return projection.kind === 'visible' ? projection.text : null;
  }

  #emit(observation: ExecutionObservation): void {
    if (!this.#sink) return;
    this.#queue = this.#queue.then(() => this.#sink!.emit(observation));
  }
}

type ProjectedToolState = {
  readonly category: ExecutionToolCategory;
  status: string;
  label: string;
  summary: string;
  readonly toolName?: string;
  readonly detail?: ExecutionToolDetail;
  readonly quality: number;
  readonly parentActivityId?: string;
};

type DeferredTerminal = {
  readonly category: ExecutionToolCategory;
  readonly status: Exclude<ExecutionToolStatus, 'running'>;
  readonly label: string;
  readonly summary: string;
  readonly toolName: string;
  readonly quality: number;
};

type ChildTextState = {
  readonly activityId: string;
  readonly parentActivityId: string;
  readonly itemKind: 'assistant' | 'reasoning';
  sourceText: string;
  text: string;
  quarantined: boolean;
  emitted: boolean;
  status: ExecutionToolStatus;
};

type TextProjection =
  | { readonly kind: 'absent' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'visible'; readonly text: string; readonly redacted: boolean }
  | { readonly kind: 'blocked'; readonly reason: 'credential' };

function toolPresentation(
  call: PaseoToolCall,
  category: ExecutionToolCategory,
  executionCwd: string,
  sanitizeText: (value: string, max?: number, flush?: boolean) => string | null,
): {
  readonly label: string;
  readonly summary: string;
  readonly quality: number;
  readonly detail?: ExecutionToolDetail;
} {
  const fallback = categoryLabel(category);
  const detail = projectExecutionToolDetail(
    call.detail,
    executionCwd,
    sanitizeText,
    call.error,
  );
  const detailLabel = detail
    ? 'command' in detail
      ? detail.command
      : 'filePath' in detail
        ? detail.filePath
        : 'query' in detail
          ? detail.query
          : 'url' in detail
            ? detail.url
            : 'description' in detail
              ? detail.description
              : undefined
    : undefined;
  const titleProjection = projectText(call.title, 8000, [executionCwd], true);
  const providerTitle =
    titleProjection.kind === 'visible'
      ? flattenProviderTitle(titleProjection.text, 80)
      : null;
  const titleWasRedacted = titleProjection.kind === 'blocked';
  const quality = call.title !== undefined ? 2 : detail ? 1 : 0;
  return {
    label: providerTitle
      ? providerTitle
      : titleWasRedacted
        ? 'Tool title hidden by credential screening'
        : detailLabel
          ? (safeSingleLine(`${fallback}: ${detailLabel}`, 80, false) ?? fallback)
          : fallback,
    summary: toolSummary(category),
    quality,
    ...(detail ? { detail } : {}),
  };
}

function projectExecutionToolDetail(
  source: PaseoToolCall['detail'],
  executionCwd: string,
  sanitizeText: (value: string, max?: number, flush?: boolean) => string | null,
  failedError?: string,
): ExecutionToolDetail | undefined {
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
  if ('oldString' in source && source.oldString) putText('oldString', source.oldString);
  if ('newString' in source && source.newString) putText('newString', source.newString);
  if ('query' in source && source.query) putText('query', source.query);
  if ('toolName' in source && source.toolName) output.toolName = source.toolName;
  if ('filePaths' in source && Array.isArray(source.filePaths))
    output.filePaths = source.filePaths
      .slice(0, 64)
      .map((path) => workspaceRelativePath(executionCwd, path))
      .filter(Boolean);
  if ('webResults' in source && Array.isArray(source.webResults))
    output.webResults = source.webResults.slice(0, 64).map((item) => ({
      ...(item.title ? { title: sanitizeText(item.title, 8000, true) ?? undefined } : {}),
      ...(item.url ? { url: safeHttpUrl(item.url) ?? undefined } : {}),
    }));
  if ('annotations' in source && Array.isArray(source.annotations))
    output.annotations = source.annotations
      .slice(0, 64)
      .filter((annotation): annotation is string => typeof annotation === 'string')
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
  for (const key of ['output', 'result', 'prompt', 'codeText', 'log', 'unifiedDiff', 'error'])
    if (key in source)
      putText(key, (source as unknown as Record<string, unknown>)[key]);
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
  return output as ExecutionToolDetail;
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
  return { kind: 'visible', text: sanitized, redacted: redacted.redacted };
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
  for (const root of normalizedRoots) sanitized = sanitized.split(root).join('./');
  sanitized = sanitized
    .replace(/(?<![\w:./])\/(?!\/)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(
      /(?<![A-Za-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?![A-Za-z0-9])/giu,
      '<id>',
    );
  return sanitized.replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '<redacted>');
}

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
  return { text, redacted, blocked: containsCredentialMarker(text) };
}

const credentialAssignmentPattern =
  /(?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s,;]+)/i;
const credentialHeaderPattern =
  /(?:^|\s)(?:-u|--user|-H|--header|--auth|--authentication|--password|--secret|--token|--credential|--access[_-]?key|--session[_-]?key|--api[_-]?key|--private[_-]?key)(?:=|\s+)(?!\[REDACTED\])(?:"[^"]*"|'[^']*'|[^\s]+)/i;
const credentialBearerPattern =
  /\b(?:bearer|basic)\s+(?!\[REDACTED\])[A-Za-z0-9+/._~=-]+/i;
const credentialUrlPattern = /:\/\/(?!\[REDACTED\])[^/?#\s]+@/i;
const credentialPemPattern = /-----BEGIN [^-]+-----/i;

function containsCredentialMarker(value: string): boolean {
  return (
    credentialAssignmentPattern.test(value) ||
    credentialHeaderPattern.test(value) ||
    credentialBearerPattern.test(value) ||
    credentialUrlPattern.test(value) ||
    credentialPemPattern.test(value)
  );
}

function credentialPrefixPending(value: string): boolean {
  return /(?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*$/i.test(
    value,
  );
}

function mergeProjectedText(existing: string, incoming: string): string {
  const next = capDetail(incoming);
  if (!existing) return next;
  if (next.startsWith(existing)) return next;
  if (existing.endsWith(next)) return existing;
  return capDetail(existing + next);
}

function capDetail(value: string): string {
  return Array.from(
    value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ''),
  )
    .slice(0, 8000)
    .join('');
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

function flattenProviderTitle(value: string, maxCodePoints: number): string | null {
  const flattened = value.replace(/[\r\n\t ]+/gu, ' ').trim();
  if (!flattened) return null;
  return Array.from(flattened).slice(0, maxCodePoints).join('');
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
  const projected = relativePath
    .split('/')
    .map((part) => redactPathIdentifier(part))
    .join('/');
  return safeSingleLine(projected, 120, false);
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return safeSingleLine(`${parsed.origin}${parsed.pathname}`, 80, true);
  } catch {
    return null;
  }
}

function normalizeToolStatus(value: string): ExecutionToolStatus | null {
  const status = value.toLowerCase();
  if (['running', 'started', 'pending', 'in_progress'].includes(status)) return 'running';
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(status))
    return 'completed';
  if (['failed', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled', 'cancel'].includes(status)) return 'cancelled';
  return null;
}

function toolCategory(name: string, detailType?: string): ExecutionToolCategory {
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

function categoryLabel(category: ExecutionToolCategory): string {
  if (category === 'subagent') return 'Sub-agent task';
  return `${category.charAt(0).toUpperCase()}${category.slice(1)} activity`;
}

function toolSummary(category: ExecutionToolCategory): string {
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

function isTerminalToolStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function hasObservedToolResult(detail: ExecutionToolDetail | undefined): boolean {
  if (!detail) return false;
  return ['output', 'result', 'content', 'log', 'error'].some(
    (field) =>
      Object.prototype.hasOwnProperty.call(detail, field) &&
      (detail as unknown as Record<string, unknown>)[field] !== undefined,
  );
}
