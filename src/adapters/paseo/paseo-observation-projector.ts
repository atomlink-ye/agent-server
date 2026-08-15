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

type ToolProjection = {
  readonly activityId: string;
  readonly category: ExecutionToolCategory;
  readonly status: ExecutionToolStatus;
  readonly label: string;
  readonly summary: string;
  readonly toolName: string | undefined;
  readonly detail: ExecutionToolDetail | undefined;
  readonly quality: number;
  readonly parentActivityId: string | undefined;
};

type ChildTextProjection = {
  readonly activityId: string;
  readonly parentActivityId: string;
  readonly itemKind: 'assistant' | 'reasoning';
  sourceText: string;
  text: string;
  status: ExecutionToolStatus;
  quarantined: boolean;
  emitted: boolean;
};

/** Stateful reducer for one Paseo turn. */
export class PaseoObservationProjector {
  readonly #agentId: string;
  readonly #provider: string;
  readonly #executionCwd: string;
  readonly #roots: readonly string[];
  readonly #sink: ExecutionObservationSink | undefined;
  #baseline: PaseoTimelinePage | null = null;
  #queue: Promise<void> = Promise.resolve();
  #nextActivity = 1;
  #nextPermission = 1;
  #reasoningActive = false;
  #reasoningSourceText = '';
  #reasoningText = '';
  #reasoningQuarantined = false;
  #liveAssistant:
    | { readonly epoch: string; readonly seq: number; readonly text: string }
    | null = null;
  #assistantBlocked = false;
  #assistantLastPublicText = '';
  #assistantObserved = false;

  readonly #seenSequences = new Set<string>();
  readonly #emittedAssistant = new Map<string, string>();
  readonly #observedAssistantTexts = new Set<string>();
  readonly #parentCalls = new Map<string, string>();
  readonly #publishedParents = new Set<string>();
  readonly #tools = new Map<string, ToolProjection>();
  readonly #deferredParentTerminals = new Map<
    string,
    Omit<ToolProjection, 'activityId' | 'parentActivityId'>
  >();
  #deferParentTerminals = true;

  readonly #childSessionParent = new Map<string, string>();
  readonly #parentChildSession = new Map<string, string>();
  readonly #descriptorParent = new Map<string, string>();
  readonly #parentDescriptor = new Map<string, string>();
  readonly #descriptors = new Map<string, PaseoProviderSubagentDescriptor>();
  readonly #pendingDescriptors = new Map<
    string,
    PaseoProviderSubagentDescriptor
  >();
  readonly #conflictedDescriptors = new Set<string>();
  readonly #conflictedChildSessions = new Set<string>();
  readonly #baselineDescriptors = new Map<
    string,
    PaseoProviderSubagentDescriptor
  >();
  readonly #childToolCalls = new Map<string, string>();
  readonly #childSequences = new Set<string>();
  readonly #childText = new Map<string, ChildTextProjection>();
  readonly #childTextCurrent = new Map<
    string,
    {
      readonly itemKind: 'assistant' | 'reasoning';
      readonly timelineKey: string | undefined;
      readonly key: string;
    }
  >();
  readonly #childTextCounters = new Map<string, number>();
  readonly #permissions = new Map<
    string,
    {
      readonly activityId: string;
      readonly status: string;
      readonly decision: string | undefined;
    }
  >();

