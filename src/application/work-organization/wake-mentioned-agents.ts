import { USER_PRINCIPAL_TYPE } from '../../domain/access-context.js';
import {
  workItemMentionBrief,
  type WorkItemMentionReason,
} from '../../domain/work-organization/work-item-mention-brief.js';
import type { Logger } from '../../shared/observability/logger.js';
import { enqueueChatDispatchForMessage } from '../chat/enqueue-chat-dispatch.js';
import type { ChatDispatchRepository } from '../ports/chat-dispatch-repository.js';
import type { ConversationRepository } from '../ports/conversation-repository.js';
import {
  decideWakeLoopGuard,
  type WakeLoopGuardOptions,
  type WakeLoopGuardRepository,
} from './wake-loop-guard.js';

/**
 * A Coworker identity an @-token is allowed to name.
 *
 * Only agents appear here. A mention of a human is not a wake: humans read the
 * WorkItem in the UI, and delivering a chat turn to a person's own conversation
 * on their behalf would be putting words in their mouth.
 */
export interface MentionableAgent {
  readonly id: string;
  readonly displayName: string;
  readonly normalizedName: string;
  /** Ordinary mentions require this roster availability flag; assignments re-check runtime status. */
  readonly runtimeAvailable: boolean;
}

/** The tenant Coworker roster, read at write time. */
export interface MentionableAgentRoster {
  listMentionableAgents(input: {
    readonly tenantId: string;
  }): Promise<readonly MentionableAgent[]>;
}

export interface WakeMentionedAgentsDependencies {
  readonly roster: MentionableAgentRoster;
  readonly conversations: Pick<
    ConversationRepository,
    'findOrCreateDirect' | 'appendMessage' | 'getUnread' | 'getChatRuntime'
  >;
  readonly dispatches: Pick<ChatDispatchRepository, 'enqueue'>;
  /** Overrides the enqueue burst-debounce default; pass the configured value. */
  readonly debounceMs?: number;
  readonly logger?: Logger;
  /**
   * Cross-turn loop breaker. Absent means unguarded — every mention wakes,
   * exactly as before this existed. See wake-loop-guard.ts.
   */
  readonly wakeLoopGuard?: WakeLoopGuardRepository;
  readonly wakeLoopGuardOptions?: WakeLoopGuardOptions;
}

export interface WakeMentionedAgentsInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly mentions: readonly string[];
  /** Who caused the wake; never woken about their own mention. */
  readonly actorId: string;
  readonly actorType: string;
  /** How the actor should be named in the brief; defaults to the actor id. */
  readonly actorLabel?: string;
  readonly reason?: WorkItemMentionReason;
  readonly quote?: string;
  readonly workItem: {
    readonly id: string;
    readonly title: string;
    readonly description?: string | null;
    readonly boardId?: string;
    readonly columnId?: string;
  };
}

export interface WakeMentionedAgentsResult {
  /** Agent definition ids whose durable dispatch was admitted. */
  readonly woken: readonly string[];
  /** Mentions that named nobody wakeable — a human, a stranger, or the actor. */
  readonly skipped: readonly string[];
}

/**
 * THE chokepoint. Every path that can name an agent on a WorkItem — create,
 * update, comment, direct assignment — funnels here, so there is exactly one
 * place that decides what a mention does.
 *
 * It is best-effort by construction: a WorkItem mutation is the user's durable
 * intent and must never be rolled back because an agent's runtime happened to be
 * down. Every failure is logged and swallowed per mention, so one unreachable
 * Coworker cannot stop the others from being woken.
 *
 * The wake itself reuses the ordinary chat path — append a principal-authored
 * message to the direct conversation, then enqueue a chat dispatch — rather than
 * a side channel. See the mention-wake note in CONTRACT.md for why an
 * agent-authored append cannot work here.
 */
