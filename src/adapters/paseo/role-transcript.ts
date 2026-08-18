/**
 * Projection from raw Paseo timeline items and stream events onto a single
 * transcript entry shape.
 *
 * Two consumers with different appetites read the same entry: an overview that
 * wants one line per entry, and a chat view that wants the whole thing. Paseo
 * publishes no summary or preview field of its own - the reference web client
 * renders full bodies and keeps collapsing in component state - so the short
 * form is derived here rather than read off the wire.
 *
 * Every entry keeps `rawType`, the provider's own discriminator, verbatim.
 * Item types this file has no opinion about still survive as entries instead of
 * being dropped, so a Paseo upgrade that adds a type degrades to "shown without
 * a tailored summary" rather than to silence.
 *
 * Pure: no I/O, no clock, no daemon handle.
 */

/**
 * Coarse bucket a reader can switch on without knowing Paseo's vocabulary.
 *
 * `permission` and `usage` are declared but are only ever produced from the
 * live stream: Paseo's stored timeline does not carry them, so a transcript
 * read back after a run has finished legitimately contains neither. That is a
 * property of the source, not a gap in this projection.
 *
 * We do separately persist both - execution-observation-payload.ts appends
 * permission and usage observations to run_events - so the missing data could
 * be joined in. v1 deliberately does not: reconciling Paseo's sequence space
 * with run_events' would be real complexity for metadata, while the value
 * here is assistant / reasoning / tool_call. The slots stay in the union so
 * adding that source later is additive rather than a contract change.
 *
 * Whatever fills them, do not backfill from run_events and present the result
 * as though Paseo returned it.
 */
export type RoleTranscriptEntryKind =
  | 'assistant'
  | 'user'
  | 'reasoning'
  | 'tool'
  | 'todo'
  | 'error'
  | 'compaction'
  | 'usage'
  | 'permission'
  | 'lifecycle';

export interface RoleTranscriptEntry {
  readonly kind: RoleTranscriptEntryKind;
  /** Paseo's own `type` discriminator, unmodified. */
  readonly rawType: string;
  readonly timestamp: string;
  /**
   * Ordering keys. Timeline entries carry a range; stream events carry a single
   * `seq`, mapped to an equal start and end. Null when the source omitted it.
   */
  readonly seqStart: number | null;
  readonly seqEnd: number | null;
  /** Whether this entry came from stored history or from the live subscription. */
  readonly source: 'timeline' | 'stream';
  /**
   * One line, trimmed and length-capped, for the overview layer.
   *
   * Named for what it is: Paseo publishes no summary or preview field, so this
   * is computed here from `body`. Do not treat it as provider data, do not
   * round-trip it back to Paseo, and do not persist it as though it were.
   */
  readonly derivedSummary: string;
  /** The provider item verbatim. Feeds the chat layer. */
  readonly body: unknown;
}

export interface RoleTranscriptMeaningfulEntry {
  readonly kind: Extract<
    RoleTranscriptEntryKind,
    'assistant' | 'tool' | 'error'
  >;
  readonly rawType: string;
  readonly timestamp: string;
  readonly derivedSummary: string;
  readonly action?: string;
  readonly result?: string;
}

/**
 * Facts derived only from the role roster and the fetched timeline tail. A
 * null historical turn count is deliberate: the timeline does not expose
 * turn boundaries, and this read model does not join run_events to invent one.
 */
export interface RoleTranscriptOverview {
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
  /** Number of entries in the fetched page, not an invented whole-history total. */
  readonly entryCount: number;
  readonly historicalTurnCount: number | null;
  readonly lastTimestamp: string | null;
  readonly hasOlder: boolean;
  readonly workRefs: readonly string[];
  readonly lastMeaningful: RoleTranscriptMeaningfulEntry | null;
}