  public constructor(input: {
    readonly agentId: string;
    readonly provider: string;
    readonly executionCwd: string;
    readonly additionalRoots?: readonly string[] | undefined;
    readonly sink?: ExecutionObservationSink | undefined;
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
    this.#baselineDescriptors.clear();
    for (const descriptor of subagents)
      if (descriptor.parentAgentId === this.#agentId)
        this.#baselineDescriptors.set(descriptor.id, descriptor);
  }

  public emitTurnStarted(runId: string): void {
    this.#emit({ kind: 'turn_started', runId });
  }

  public isAfterBaseline(epoch: string | null, seq: number | null): boolean {
    if (epoch === null || seq === null) return false;
    return (
      this.#baseline === null ||
      this.#baseline.epoch !== epoch ||
      this.#baseline.endCursor === null ||
      seq > this.#baseline.endCursor.seq
    );
  }

  public consumeStreamEvent(event: PaseoAgentStreamEvent): void {
    if (event.agentId !== this.#agentId) return;
    if (!this.isAfterBaseline(event.epoch, event.seq)) return;
    if (event.reasoningText) this.#consumeReasoning(event.reasoningText);
    if (event.reasoning) this.#startReasoning();
    if (event.assistantText !== undefined || event.toolCall)
      this.#completeReasoning();
    if (event.toolCall) {
      this.#flushAssistant();
      this.#consumeParentTool(event.toolCall);
    }
    if (event.permission) this.#consumePermission(event.permission);
    if (
      event.timelineItemType === 'assistant_message' &&
      event.assistantText !== undefined &&
      event.epoch !== null &&
      event.seq !== null
    )
      this.#consumeAssistant(
        event.epoch,
        event.seq,
        event.assistantText,
        false,
      );
  }

  public consumeParentTimeline(page: PaseoTimelinePage): void {
    for (const entry of [...page.entries].sort((a, b) => a.seqEnd - b.seqEnd)) {
      if (!this.isAfterBaseline(page.epoch, entry.seqEnd)) continue;
      if (entry.reasoningText) this.#consumeReasoning(entry.reasoningText);
      if (entry.toolCall) {
        this.#completeReasoning();
        this.#flushAssistant();
        this.#consumeParentTool(entry.toolCall);
      }
      if (
        entry.timelineItemType === 'assistant_message' &&
        entry.assistantText !== undefined
      )
        this.#consumeAssistant(
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
    const descriptor = this.#descriptors.get(update.subagentId);
    if (!descriptor || !this.#descriptorParent.has(update.subagentId)) return;
    this.consumeChildTimeline(descriptor, {
      parentAgentId: update.parentAgentId,
      subagentId: update.subagentId,
      epoch: update.epoch,
      direction: 'tail',
      rows: [{ item: update.item, timestamp: update.timestamp, seq: update.seq }],
      hasOlder: false,
    });
  }

  public consumeProviderSubagentDescriptor(
    descriptor: PaseoProviderSubagentDescriptor,
  ): boolean {
    if (descriptor.parentAgentId !== this.#agentId) return false;
    if (
      this.#conflictedDescriptors.has(descriptor.id) ||
      this.#conflictedChildSessions.has(descriptor.id)
    )
      return false;
    const baseline = this.#baselineDescriptors.get(descriptor.id);
    if (
      baseline &&
      baseline.status === descriptor.status &&
      !this.#descriptors.has(descriptor.id)
    )
      return false;

    const parentActivityId = descriptor.toolCallId
      ? this.#parentCalls.get(descriptor.toolCallId)
      : this.#childSessionParent.get(descriptor.id);
    if (!parentActivityId || !this.#publishedParents.has(parentActivityId)) {
      this.#pendingDescriptors.set(descriptor.id, descriptor);
      return false;
    }
    if (!this.#bindDescriptor(descriptor.id, parentActivityId)) return false;
    this.#descriptors.set(descriptor.id, descriptor);
    this.#pendingDescriptors.delete(descriptor.id);

    const parent = this.#tools.get(parentActivityId);
    const safeTitle = sanitizeSingleLine(
      this.#sanitize(
        descriptor.title ?? descriptor.description ?? '',
        8000,
        true,
      ) ?? '',
      80,
    );
    if (parent && safeTitle)
      this.#publishTool({
        activityId: parentActivityId,
        category: parent.category,
        status: parent.status,
        label: `Sub-agent task: ${safeTitle}`,
        summary: parent.summary,
        toolName: parent.toolName,
        detail: parent.detail,
        quality: Math.max(parent.quality, 2),
        parentActivityId: undefined,
      });
    return true;
  }

  public hasProviderSubagent(descriptorId: string): boolean {
    return this.#descriptorParent.has(descriptorId);
  }

  public consumeChildTimeline(
    descriptor: PaseoProviderSubagentDescriptor,
    timeline: PaseoProviderSubagentTimeline,
  ): void {
    if (
      descriptor.parentAgentId !== this.#agentId ||
      timeline.parentAgentId !== this.#agentId ||
      timeline.subagentId !== descriptor.id ||
      !timeline.epoch
    )
      return;
    const parentActivityId = this.#descriptorParent.get(descriptor.id);
    if (!parentActivityId) return;
    for (const row of [...timeline.rows].sort((a, b) => a.seq - b.seq)) {
      const sequenceKey = `${descriptor.id}:${timeline.epoch}:${row.seq}`;
      if (this.#childSequences.has(sequenceKey)) continue;
      this.#childSequences.add(sequenceKey);
      if (row.item.toolCall) {
        this.#childTextCurrent.delete(descriptor.id);
        this.#publishToolCall(
          row.item.toolCall,
          `${descriptor.id}:${timeline.epoch}:${row.item.toolCall.callId}`,
          parentActivityId,
        );
        continue;
      }
      const itemKind = row.item.assistantText
        ? 'assistant'
        : row.item.reasoningText
          ? 'reasoning'
          : null;
      if (!itemKind) continue;
      const text = row.item.assistantText ?? row.item.reasoningText ?? '';
      const current = this.#childTextCurrent.get(descriptor.id);
      const sameSegment =
        current?.itemKind === itemKind &&
        (!row.item.timelineKey ||
          !current.timelineKey ||
          row.item.timelineKey === current.timelineKey);
      let segment = sameSegment ? current : undefined;
      if (!segment) {
        const counter = (this.#childTextCounters.get(descriptor.id) ?? 0) + 1;
        this.#childTextCounters.set(descriptor.id, counter);
        segment = {
          itemKind,
          timelineKey: row.item.timelineKey,
          key: `${descriptor.id}:${itemKind}:${counter}`,
        };
        this.#childTextCurrent.set(descriptor.id, segment);
      }
      this.#consumeChildText(parentActivityId, segment.key, itemKind, text);
    }
  }

  public finalizeProviderSubagent(
    descriptor: PaseoProviderSubagentDescriptor,
  ): void {
    const parentActivityId = this.#descriptorParent.get(descriptor.id);
    if (!parentActivityId || descriptor.status === 'running') return;
    const terminal: ExecutionToolStatus =
      descriptor.status === 'completed'
        ? 'completed'
        : descriptor.status === 'failed'
          ? 'failed'
          : 'cancelled';
    for (const child of this.#childText.values()) {
      if (child.parentActivityId !== parentActivityId || child.status !== 'running')
        continue;
      const finalText = child.quarantined
        ? child.text
        : (this.#sanitize(child.sourceText, 8000, true) ?? child.text);
      if (finalText || child.emitted)
        this.#emit({
          kind: 'child_activity_updated',
          activityId: child.activityId,
          parentActivityId,
          itemKind: child.itemKind,
          status: terminal,
          label: child.itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
          summary:
            sanitizeSingleLine(finalText, 160) ??
            (child.itemKind === 'assistant' ? 'Assistant' : 'Thinking'),
          provider: this.#provider,
          ...(finalText ? { text: finalText } : {}),
        });
      child.text = finalText;
      child.status = terminal;
    }
    const parent = this.#tools.get(parentActivityId);
    if (parent)
      this.#publishTool({
        ...parent,
        status: terminal,
        parentActivityId: undefined,
      });
  }

  public async finalize(input: {
    readonly finalTimeline?: PaseoTimelinePage;
    readonly finalMessage?: string | null;
    readonly usage?: RunUsage;
  } = {}): Promise<void> {
    if (input.finalTimeline) {
      this.#flushAssistant();
      this.consumeParentTimeline(input.finalTimeline);
      if (
        !this.#assistantObserved &&
        input.finalMessage &&
        !this.#observedAssistantTexts.has(input.finalMessage) &&
        input.finalTimeline.endCursor
      )
        this.#consumeAssistant(
          input.finalTimeline.epoch,
          input.finalTimeline.endCursor.seq,
          input.finalMessage,
          true,
        );
    }
    this.#flushAssistant();
    this.#flushDeferredParentTerminals();
    this.#completeReasoning();
    if (input.usage) this.#emit({ kind: 'usage_updated', usage: input.usage });
    await this.drain();
  }