export async function wakeMentionedAgents(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
): Promise<WakeMentionedAgentsResult> {
  const mentions = dedupe(input.mentions);
  const baseAttributes = {
    tenant_id: input.tenantId,
    work_item_id: input.workItem.id,
    reason: input.reason ?? 'mention',
  };
  dependencies.logger?.log('info', 'work_item.mention.wake.started', {
    ...baseAttributes,
    mention_count: mentions.length,
  });
  if (mentions.length === 0) {
    dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
      ...baseAttributes,
      reason: 'empty_mentions',
    });
    dependencies.logger?.log('warn', 'work_item.mention.wake.completed', {
      ...baseAttributes,
      woken_count: 0,
      skipped_count: 0,
      reason: 'empty_mentions',
    });
    return { woken: [], skipped: [] };
  }

  if (await isWakeLoopCapped(dependencies, input)) {
    const result = Object.freeze({
      woken: Object.freeze([]),
      skipped: Object.freeze([...mentions]),
    });
    dependencies.logger?.log('warn', 'work_item.mention.wake.completed', {
      ...baseAttributes,
      woken_count: 0,
      skipped_count: mentions.length,
      reason: 'guard_blocked',
    });
    return result;
  }

  const rosterResult = await listRoster(dependencies, input);
  const roster = rosterResult.agents;
  const woken: string[] = [];
  const skipped: string[] = [];

  for (const mention of mentions) {
    const agent =
      input.reason === 'assignment'
        ? resolveAgentById(roster, mention)
        : resolveAgent(roster, mention);
    if (!agent) {
      dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
        ...baseAttributes,
        reason: rosterResult.failed
          ? 'roster_unavailable'
          : 'no_matching_agent',
      });
      skipped.push(mention);
      continue;
    }
    dependencies.logger?.log('info', 'work_item.mention.resolved', {
      ...baseAttributes,
      agent_definition_id: agent.id,
      reason: 'resolved',
    });
    if (agent.id === input.actorId) {
      dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
        ...baseAttributes,
        agent_definition_id: agent.id,
        reason: 'self_mention',
      });
      skipped.push(mention);
      continue;
    }
    const delivered = await wakeOne(dependencies, input, agent);
    (delivered ? woken : skipped).push(delivered ? agent.id : mention);
  }
  const result = Object.freeze({
    woken: Object.freeze(woken),
    skipped: Object.freeze(skipped),
  });
  dependencies.logger?.log(
    skipped.length > 0 ? 'warn' : 'info',
    'work_item.mention.wake.completed',
    {
      ...baseAttributes,
      woken_count: woken.length,
      skipped_count: skipped.length,
      reason:
        skipped.length === 0
          ? 'dispatch_admitted'
          : woken.length === 0
            ? 'all_skipped'
            : 'partial_skip',
    },
  );
  return result;
}

async function listRoster(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
): Promise<{
  readonly agents: readonly MentionableAgent[];
  readonly failed: boolean;
}> {
  dependencies.logger?.log('info', 'work_item.mention.roster.started', {
    tenant_id: input.tenantId,
    work_item_id: input.workItem.id,
    reason: 'resolve_mentions',
  });
  try {
    const roster = await dependencies.roster.listMentionableAgents({
      tenantId: input.tenantId,
    });
    dependencies.logger?.log('info', 'work_item.mention.roster.completed', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      reason: 'roster_loaded',
      agent_count: roster.length,
    });
    return { agents: roster, failed: false };
  } catch (error) {
    // No roster means no wake. It does not mean no WorkItem.
    dependencies.logger?.log('warn', 'work_item.mention.roster_unavailable', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      reason: 'roster_unavailable',
      error_name: errorReason(error),
      agent_count: 0,
      failure_count: 1,
    });
    return { agents: [], failed: true };
  }
}

/**
 * One counter observation per wake event (not per resolved mention): the
 * question is "has this WorkItem's mutation stream been looping", which is a
 * property of the event, not of any one mention inside it.
 *
 * Fails closed on a repository error, mirroring listRoster above: when the
 * guard cannot be consulted, the safer default for a loop breaker is not to
 * wake rather than to wake unconditionally.
 */
