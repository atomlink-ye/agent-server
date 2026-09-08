import { WorkListResponseSchema } from '@atomlink-ye/agent-server/product-contract';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { apiTransport } from '../../api/transport';
import { loadConversations } from '../conversations/conversations-gateway';
import type { Conversation } from '../conversations/contracts';
import { t } from '../../i18n';

/**
 * A Coworker profile has to answer "what did this one do lately?" from real
 * records only. Two records carry that answer today:
 *
 * - Work built on a Capability this Coworker publishes. Work rows carry a
 *   Definition lineage, not an Agent id, so this is an honest "started from
 *   this Coworker's Capabilities" attribution, not "this Coworker ran it".
 * - Direct conversations bound to this Coworker.
 *
 * Nothing here synthesises activity: a source that fails is reported as
 * failed, and an empty source stays empty.
 */
export type CoworkerActivityKind = 'work' | 'chat';

export type CoworkerActivityState =
  'running' | 'needs_you' | 'complete' | 'problem' | 'not_captured';

export interface CoworkerActivityItem {
  readonly id: string;
  readonly kind: CoworkerActivityKind;
  readonly title: string;
  /** The Work's captured result summary, when the Product captured one. */
  readonly detail: string | null;
  readonly state: CoworkerActivityState | null;
  readonly at: string;
  readonly to: string;
}

export type CoworkerActivitySourceStatus = 'ok' | 'skipped' | 'failed';

export interface CoworkerActivity {
  readonly items: readonly CoworkerActivityItem[];
  readonly work: CoworkerActivitySourceStatus;
  readonly chat: CoworkerActivitySourceStatus;
}

export const ACTIVITY_LIMIT = 5;

export interface CoworkerActivityRequest {
  readonly agentId: string;
  /** Work Definition lineage ids taken from this Coworker's Work Catalog. */
  readonly capabilityDefinitionIds: readonly string[];
  readonly limit?: number;
}

type Source<T> =
  | { readonly status: 'ok'; readonly values: readonly T[] }
  | { readonly status: 'skipped' | 'failed' };

async function attempt<T>(
  load: () => Promise<readonly T[]>,
): Promise<Source<T>> {
  try {
    return { status: 'ok', values: await load() };
  } catch {
    return { status: 'failed' };
  }
}

export async function loadCoworkerActivity(
  request: CoworkerActivityRequest,
): Promise<CoworkerActivity> {
  const definitionIds = new Set(request.capabilityDefinitionIds);
  const [works, chats] = await Promise.all([
    definitionIds.size === 0
      ? Promise.resolve<Source<WorkListItem>>({ status: 'skipped' })
      : attempt(loadWorkListItems),
    attempt(loadConversations),
  ]);

  const items = [
    ...(works.status === 'ok'
      ? works.values
          .filter((work) => definitionIds.has(work.definition_id))
          .map(workActivity)
      : []),
    ...(chats.status === 'ok'
      ? chats.values
          .filter(
            (chat) => chat.directAgent?.agentDefinitionId === request.agentId,
          )
          .map(chatActivity)
      : []),
  ];

  return {
    items: sortByRecency(items).slice(0, request.limit ?? ACTIVITY_LIMIT),
    work: works.status,
    chat: chats.status,
  };
}

async function loadWorkListItems(): Promise<readonly WorkListItem[]> {
  const payload = WorkListResponseSchema.parse(
    await apiTransport.request('/api/works', { cache: 'no-store' }),
  );
  return payload.works.filter((work) => work.archived_at === null);
}

/** Exported for tests: the merge rule is the part worth pinning down. */
export function sortByRecency(
  items: readonly CoworkerActivityItem[],
): readonly CoworkerActivityItem[] {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.at) - Date.parse(left.at) ||
      left.id.localeCompare(right.id),
  );
}

function workActivity(work: WorkListItem): CoworkerActivityItem {
  return {
    id: `work:${work.id}`,
    kind: 'work',
    title: work.title,
    detail: work.latest_run_summary?.result_summary ?? null,
    state: work.product_state,
    at: work.latest_run_summary?.updated_at ?? work.updated_at,
    to: `/work/${encodeURIComponent(work.id)}`,
  };
}

function chatActivity(conversation: Conversation): CoworkerActivityItem {
  return {
    id: `chat:${conversation.id}`,
    kind: 'chat',
    title: conversation.title ?? t('agents.directConversation'),
    detail: null,
    state: null,
    at: conversation.updatedAt,
    to: `/conversations/${encodeURIComponent(conversation.id)}`,
  };
}

export function activityStateLabel(state: CoworkerActivityState): string {
  const key: Record<CoworkerActivityState, Parameters<typeof t>[0]> = {
    running: 'activityState.running',
    needs_you: 'activityState.needsYou',
    complete: 'activityState.complete',
    problem: 'activityState.problem',
    not_captured: 'activityState.notCaptured',
  };
  return t(key[state]);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Recency is the point of this list, so it reads as elapsed time until the
 * entry is old enough that a date is more useful. An unparseable timestamp
 * returns null rather than inventing "just now".
 */
export function formatActivityTime(
  value: string,
  now: number = Date.now(),
): string | null {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const elapsed = now - at;
  if (elapsed < 0) return new Date(at).toLocaleDateString();
  if (elapsed < MINUTE) return t('agents.justNow');
  if (elapsed < HOUR)
    return t('agents.minutesAgo', { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY)
    return t('agents.hoursAgo', { count: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY)
    return t('agents.daysAgo', { count: Math.floor(elapsed / DAY) });
  return new Date(at).toLocaleDateString();
}