  public async drain(): Promise<void> {
    await this.#queue;
  }

  #consumeAssistant(
    epoch: string,
    seq: number,
    incoming: string,
    flush: boolean,
  ): void {
    if (!this.isAfterBaseline(epoch, seq)) return;
    this.#observedAssistantTexts.add(incoming);
    const sequenceKey = `${epoch}:${seq}`;
    if (this.#seenSequences.has(sequenceKey)) return;
    if (!this.#liveAssistant || this.#liveAssistant.epoch !== epoch) {
      this.#flushAssistant();
      this.#assistantBlocked = false;
      this.#assistantLastPublicText = '';
      this.#assistantObserved = false;
      this.#liveAssistant = { epoch, seq, text: incoming };
    } else if (seq <= this.#liveAssistant.seq) {
      return;
    } else {
      this.#liveAssistant = {
        epoch,
        seq,
        text: mergeText(this.#liveAssistant.text, incoming),
      };
    }
    this.#seenSequences.add(sequenceKey);
    this.#assistantObserved = true;
    this.#publishAssistant(
      epoch,
      seq,
      this.#liveAssistant.text,
      flush || !credentialPrefixPending(this.#liveAssistant.text),
    );
  }

  #publishAssistant(
    epoch: string,
    seq: number,
    text: string,
    flush: boolean,
  ): void {
    const projected = projectText(text, 8000, this.#roots, flush);
    if (projected.kind === 'blocked') {
      if (this.#assistantBlocked) return;
      this.#assistantBlocked = true;
      const safe = this.#assistantLastPublicText
        ? `${this.#assistantLastPublicText}\n\n[Content redacted by credential screening]`
        : '[Content redacted by credential screening]';
      const key = `${epoch}:${seq}`;
      if (this.#emittedAssistant.get(key) === safe) return;
      this.#emittedAssistant.set(key, safe);
      this.#assistantLastPublicText = safe;
      this.#emit({ kind: 'assistant_updated', text: safe });
      return;
    }
    if (projected.kind !== 'visible') return;
    const key = `${epoch}:${seq}`;
    if (this.#emittedAssistant.get(key) === projected.text) return;
    this.#emittedAssistant.set(key, projected.text);
    this.#assistantLastPublicText = projected.text;
    this.#emit({ kind: 'assistant_updated', text: projected.text });
  }

  #flushAssistant(): void {
    if (!this.#liveAssistant) return;
    this.#publishAssistant(
      this.#liveAssistant.epoch,
      this.#liveAssistant.seq,
      this.#liveAssistant.text,
      true,
    );
    this.#liveAssistant = null;
  }

  #consumeReasoning(incoming: string): void {
    if (this.#reasoningQuarantined) return;
    this.#reasoningSourceText = mergeText(this.#reasoningSourceText, incoming);
    const safe = this.#sanitize(this.#reasoningSourceText, 8000, false);
    if (safe === null) {
      this.#reasoningQuarantined = true;
      this.#reasoningText = '';
      return;
    }
    this.#reasoningActive = true;
    if (safe !== this.#reasoningText) {
      this.#reasoningText = safe;
      this.#emit({
        kind: 'reasoning_updated',
        status: 'started',
        ...(safe ? { text: safe } : {}),
      });
    }
  }

  #startReasoning(): void {
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
    const safe = this.#reasoningQuarantined
      ? null
      : this.#sanitize(this.#reasoningSourceText, 8000, true);
    this.#emit({
      kind: 'reasoning_updated',
      status: 'completed',
      ...(safe ? { text: safe } : {}),
    });
    this.#reasoningActive = false;
    this.#reasoningSourceText = '';
    this.#reasoningText = '';
    this.#reasoningQuarantined = false;
  }

  #consumeParentTool(call: PaseoToolCall): void {
    const activityId = this.#publishToolCall(call, `parent:${call.callId}`);
    if (!activityId) return;
    if (this.#publishedParents.has(activityId))
      for (const pending of [...this.#pendingDescriptors.values()])
        if (pending.toolCallId === call.callId)
          this.consumeProviderSubagentDescriptor(pending);
  }

  #publishToolCall(
    call: PaseoToolCall,
    key: string,
    parentActivityId?: string,
  ): string | null {
    const status = normalizeToolStatus(call.status);
    if (!status) return null;
    const map = parentActivityId ? this.#childToolCalls : this.#parentCalls;
    const callKey = parentActivityId ? key : call.callId;
    const activityId = map.get(callKey) ?? this.#allocateActivity();
    map.set(callKey, activityId);
    const category = toolCategory(call.name, call.detail?.type);
    const detail = projectToolDetail(
      call.detail,
      this.#executionCwd,
      (value, max = 8000, flush = true) => this.#sanitize(value, max, flush),
      call.error,
    );
    const title = this.#sanitize(call.title ?? '', 8000, true);
    const label =
      sanitizeSingleLine(title ?? '', 80) ??
      detailLabel(category, detail) ??
      categoryLabel(category);
    const projection: ToolProjection = {
      activityId,
      category,
      status,
      label,
      summary: `${categoryLabel(category)}.`,
      toolName: call.name,
      detail,
      quality: call.title ? 2 : detail ? 1 : 0,
      parentActivityId,
    };
    if (
      this.#deferParentTerminals &&
      parentActivityId === undefined &&
      category === 'subagent' &&
      status !== 'running'
    ) {
      if (!this.#tools.has(activityId))
        this.#publishTool({ ...projection, status: 'running' });
      this.#deferredParentTerminals.set(activityId, {
        category,
        status,
        label,
        summary: projection.summary,
        toolName: call.name,
        detail,
        quality: projection.quality,
      });
    } else {
      this.#publishTool(projection, call.resultObserved);
    }
    if (parentActivityId === undefined && this.#tools.has(activityId)) {
      this.#publishedParents.add(activityId);
      const childSessionId =
        call.childSessionId ??
        (call.detail?.type === 'sub_agent'
          ? call.detail.childSessionId
          : undefined);
      if (childSessionId)
        this.#bindChildSession(childSessionId, activityId);
    }
    return activityId;
  }

  #publishTool(projection: ToolProjection, resultObserved?: boolean): void {
    const previous = this.#tools.get(projection.activityId);
    if (previous && isTerminal(previous.status)) {
      if (projection.status !== previous.status) return;
      if (projection.quality <= previous.quality && !betterDetail(projection, previous))
        return;
    }
    if (
      previous &&
      previous.status === projection.status &&
      previous.quality >= projection.quality &&
      !betterDetail(projection, previous)
    )
      return;
    const next: ToolProjection = {
      activityId: projection.activityId,
      category: projection.category,
      status: projection.status,
      label:
        previous && previous.quality > projection.quality
          ? previous.label
          : projection.label,
      summary:
        previous && previous.quality > projection.quality
          ? previous.summary
          : projection.summary,
      toolName: projection.toolName ?? previous?.toolName,
      detail:
        betterDetail(projection, previous) || !previous
          ? projection.detail
          : previous.detail,
      quality: Math.max(previous?.quality ?? 0, projection.quality),
      parentActivityId: projection.parentActivityId,
    };
    this.#tools.set(next.activityId, next);
    if (next.parentActivityId)
      this.#emit({
        kind: 'child_activity_updated',
        activityId: next.activityId,
        parentActivityId: next.parentActivityId,
        itemKind: 'tool',
        status: next.status,
        label: next.label,
        summary: next.summary,
        provider: this.#provider,
        ...(next.detail ? { detail: next.detail } : {}),
      });
    else
      this.#emit({
        kind: 'tool_updated',
        activityId: next.activityId,
        category: next.category,
        status: next.status,
        label: next.label,
        summary: next.summary,
        provider: this.#provider,
        toolName: next.toolName,
        detail: next.detail,
        resultObserved: resultObserved ?? hasObservedResult(next.detail),
      });
  }

  #flushDeferredParentTerminals(): void {
    this.#deferParentTerminals = false;
    for (const [activityId, terminal] of this.#deferredParentTerminals) {
      const previous = this.#tools.get(activityId);
      this.#publishTool({
        activityId,
        category: terminal.category,
        status: terminal.status,
        label: previous?.label ?? terminal.label,
        summary: previous?.summary ?? terminal.summary,
        toolName: previous?.toolName ?? terminal.toolName,
        detail: previous?.detail ?? terminal.detail,
        quality: Math.max(previous?.quality ?? 0, terminal.quality),
        parentActivityId: undefined,
      });
    }
    this.#deferredParentTerminals.clear();
  }

  #consumePermission(permission: NonNullable<PaseoAgentStreamEvent['permission']>): void {
    const previous = this.#permissions.get(permission.requestId);
    if (previous?.status === 'resolved') return;
    if (
      previous?.status === permission.status &&
      previous.decision === permission.decision
    )
      return;
    const activityId = previous?.activityId ?? `permission-${this.#nextPermission++}`;
    this.#permissions.set(permission.requestId, {
      activityId,
      status: permission.status,
      decision: permission.decision,
    });
    this.#emit({
      kind: 'permission_updated',
      activityId,
      category: permissionCategory(permission.kind),
      status: permission.status,
      decision: permission.decision,
      summary: 'Permission activity is read-only.',
    });
  }

  #consumeChildText(
    parentActivityId: string,
    key: string,
    itemKind: 'assistant' | 'reasoning',
    incoming: string,
  ): void {
    const previous = this.#childText.get(key);
    if (previous && (previous.status !== 'running' || previous.quarantined)) return;
    const sourceText = mergeText(previous?.sourceText ?? '', incoming);
    const safe = this.#sanitize(sourceText, 8000, false);
    const activityId = previous?.activityId ?? this.#allocateActivity();
    if (safe === null) {
      this.#childText.set(key, {
        activityId,
        parentActivityId,
        itemKind,
        sourceText,
        text: previous?.text ?? '',
        status: 'running',
        quarantined: true,
        emitted: previous?.emitted ?? false,
      });
      return;
    }
    this.#childText.set(key, {
      activityId,
      parentActivityId,
      itemKind,
      sourceText,
      text: safe,
      status: 'running',
      quarantined: false,
      emitted: Boolean(safe),
    });
    if (safe)
      this.#emit({
        kind: 'child_activity_updated',
        activityId,
        parentActivityId,
        itemKind,
        status: 'running',
        label: itemKind === 'assistant' ? 'Assistant' : 'Reasoning',
        summary:
          sanitizeSingleLine(safe, 160) ??
          (itemKind === 'assistant' ? 'Assistant' : 'Thinking'),
        text: safe,
        provider: this.#provider,
      });
  }

  #bindChildSession(childSessionId: string, parentActivityId: string): void {
    if (this.#conflictedChildSessions.has(childSessionId)) return;
    const existingParent = this.#childSessionParent.get(childSessionId);
    const existingChild = this.#parentChildSession.get(parentActivityId);
    if (
      (existingParent && existingParent !== parentActivityId) ||
      (existingChild && existingChild !== childSessionId)
    ) {
      this.#quarantineDescriptor(childSessionId);
      if (existingChild) this.#quarantineDescriptor(existingChild);
      return;
    }
    this.#childSessionParent.set(childSessionId, parentActivityId);
    this.#parentChildSession.set(parentActivityId, childSessionId);
    const pending = this.#pendingDescriptors.get(childSessionId);
    if (pending) this.consumeProviderSubagentDescriptor(pending);
  }

  #bindDescriptor(descriptorId: string, parentActivityId: string): boolean {
    const oldParent = this.#descriptorParent.get(descriptorId);
    const oldDescriptor = this.#parentDescriptor.get(parentActivityId);
    const childParent = this.#childSessionParent.get(descriptorId);
    const parentChild = this.#parentChildSession.get(parentActivityId);
    if (
      (oldParent && oldParent !== parentActivityId) ||
      (oldDescriptor && oldDescriptor !== descriptorId) ||
      (childParent && childParent !== parentActivityId) ||
      (parentChild && parentChild !== descriptorId)
    ) {
      this.#quarantineDescriptor(descriptorId);
      if (oldDescriptor) this.#quarantineDescriptor(oldDescriptor);
      return false;
    }
    this.#descriptorParent.set(descriptorId, parentActivityId);
    this.#parentDescriptor.set(parentActivityId, descriptorId);
    this.#childSessionParent.set(descriptorId, parentActivityId);
    this.#parentChildSession.set(parentActivityId, descriptorId);
    return true;
  }

  #quarantineDescriptor(descriptorId: string): void {
    this.#conflictedDescriptors.add(descriptorId);
    this.#conflictedChildSessions.add(descriptorId);
    const parent = this.#descriptorParent.get(descriptorId);
    if (parent) {
      this.#parentDescriptor.delete(parent);
      this.#parentChildSession.delete(parent);
    }
    this.#descriptorParent.delete(descriptorId);
    this.#childSessionParent.delete(descriptorId);
    this.#descriptors.delete(descriptorId);
    this.#pendingDescriptors.delete(descriptorId);
  }

  #allocateActivity(): string {
    return `activity-${this.#nextActivity++}`;
  }

  #sanitize(value: string, max: number, flush: boolean): string | null {
    const result = projectText(value, max, this.#roots, flush);
    return result.kind === 'visible' ? result.text : null;
  }

  #emit(observation: ExecutionObservation): void {
    if (!this.#sink) return;
    this.#queue = this.#queue.then(async () => {
      await this.#sink!.emit(observation);
    });
  }
}