async function isWakeLoopCapped(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
): Promise<boolean> {
  if (!dependencies.wakeLoopGuard) {
    dependencies.logger?.log('info', 'work_item.mention.wake_loop_guard', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      decision: 'allow',
      reason: 'guard_disabled',
    });
    return false;
  }
  try {
    dependencies.logger?.log(
      'info',
      'work_item.mention.wake_loop_guard.started',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        reason: 'observe_guard',
      },
    );
    const state = await dependencies.wakeLoopGuard!.observeWake({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      workItemId: input.workItem.id,
      causedByHuman: input.actorType === USER_PRINCIPAL_TYPE,
    });
    const decision = decideWakeLoopGuard(
      state,
      dependencies.wakeLoopGuardOptions,
    );
    if (decision.kind === 'block') {
      dependencies.logger?.log('warn', 'work_item.mention.wake_loop_capped', {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        decision: 'block',
        reason: decision.reason,
        agent_wake_count: decision.agentWakeCount,
        hard_cap: decision.hardCap,
      });
      dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        reason: 'hard_loop_cap',
      });
      return true;
    }
    dependencies.logger?.log('info', 'work_item.mention.wake_loop_guard', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      decision: 'allow',
      reason: 'guard_allow',
      agent_wake_count: state.agentWakeCount,
    });
    return false;
  } catch (error) {
    dependencies.logger?.log(
      'warn',
      'work_item.mention.wake_loop_guard_unavailable',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        decision: 'error',
        reason: 'guard_error',
        error_name: errorReason(error),
      },
    );
    dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      reason: 'guard_error',
    });
    return true;
  }
}