const SUMMARY_MAX_LENGTH = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Collapse to a single line and cap it, so an overview row cannot be blown open by a long body. */
export function condense(text: string, maxLength = SUMMARY_MAX_LENGTH): string {
  const flattened = text.replace(/\s+/gu, ' ').trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, maxLength - 1).trimEnd()}…`;
}

const KIND_BY_ITEM_TYPE: Readonly<Record<string, RoleTranscriptEntryKind>> = {
  assistant_message: 'assistant',
  user_message: 'user',
  reasoning: 'reasoning',
  tool_call: 'tool',
  todo: 'todo',
  error: 'error',
  compaction: 'compaction',
};

export function classifyItemType(itemType: string): RoleTranscriptEntryKind {
  return KIND_BY_ITEM_TYPE[itemType] ?? 'lifecycle';
}

function summarizeToolCall(item: Record<string, unknown>): string {
  const name = stringField(item, 'name') ?? 'tool';
  const status = stringField(item, 'status');
  const detail = isRecord(item.detail) ? item.detail : null;
  // Prefer whatever the detail variant considers its headline over a generic label.
  const headline = detail
    ? (stringField(detail, 'command') ??
      stringField(detail, 'filePath') ??
      stringField(detail, 'query') ??
      stringField(detail, 'url') ??
      stringField(detail, 'text') ??
      stringField(detail, 'label'))
    : null;
  const head = status ? `${name} (${status})` : name;
  return condense(headline ? `${head}: ${headline}` : head);
}

const TOOL_STRUCTURAL_KEYS = ['toolName', 'type', 'operation', 'mode'] as const;
const TOOL_RESULT_KEYS = [
  'status',
  'work_ref',
  'workRef',
  'owner',
  'ok',
  'success',
] as const;
const TOOL_RESULT_CONTAINERS = [
  'detail',
  'metadata',
  'output',
  'result',
  'data',
] as const;

function safeScalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? condense(value) : null;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return null;
}

function findStructuralToolValue(
  value: unknown,
  keys: readonly string[],
): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const result = safeScalar(value[key]);
    if (result) return result;
  }
  return null;
}

function findToolResultMetadata(value: unknown, depth = 0): string | null {
  if (!isRecord(value) || depth > 2) return null;
  for (const key of TOOL_RESULT_KEYS) {
    const result = safeScalar(value[key]);
    if (result) return result;
  }
  for (const key of TOOL_RESULT_CONTAINERS) {
    const result = findToolResultMetadata(value[key], depth + 1);
    if (result) return result;
  }
  return null;
}

/** Extract only bounded, allowlisted tool metadata for an overview. */
function deriveToolActionResult(item: Record<string, unknown>): {
  readonly action?: string;
  readonly result?: string;
} {
  const detail = isRecord(item.detail) ? item.detail : null;
  const name = stringField(item, 'name');
  const action =
    name ??
    findStructuralToolValue(detail, TOOL_STRUCTURAL_KEYS) ??
    findStructuralToolValue(item, TOOL_STRUCTURAL_KEYS);
  const result = findToolResultMetadata(item);
  return {
    ...(action ? { action: condense(action) } : {}),
    ...(result ? { result: condense(result) } : {}),
  };
}

function summarizeUsage(usage: Record<string, unknown>): string {
  const parts: string[] = [];
  const input = numberField(usage, 'inputTokens');
  const output = numberField(usage, 'outputTokens');
  const cost = numberField(usage, 'totalCostUsd');
  if (input !== null) parts.push(`in ${input}`);
  if (output !== null) parts.push(`out ${output}`);
  if (cost !== null) parts.push(`$${cost.toFixed(6)}`);
  return parts.length ? `usage: ${parts.join(' · ')}` : 'usage';
}

/** Build the one-line form for an item whose kind has already been decided. */
export function summarizeItem(
  kind: RoleTranscriptEntryKind,
  itemType: string,
  item: Record<string, unknown>,
): string {
  if (kind === 'assistant' || kind === 'user') {
    const text = stringField(item, 'text');
    return text ? condense(text) : `(empty ${itemType})`;
  }
  if (kind === 'reasoning') {
    const text = stringField(item, 'text');
    return text ? `thought: ${condense(text, SUMMARY_MAX_LENGTH - 9)}` : 'thought';
  }
  if (kind === 'tool') return summarizeToolCall(item);
  if (kind === 'todo') {
    const items = Array.isArray(item.items) ? item.items : [];
    const done = items.filter(
      (entry) => isRecord(entry) && entry.completed === true,
    ).length;
    return `todo: ${done}/${items.length} complete`;
  }
  if (kind === 'error') {
    const message = stringField(item, 'message');
    return message ? `error: ${condense(message, SUMMARY_MAX_LENGTH - 7)}` : 'error';
  }
  if (kind === 'compaction') {
    const status = stringField(item, 'status');
    return status ? `compaction (${status})` : 'compaction';
  }
  return itemType;
}

/**
 * Project one stored timeline entry. Returns null only when the envelope is
 * unusable - a missing or non-string item type - because an entry with no
 * discriminator cannot be ordered against or rendered.
 */
export function projectTimelineEntry(entry: unknown): RoleTranscriptEntry | null {
  if (!isRecord(entry) || !isRecord(entry.item)) return null;
  const item = entry.item;
  const itemType = stringField(item, 'type');
  if (!itemType) return null;
  const kind = classifyItemType(itemType);
  return {
    kind,
    rawType: itemType,
    timestamp: stringField(entry, 'timestamp') ?? '',
    seqStart: numberField(entry, 'seqStart'),
    seqEnd: numberField(entry, 'seqEnd'),
    source: 'timeline',
    derivedSummary: summarizeItem(kind, itemType, item),
    body: item,
  };
}

/**
 * Project one live `agent_stream` payload. Timeline events carry an item and
 * are treated exactly as stored entries are; `turn_completed` becomes a usage
 * entry, which is the only place usage is published at all.
 */
export function projectStreamPayload(payload: unknown): RoleTranscriptEntry | null {
  if (!isRecord(payload) || !isRecord(payload.event)) return null;
  const event = payload.event;
  const eventType = stringField(event, 'type');
  if (!eventType) return null;
  const timestamp = stringField(payload, 'timestamp') ?? '';
  const seq = numberField(payload, 'seq');

  if (eventType === 'timeline' && isRecord(event.item)) {
    const item = event.item;
    const itemType = stringField(item, 'type');
    if (!itemType) return null;
    const kind = classifyItemType(itemType);
    return {
      kind,
      rawType: itemType,
      timestamp,
      seqStart: seq,
      seqEnd: seq,
      source: 'stream',
      derivedSummary: summarizeItem(kind, itemType, item),
      body: item,
    };
  }

  const kind: RoleTranscriptEntryKind =
    eventType === 'turn_completed'
      ? 'usage'
      : eventType.startsWith('permission')
        ? 'permission'
        : 'lifecycle';
  const derivedSummary =
    kind === 'usage' && isRecord(event.usage)
      ? summarizeUsage(event.usage)
      : eventType;
  return {
    kind,
    rawType: eventType,
    timestamp,
    seqStart: seq,
    seqEnd: seq,
    source: 'stream',
    derivedSummary,
    body: event,
  };
}

/**
 * Stable chronological order. Entries without a sequence fall back to
 * timestamp, and ties keep their arrival order so a re-read renders the same
 * way twice.
 */
export function orderEntries(
  entries: readonly RoleTranscriptEntry[],
): readonly RoleTranscriptEntry[] {
  return [...entries]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftSeq = left.entry.seqStart;
      const rightSeq = right.entry.seqStart;
      if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq)
        return leftSeq - rightSeq;
      if (left.entry.timestamp !== right.entry.timestamp)
        return left.entry.timestamp < right.entry.timestamp ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

const WORK_REF_PATTERN = /(?:^|[^A-Za-z0-9_])(W-[1-9]\d*)(?![A-Za-z0-9_])/gu;
const MAX_WORK_REF_SCAN_DEPTH = 8;
const MAX_WORK_REFS = 256;

function collectWorkRefs(
  value: unknown,
  refs: Set<string>,
  seen: WeakSet<object>,
  depth = 0,
): void {
  if (refs.size >= MAX_WORK_REFS || depth > MAX_WORK_REF_SCAN_DEPTH) return;
  if (typeof value === 'string') {
    for (const match of value.matchAll(WORK_REF_PATTERN)) {
      const ref = match[1];
      if (ref) refs.add(ref);
      if (refs.size >= MAX_WORK_REFS) return;
    }
    return;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectWorkRefs(entry, refs, seen, depth + 1);
    return;
  }
  for (const entry of Object.values(value))
    collectWorkRefs(entry, refs, seen, depth + 1);
}

function workRefsFromEntries(
  entries: readonly RoleTranscriptEntry[],
): readonly string[] {
  const refs = new Set<string>();
  const seen = new WeakSet<object>();
  for (const entry of entries) {
    collectWorkRefs(entry.body, refs, seen);
    collectWorkRefs(entry.derivedSummary, refs, seen);
    if (refs.size >= MAX_WORK_REFS) break;
  }
  return [...refs];
}

function isMeaningful(
  entry: RoleTranscriptEntry,
): entry is RoleTranscriptEntry & {
  readonly kind: Extract<
    RoleTranscriptEntryKind,
    'assistant' | 'tool' | 'error'
  >;
} {
  if (
    entry.kind !== 'assistant' &&
    entry.kind !== 'tool' &&
    entry.kind !== 'error'
  )
    return false;
  if (!entry.derivedSummary.trim()) return false;
  return !(
    entry.kind === 'assistant' && entry.derivedSummary.startsWith('(empty ')
  );
}

function lastTimestamp(entries: readonly RoleTranscriptEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const timestamp = entries[index]?.timestamp.trim();
    if (timestamp) return timestamp;
  }
  return null;
}

/** Derive a compact role-level read model without adding another data source. */
export function deriveRoleTranscriptOverview(input: {
  readonly memberName: string;
  readonly role: string;
  readonly status: string;
  readonly providerAgentId: string;
  readonly entries: readonly RoleTranscriptEntry[];
  readonly hasOlder: boolean;
}): RoleTranscriptOverview {
  const meaningful = [...input.entries].reverse().find(isMeaningful);
  return {
    memberName: input.memberName,
    role: input.role,
    status: input.status,
    providerAgentId: input.providerAgentId,
    entryCount: input.entries.length,
    historicalTurnCount: null,
    lastTimestamp: lastTimestamp(input.entries),
    hasOlder: input.hasOlder,
    workRefs: workRefsFromEntries(input.entries),
    lastMeaningful: meaningful
      ? {
          kind: meaningful.kind,
          rawType: meaningful.rawType,
          timestamp: meaningful.timestamp,
          derivedSummary: meaningful.derivedSummary,
          ...(meaningful.kind === 'tool'
            ? deriveToolActionResult(meaningful.body as Record<string, unknown>)
            : {}),
        }
      : null,
  };
}