function betterDetail(
  next: ToolProjection,
  previous: ToolProjection | undefined,
): boolean {
  if (!next.detail) return false;
  if (!previous?.detail) return true;
  return JSON.stringify(next.detail).length > JSON.stringify(previous.detail).length;
}

function isTerminal(status: ExecutionToolStatus): boolean {
  return status !== 'running';
}

function normalizeToolStatus(value: string): ExecutionToolStatus | null {
  const status = value.toLowerCase();
  if (['running', 'started', 'pending', 'in_progress'].includes(status))
    return 'running';
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(status))
    return 'completed';
  if (['failed', 'error'].includes(status)) return 'failed';
  if (['cancelled', 'canceled', 'cancel'].includes(status)) return 'cancelled';
  return null;
}

function toolCategory(name: string, detailType?: string): ExecutionToolCategory {
  const value = `${name} ${detailType ?? ''}`.toLowerCase();
  if (/(shell|command|terminal|exec)/u.test(value)) return 'shell';
  if (/(read|cat|list|glob|file)/u.test(value)) return 'read';
  if (/(edit|patch|replace)/u.test(value)) return 'edit';
  if (/(write|create|save)/u.test(value)) return 'write';
  if (/(search|grep|find)/u.test(value)) return 'search';
  if (/(fetch|http|url|web)/u.test(value)) return 'fetch';
  if (/(agent|delegate|task)/u.test(value)) return 'subagent';
  return 'other';
}