async function wakeOne(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
  agent: MentionableAgent,
): Promise<boolean> {
  let stage = 'runtime_check';
  try {
    if (input.reason !== 'assignment' && !agent.runtimeAvailable) {
      dependencies.logger?.log(
        'warn',
        'work_item.mention.runtime_unavailable',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
          runtime_available: agent.runtimeAvailable,
          runtime_status: null,
          reason: 'roster_runtime_unavailable',
        },
      );
      return false;
    }
    stage = 'runtime_lookup';
    dependencies.logger?.log(
      'info',
      'work_item.mention.runtime_lookup.started',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        reason: 'get_runtime',
      },
    );
    const runtime = await dependencies.conversations.getChatRuntime({
      tenantId: input.tenantId,
      agentDefinitionId: agent.id,
    });
    dependencies.logger?.log('info', 'work_item.mention.runtime_checked', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      agent_definition_id: agent.id,
      runtime_available: agent.runtimeAvailable,
      runtime_status: runtime?.status ?? null,
      reason: 'runtime_observed',
    });
    const runtimeWakeable =
      runtime !== null &&
      (input.reason === 'assignment'
        ? runtime.status === 'available' ||
          runtime.status === 'working' ||
          runtime.status === 'thinking'
        : runtime.status === 'available');
    if (!runtimeWakeable) {
      dependencies.logger?.log(
        'warn',
        'work_item.mention.runtime_unavailable',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
          runtime_available: agent.runtimeAvailable,
          runtime_status: runtime?.status ?? null,
          reason: 'runtime_not_wakeable',
        },
      );
      return false;
    }

    // A mention is allowed to be the FIRST contact, so the conversation is
    // created here if it does not exist. findOrCreateDirect is idempotent, so
    // two mentions in the same breath still share one conversation.
    stage = 'direct_conversation';
    dependencies.logger?.log(
      'info',
      'work_item.mention.direct_conversation.started',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        reason: 'find_or_create',
      },
    );
    const conversation = await dependencies.conversations.findOrCreateDirect({
      tenantId: input.tenantId,
      principalId: input.actorId,
      principalType: input.actorType,
      agentDefinitionId: agent.id,
    });
    dependencies.logger?.log(
      'info',
      'work_item.mention.direct_conversation.completed',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        conversation_id: conversation.id,
        reason: 'conversation_ready',
      },
    );

    const brief = workItemMentionBrief({
      reason: input.reason ?? 'mention',
      actorLabel: input.actorLabel ?? input.actorId,
      workItem: input.workItem,
      ...(input.quote === undefined ? {} : { quote: input.quote }),
    });
    const body =
      input.reason === 'assignment'
        ? [
            brief,
            'This is an assignment wake. Call work_item_claim (tool ' +
              'agent-server/work-item-claim) to claim this WorkItem, then carry ' +
              'out the task below and reply in this conversation with the result.',
            input.workItem.description?.trim()
              ? `Task: \n${input.workItem.description.trim()}`
              : 'Task: complete the work described by the WorkItem title.',
          ].join('\n\n')
        : brief;

    stage = 'message_append';
    dependencies.logger?.log(
      'info',
      'work_item.mention.message_append.started',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        conversation_id: conversation.id,
        reason: 'principal_wake_message',
      },
    );
    const message = await dependencies.conversations.appendMessage({
      author: {
        type: 'principal',
        tenantId: input.tenantId,
        conversationId: conversation.id,
        principalType: input.actorType,
        principalId: input.actorId,
        turnMetadata: {
          kind: 'work_item_mention_wake',
          workItemId: input.workItem.id,
          reason: input.reason ?? 'mention',
        },
      },
      dispatch: {
        kind: 'work_item_dispatch',
        workItemId: input.workItem.id,
        reason: input.reason ?? 'mention',
        actorLabel: boundedSnapshotText(
          input.actorLabel ?? input.actorId,
          'Someone',
          256,
        ),
        recipientLabel: boundedSnapshotText(agent.displayName, 'Coworker', 256),
        taskTitle: boundedSnapshotText(input.workItem.title, 'Task', 200),
      },
      body,
    });
    dependencies.logger?.log(
      'info',
      'work_item.mention.message_append.completed',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        conversation_id: conversation.id,
        message_id: message.id,
        message_sequence: message.sequence,
        reason: 'message_persisted',
      },
    );

    stage = 'unread_lookup';
    let lastReadSequence: number;
    if (input.reason === 'assignment') {
      lastReadSequence = Math.max(0, message.sequence - 1);
    } else {
      dependencies.logger?.log(
        'info',
        'work_item.mention.unread_lookup.started',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
          conversation_id: conversation.id,
          reason: 'planner_snapshot',
        },
      );
      const unread = await dependencies.conversations.getUnread({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        principalType: input.actorType,
        principalId: input.actorId,
      });
      lastReadSequence = unread.lastReadSequence;
      dependencies.logger?.log(
        'info',
        'work_item.mention.unread_lookup.completed',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
          conversation_id: conversation.id,
          last_read_sequence: lastReadSequence,
          unread_count: unread.unreadCount,
          reason: 'planner_snapshot',
        },
      );
    }
    const enqueueInput = {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      agentDefinitionId: agent.id,
      lastReadSequence,
      latestMessageSequence: message.sequence,
      latestMessageAuthorType: message.authorType,
      latestMessageId: message.id,
      workItemId: input.workItem.id,
      ...(dependencies.logger === undefined
        ? {}
        : { logger: dependencies.logger }),
      ...(dependencies.debounceMs === undefined
        ? {}
        : { debounceMs: dependencies.debounceMs }),
    };
    stage = 'dispatch_enqueue';
    const enqueued = await enqueueChatDispatchForMessage(
      dependencies.dispatches,
      enqueueInput,
    );
    if (!enqueued) {
      dependencies.logger?.log('warn', 'work_item.mention.wake_skipped', {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        agent_definition_id: agent.id,
        conversation_id: conversation.id,
        reason: 'dispatch_not_enqueued',
      });
      return false;
    }
    dependencies.logger?.log('info', 'work_item.mention.woken', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      agent_definition_id: agent.id,
      conversation_id: conversation.id,
      reason: 'dispatch_admitted',
      dispatch_admitted: true,
    });
    return true;
  } catch (error) {
    // Deliberately swallowed: the WorkItem write already happened and is the
    // thing the user asked for.
    dependencies.logger?.log('warn', 'work_item.mention.wake_failed', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      agent_definition_id: agent.id,
      reason: 'wake_failed',
      stage,
      error_name: errorReason(error),
    });
    return false;
  }
}

/**
 * An @-token names an agent by id, normalized name, or display name. Matching is
 * case-insensitive on the names and exact on the id; anything else is a human or
 * a stranger and is left alone.
 */
function resolveAgent(
  roster: readonly MentionableAgent[],
  mention: string,
): MentionableAgent | null {
  const token = mention.trim().toLowerCase();
  if (!token) return null;
  return (
    roster.find(
      (agent) =>
        agent.id === mention ||
        agent.id.toLowerCase() === token ||
        agent.normalizedName.toLowerCase() === token ||
        agent.displayName.trim().toLowerCase() === token,
    ) ?? null
  );
}

function resolveAgentById(
  roster: readonly MentionableAgent[],
  mention: string,
): MentionableAgent | null {
  return roster.find((agent) => agent.id === mention) ?? null;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

function boundedSnapshotText(
  value: string | undefined,
  fallback: string,
  maxLength: number,
): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) return fallback;
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}
