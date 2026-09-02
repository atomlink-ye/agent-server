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
  /** Only an available runtime can be woken; anything else is skipped. */
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
    readonly boardId?: string;
    readonly columnId?: string;
  };
}

export interface WakeMentionedAgentsResult {
  /** Agent definition ids that received a durable wake message. */
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
  if (mentions.length === 0) return { woken: [], skipped: [] };

  if (
    dependencies.wakeLoopGuard &&
    (await isWakeLoopCapped(dependencies, input))
  ) {
    return Object.freeze({
      woken: Object.freeze([]),
      skipped: Object.freeze([...mentions]),
    });
  }

  const roster = await listRoster(dependencies, input);
  const woken: string[] = [];
  const skipped: string[] = [];

  for (const mention of mentions) {
    const agent = resolveAgent(roster, mention);
    if (!agent || agent.id === input.actorId) {
      skipped.push(mention);
      continue;
    }
    const delivered = await wakeOne(dependencies, input, agent);
    (delivered ? woken : skipped).push(delivered ? agent.id : mention);
  }
  return Object.freeze({
    woken: Object.freeze(woken),
    skipped: Object.freeze(skipped),
  });
}

async function listRoster(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
): Promise<readonly MentionableAgent[]> {
  try {
    return await dependencies.roster.listMentionableAgents({
      tenantId: input.tenantId,
    });
  } catch (error) {
    // No roster means no wake. It does not mean no WorkItem.
    dependencies.logger?.log('warn', 'work_item.mention.roster_unavailable', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      reason: errorReason(error),
    });
    return [];
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
  try {
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
        agent_wake_count: decision.agentWakeCount,
        hard_cap: decision.hardCap,
      });
      return true;
    }
    return false;
  } catch (error) {
    dependencies.logger?.log(
      'warn',
      'work_item.mention.wake_loop_guard_unavailable',
      {
        tenant_id: input.tenantId,
        work_item_id: input.workItem.id,
        reason: errorReason(error),
      },
    );
    return true;
  }
}

async function wakeOne(
  dependencies: WakeMentionedAgentsDependencies,
  input: WakeMentionedAgentsInput,
  agent: MentionableAgent,
): Promise<boolean> {
  try {
    if (!agent.runtimeAvailable) {
      dependencies.logger?.log(
        'warn',
        'work_item.mention.runtime_unavailable',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
        },
      );
      return false;
    }
    const runtime = await dependencies.conversations.getChatRuntime({
      tenantId: input.tenantId,
      agentDefinitionId: agent.id,
    });
    if (!runtime || runtime.status !== 'available') {
      dependencies.logger?.log(
        'warn',
        'work_item.mention.runtime_unavailable',
        {
          tenant_id: input.tenantId,
          work_item_id: input.workItem.id,
          agent_definition_id: agent.id,
        },
      );
      return false;
    }

    // A mention is allowed to be the FIRST contact, so the conversation is
    // created here if it does not exist. findOrCreateDirect is idempotent, so
    // two mentions in the same breath still share one conversation.
    const conversation = await dependencies.conversations.findOrCreateDirect({
      tenantId: input.tenantId,
      principalId: input.actorId,
      principalType: input.actorType,
      agentDefinitionId: agent.id,
    });

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
      body: workItemMentionBrief({
        reason: input.reason ?? 'mention',
        actorLabel: input.actorLabel ?? input.actorId,
        workItem: input.workItem,
        ...(input.quote === undefined ? {} : { quote: input.quote }),
      }),
    });

    const unread = await dependencies.conversations.getUnread({
      tenantId: input.tenantId,
      conversationId: conversation.id,
      principalType: input.actorType,
      principalId: input.actorId,
    });
    await enqueueChatDispatchForMessage(dependencies.dispatches, {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      agentDefinitionId: agent.id,
      lastReadSequence: unread.lastReadSequence,
      latestMessageSequence: message.sequence,
      latestMessageAuthorType: message.authorType,
      latestMessageId: message.id,
    });
    dependencies.logger?.log('info', 'work_item.mention.woken', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      agent_definition_id: agent.id,
      conversation_id: conversation.id,
    });
    return true;
  } catch (error) {
    // Deliberately swallowed: the WorkItem write already happened and is the
    // thing the user asked for.
    dependencies.logger?.log('warn', 'work_item.mention.wake_failed', {
      tenant_id: input.tenantId,
      work_item_id: input.workItem.id,
      agent_definition_id: agent.id,
      reason: errorReason(error),
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

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown';
}