function categoryLabel(category: ExecutionToolCategory): string {
  if (category === 'subagent') return 'Sub-agent task';
  return `${category.charAt(0).toUpperCase()}${category.slice(1)} activity`;
}

function detailLabel(
  category: ExecutionToolCategory,
  detail: ExecutionToolDetail | undefined,
): string | null {
  if (!detail) return null;
  let value: string | undefined;
  if ('command' in detail) value = detail.command;
  else if ('filePath' in detail) value = detail.filePath;
  else if ('query' in detail) value = detail.query;
  else if ('url' in detail) value = detail.url;
  else if ('description' in detail) value = detail.description;
  if (!value) return null;
  return sanitizeSingleLine(`${categoryLabel(category)}: ${value}`, 80);
}

function permissionCategory(
  kind: string | undefined,
): 'tool' | 'plan' | 'question' | 'mode' | 'other' {
  const value = (kind ?? '').toLowerCase();
  if (value.includes('tool')) return 'tool';
  if (value.includes('plan')) return 'plan';
  if (value.includes('question')) return 'question';
  if (value.includes('mode')) return 'mode';
  return 'other';
}

function projectToolDetail(
  source: PaseoToolCall['detail'],
  executionCwd: string,
  sanitizeText: (value: string, max?: number, flush?: boolean) => string | null,
  failedError: string | undefined,
): ExecutionToolDetail | undefined {
  if (!source) return undefined;
  const kind = source.type === 'sub_agent' ? 'subagent' : source.type;
  const output: Record<string, unknown> = { kind };
  const putText = (key: string, value: unknown): void => {
    if (typeof value !== 'string') return;
    const safe = sanitizeText(value, 8000, true);
    if (safe !== null) output[key] = safe;
  };
  if ('command' in source) putText('command', source.command);
  if ('cwd' in source) putText('cwd', source.cwd);
  if ('filePath' in source && source.filePath) {
    const safePath = workspaceRelativePath(executionCwd, source.filePath);
    if (safePath && !containsCredential(safePath)) output.filePath = safePath;
  }
  for (const key of [
    'content',
    'oldString',
    'newString',
    'query',
    'output',
    'result',
    'prompt',
    'codeText',
    'log',
    'unifiedDiff',
    'error',
    'subAgentType',
    'description',
  ])
    if (key in source)
      putText(key, (source as unknown as Record<string, unknown>)[key]);
  if ('toolName' in source && source.toolName) output.toolName = source.toolName;
  if ('url' in source && source.url) {
    const safeUrl = safeHttpUrl(source.url);
    if (safeUrl) output.url = safeUrl;
  }
  if ('filePaths' in source && Array.isArray(source.filePaths))
    output.filePaths = source.filePaths
      .slice(0, 64)
      .map((value) => workspaceRelativePath(executionCwd, value))
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
      .filter((value): value is string => typeof value === 'string')
      .map((value) => sanitizeText(value, 8000, true))
      .filter((value): value is string => value !== null);
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
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  if ('truncated' in source && typeof source.truncated === 'boolean')
    output.truncated = source.truncated;
  if ('mode' in source && source.mode) output.mode = source.mode;
  if ('exitCode' in source && (source.exitCode === null || Number.isSafeInteger(source.exitCode)))
    output.exitCode = source.exitCode;
  if ('actions' in source && Array.isArray(source.actions))
    output.actions = source.actions.slice(0, 64).map((action) => ({
      ...(typeof action.index === 'number' ? { index: action.index } : {}),
      ...(typeof action.toolName === 'string'
        ? { toolName: sanitizeText(action.toolName, 8000, true) ?? undefined }
        : {}),
      ...(typeof action.summary === 'string'
        ? { summary: sanitizeText(action.summary, 8000, true) ?? undefined }
        : {}),
    }));
  if (failedError) putText('error', failedError);
  return output as ExecutionToolDetail;
}

function hasObservedResult(detail: ExecutionToolDetail | undefined): boolean {
  if (!detail) return false;
  const row = detail as unknown as Record<string, unknown>;
  return ['output', 'result', 'content', 'log', 'error'].some(
    (key) => row[key] !== undefined,
  );
}

type TextProjection =
  | { readonly kind: 'empty' | 'pending' | 'blocked' }
  | { readonly kind: 'visible'; readonly text: string };

function projectText(
  value: string,
  max: number,
  roots: readonly string[],
  flush: boolean,
): TextProjection {
  if (!value.trim()) return { kind: 'empty' };
  const redacted = redactCredentials(value);
  if (redacted.blocked) return { kind: 'blocked' };
  if (!flush && credentialPrefixPending(value)) return { kind: 'pending' };
  let safe = formatProjectedText(redacted.text, roots);
  safe = Array.from(safe).slice(0, max).join('');
  if (!flush) {
    const committedEnd = Math.max(0, safe.length - 512);
    if (committedEnd === 0) return { kind: 'pending' };
    safe = safe.slice(0, committedEnd);
  }
  return safe.trim() ? { kind: 'visible', text: safe } : { kind: 'empty' };
}

function redactCredentials(value: string): {
  readonly text: string;
  readonly blocked: boolean;
} {
  let text = value;
  const replace = (pattern: RegExp, replacement: string): void => {
    text = text.replace(pattern, replacement);
  };
  replace(
    /((?:^|[^\w])(?:"|')?(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|SESSION_KEY|PRIVATE_KEY))(?:"|')?\s*[:=]\s*)(?:(?:bearer|basic)\s+[^\s,;]+|"[^"]*"|'[^']*'|[^\s,;]+)/giu,
    '$1[REDACTED]',
  );
  replace(/(\b(?:bearer|basic)\s+)[A-Za-z0-9+/._~=-]+/giu, '$1[REDACTED]');
  replace(/((?:https?|ftp):\/\/)[^/?#\s]+@/giu, '$1[REDACTED]@');
  replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/giu, '[REDACTED]');
  return { text, blocked: containsCredential(text) };
}

function containsCredential(value: string): boolean {
  return (
    /(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key)\s*[:=]\s*(?!\[REDACTED\])[^\s,;]+/iu.test(
      value,
    ) ||
    /\b(?:bearer|basic)\s+(?!\[REDACTED\])[A-Za-z0-9+/._~=-]+/iu.test(value) ||
    /-----BEGIN [^-]+-----/iu.test(value)
  );
}

function credentialPrefixPending(value: string): boolean {
  return /(?:authorization|cookie|password|secret|token|credential|access[_-]?key|session[_-]?key|api[_-]?key|private[ _-]?key)\s*[:=]\s*$/iu.test(
    value,
  );
}

function formatProjectedText(value: string, roots: readonly string[]): string {
  let safe = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const normalizedRoots = roots
    .map((root) => resolve(root).replaceAll('\\', '/').replace(/\/$/u, ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const root of normalizedRoots) safe = safe.split(root).join('./');
  safe = safe
    .replace(/\/workspace\/\.local\/runtime-cells\/[A-Za-z0-9_-]+\/?/gu, './')
    .replace(/(?<![\w:./])\/(?!\/)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>()[\]{}]+/gu, '<path>')
    .replace(
      /(?<![A-Za-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?![A-Za-z0-9])/giu,
      '<id>',
    );
  return safe;
}

function mergeText(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.endsWith(incoming)) return existing;
  return `${existing}${incoming}`;
}

function sanitizeSingleLine(value: string, max: number): string | null {
  const normalized = value
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\r\n\t ]+/gu, ' ')
    .trim();
  if (!normalized || containsCredential(normalized)) return null;
  return Array.from(normalized).slice(0, max).join('');
}

function workspaceRelativePath(cwd: string, value: string): string | null {
  if (!value || value.length > 4096) return null;
  const absolute = resolve(cwd, value);
  const path = relative(resolve(cwd), absolute).replaceAll('\\', '/');
  if (!path || path === '..' || path.startsWith('../')) return null;
  const safe = path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
    '<id>',
  );
  return sanitizeSingleLine(safe, 120);
}

function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return sanitizeSingleLine(`${parsed.origin}${parsed.pathname}`, 160);
  } catch {
    return null;
  }
}
