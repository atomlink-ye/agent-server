import type { RunStatus } from '../../domain/runs/run-status.js';
import type { ExecutionSessionBinding } from './execution-plane.js';
import { z } from 'zod';

export type RunEventJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly RunEventJsonValue[]
  | { readonly [key: string]: RunEventJsonValue };

export type RunEventPayload = Readonly<Record<string, RunEventJsonValue>>;

const MAX_RUN_EVENT_DEPTH = 3;
const MAX_RUN_EVENT_KEYS = 32;
const MAX_RUN_EVENT_ARRAY = 64;
const MAX_RUN_EVENT_BYTES = 32 * 1024;

const RunEventInputSchema = z.record(z.string(), z.unknown());
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const RunEventJsonSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(RunEventJsonSchema).max(MAX_RUN_EVENT_ARRAY),
    z.record(z.string(), RunEventJsonSchema).superRefine((value, context) => {
      if (Object.keys(value).length > MAX_RUN_EVENT_KEYS)
        context.addIssue({ code: 'custom', message: 'Too many payload keys.' });
    }),
  ]),
);

function isBoundedRunEventJson(value: unknown, depth: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      depth <= MAX_RUN_EVENT_DEPTH &&
      value.length <= MAX_RUN_EVENT_ARRAY &&
      value.every((item) => isBoundedRunEventJson(item, depth + 1))
    );
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    depth <= MAX_RUN_EVENT_DEPTH &&
    entries.length <= MAX_RUN_EVENT_KEYS &&
    entries.every(
      ([key, item]) => key.length > 0 && isBoundedRunEventJson(item, depth + 1),
    )
  );
}

export const RunEventPayloadSchema = z
  .record(z.string(), RunEventJsonSchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > MAX_RUN_EVENT_KEYS)
      context.addIssue({ code: 'custom', message: 'Too many payload keys.' });
    // The payload record itself is the envelope; nested JSON depth starts at -1.
    if (!isBoundedRunEventJson(value, -1))
      context.addIssue({
        code: 'custom',
        message: 'Run event payload exceeds JSON bounds.',
      });
    if (byteLength(value) > MAX_RUN_EVENT_BYTES)
      context.addIssue({
        code: 'custom',
        message: 'Run event payload exceeds 32KiB.',
      });
  });

function clipValue(
  value: unknown,
  depth: number,
): RunEventJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (depth > MAX_RUN_EVENT_DEPTH) return undefined;
    return value
      .slice(0, MAX_RUN_EVENT_ARRAY)
      .map((item) => clipValue(item, depth + 1))
      .filter((item): item is RunEventJsonValue => item !== undefined);
  }
  if (!isPlainRecord(value)) return undefined;
  if (depth > MAX_RUN_EVENT_DEPTH) return undefined;
  const output: Record<string, RunEventJsonValue> = {};
  for (const [key, item] of Object.entries(value).slice(
    0,
    MAX_RUN_EVENT_KEYS,
  )) {
    const clipped = clipValue(item, depth + 1);
    if (clipped !== undefined) output[key] = clipped;
  }
  return output;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function trimToByteBudget(value: RunEventPayload): RunEventPayload {
  if (byteLength(value) <= MAX_RUN_EVENT_BYTES) return value;
  const output: Record<string, RunEventJsonValue> = { ...value };
  type MutableContainer =
    Record<string, RunEventJsonValue> | RunEventJsonValue[];
  type StringCandidate = {
    readonly parent: MutableContainer;
    readonly key: string | number;
    readonly value: string;
  };
  type FieldCandidate = {
    readonly parent: Record<string, RunEventJsonValue>;
    readonly key: string;
    readonly contribution: number;
  };

  const strings: StringCandidate[] = [];
  const fields: FieldCandidate[] = [];
  const collect = (
    item: RunEventJsonValue,
    parent?: MutableContainer,
    key?: string | number,
  ): void => {
    if (typeof item === 'string') {
      if (parent !== undefined && key !== undefined)
        strings.push({ parent, key, value: item });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => collect(child, item, index));
      return;
    }
    if (item && typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item)) {
        fields.push({
          parent: item as Record<string, RunEventJsonValue>,
          key: childKey,
          contribution: byteLength({ [childKey]: child }),
        });
        collect(child, item as Record<string, RunEventJsonValue>, childKey);
      }
    }
  };

  while (byteLength(output) > MAX_RUN_EVENT_BYTES) {
    strings.length = 0;
    fields.length = 0;
    collect(output);
    const protectedDetailText = (candidate: FieldCandidate): boolean => {
      const detail = output['detail'];
      if (
        candidate.parent !== detail ||
        !detail ||
        Array.isArray(detail) ||
        typeof detail !== 'object'
      )
        return false;
      const textKey = [
        'text',
        'output',
        'result',
        'content',
        'unifiedDiff',
        'log',
        'error',
      ].find(
        (key) => typeof (detail as Record<string, unknown>)[key] === 'string',
      );
      return textKey === candidate.key;
    };
    const protectedDetailField = (candidate: FieldCandidate): boolean =>
      candidate.parent === output['detail'] &&
      (candidate.key === 'kind' || protectedDetailText(candidate));
    const largest = strings
      .filter(
        (candidate) =>
          !(
            output['detail'] &&
            candidate.parent === output &&
            ['detail_kind', 'detail_text', 'exit_code'].includes(
              String(candidate.key),
            )
          ),
      )
      .sort((a, b) => byteLength(b.value) - byteLength(a.value))[0];
    if (largest) {
      const codePoints = Array.from(largest.value);
      const original = largest.value;
      const detail = output['detail'];
      const syncedFlatText = Boolean(
        detail &&
        typeof detail === 'object' &&
        !Array.isArray(detail) &&
        largest.parent === detail &&
        largest.key !== undefined &&
        typeof output['detail_text'] === 'string' &&
        [
          'text',
          'output',
          'result',
          'content',
          'unifiedDiff',
          'log',
          'error',
        ].includes(String(largest.key)),
      );
      const assignLargest = (next: string): void => {
        (largest.parent as Record<string | number, RunEventJsonValue>)[
          largest.key
        ] = next;
        if (syncedFlatText) output['detail_text'] = next;
      };
      assignLargest('');
      const stringCanResolve = byteLength(output) <= MAX_RUN_EVENT_BYTES;
      assignLargest(original);
      if (!stringCanResolve) {
        const field = fields
          .filter(
            (candidate) =>
              !(
                candidate.parent === output &&
                ['detail', 'detail_kind', 'detail_text', 'exit_code'].includes(
                  candidate.key,
                )
              ) && !protectedDetailField(candidate),
          )
          .sort((a, b) => b.contribution - a.contribution)[0];
        if (field) {
          delete field.parent[field.key];
          continue;
        }
      }
      let low = 0;
      let high = codePoints.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        assignLargest(codePoints.slice(0, middle).join(''));
        if (byteLength(output) <= MAX_RUN_EVENT_BYTES) low = middle;
        else high = middle - 1;
      }
      assignLargest(codePoints.slice(0, low).join(''));
      if (byteLength(output) <= MAX_RUN_EVENT_BYTES) break;
      delete (largest.parent as Record<string | number, RunEventJsonValue>)[
        largest.key
      ];
      if (syncedFlatText) delete output['detail_text'];
      continue;
    }
    let field = fields
      .filter(
        (candidate) =>
          !(
            candidate.parent === output &&
            ['detail', 'detail_kind', 'detail_text', 'exit_code'].includes(
              candidate.key,
            )
          ) && !protectedDetailField(candidate),
      )
      .sort((a, b) => b.contribution - a.contribution)[0];
    if (!field) {
      const detail = output['detail'];
      const detailHasText =
        detail &&
        typeof detail === 'object' &&
        !Array.isArray(detail) &&
        [
          'text',
          'output',
          'result',
          'content',
          'unifiedDiff',
          'log',
          'error',
        ].some(
          (key) => typeof (detail as Record<string, unknown>)[key] === 'string',
        );
      const flat = fields
        .filter(
          (candidate) =>
            candidate.parent === output &&
            (!detailHasText || candidate.key !== 'detail_kind') &&
            candidate.key === 'detail_text' &&
            typeof candidate.parent[candidate.key] === 'string',
        )
        .sort((a, b) => b.contribution - a.contribution)[0];
      if (flat) field = flat;
    }
    if (!field) break;
    delete field.parent[field.key];
  }
  return output;
}

export function boundedRunEventPayload(value: unknown): RunEventPayload {
  const parsed = RunEventInputSchema.safeParse(value);
  if (!parsed.success) return {};
  const output: Record<string, RunEventJsonValue> = {};
  for (const [key, item] of Object.entries(parsed.data).slice(
    0,
    MAX_RUN_EVENT_KEYS,
  )) {
    const clipped = clipValue(item, 0);
    if (clipped !== undefined) output[key] = clipped;
  }
  // Establish the canonical flat projection before trimming. This keeps a
  // large flat detail_text synchronized with its nested source, while still
  // allowing flat-only payloads to trim/drop the offending field below.
  synchronizeDetailProjection(output);
  trimTopLevelKeys(output);
  let bounded = trimToByteBudget(output) as Record<string, RunEventJsonValue>;
  synchronizeDetailProjection(bounded);
  trimTopLevelKeys(bounded);
  if (byteLength(bounded) > MAX_RUN_EVENT_BYTES) {
    const detail = bounded['detail'];
    const flatText = bounded['detail_text'];
    if (
      detail &&
      typeof detail === 'object' &&
      !Array.isArray(detail) &&
      typeof flatText === 'string'
    ) {
      const textKey = [
        'text',
        'output',
        'result',
        'content',
        'unifiedDiff',
        'log',
        'error',
      ].find(
        (key) => typeof (detail as Record<string, unknown>)[key] === 'string',
      );
      if (textKey) {
        const original = (detail as Record<string, unknown>)[textKey] as string;
        let low = 0;
        let high = Array.from(original).length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          const text = Array.from(original).slice(0, middle).join('');
          (detail as Record<string, unknown>)[textKey] = text;
          bounded['detail_text'] = text;
          if (byteLength(bounded) <= MAX_RUN_EVENT_BYTES) low = middle;
          else high = middle - 1;
        }
        const text = Array.from(original).slice(0, low).join('');
        (detail as Record<string, unknown>)[textKey] = text;
        bounded['detail_text'] = text;
      }
    }
  }
  // Synchronization can replace a clipped flat value with nested detail text;
  // run the byte trimmer once more so the final payload is always bounded.
  synchronizeDetailProjection(bounded);
  trimTopLevelKeys(bounded);
  bounded = trimToByteBudget(bounded) as Record<string, RunEventJsonValue>;
  synchronizeDetailProjection(bounded);
  trimTopLevelKeys(bounded);
  return RunEventPayloadSchema.safeParse(bounded).success ? bounded : {};
}

function synchronizeDetailProjection(
  payload: Record<string, RunEventJsonValue>,
): void {
  const detail = payload.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
  const record = detail as Record<string, RunEventJsonValue>;
  if (typeof record.kind === 'string') payload.detail_kind = record.kind;
  const text = [
    'text',
    'output',
    'result',
    'content',
    'unifiedDiff',
    'log',
    'error',
  ]
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string');
  if (text !== undefined && 'detail_text' in payload)
    payload.detail_text = text;
  if (typeof record.exitCode === 'number' || record.exitCode === null)
    payload.exit_code = record.exitCode;
}

function trimTopLevelKeys(payload: Record<string, RunEventJsonValue>): void {
  const protectedKeys = new Set([
    'kind',
    'detail',
    'detail_kind',
    'detail_text',
    'exit_code',
  ]);
  while (Object.keys(payload).length > MAX_RUN_EVENT_KEYS) {
    const candidate = Object.keys(payload).find(
      (key) => !protectedKeys.has(key),
    );
    if (!candidate) break;
    delete payload[candidate];
  }
}

export const runEventTypes = [
  'started',
  'output',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunEventType = (typeof runEventTypes)[number];
export interface RunEvent {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: RunEventType;
  readonly payload: RunEventPayload;
  readonly createdAt: string;
}
export interface RuntimeSessionBinding {
  readonly runId: string;
  readonly sessionId?: string | null;
  readonly sessionBinding?: ExecutionSessionBinding;
  readonly createdAt: string;
}
export interface RunEventRepository {
  bind(input: RuntimeSessionBinding): Promise<void>;
  getBinding(runId: string): Promise<RuntimeSessionBinding | null>;
  findLatestSessionBindingBySessionId(
    sessionId: string,
  ): Promise<ExecutionSessionBinding | null>;
  getSessionBindingForRunInSession(
    runId: string,
    sessionId: string,
  ): Promise<ExecutionSessionBinding | null>;
  append(
    runId: string,
    type: RunEventType,
    payload: RunEvent['payload'],
  ): Promise<RunEvent>;
  list(
    runId: string,
    after: number,
    limit?: number,
  ): Promise<{ events: readonly RunEvent[]; nextCursor: number | null }>;
}
export function terminalEventForStatus(status: RunStatus): RunEventType | null {
  return status === 'succeeded'
    ? 'succeeded'
    : status === 'cancelled'
      ? 'cancelled'
      : status === 'failed' || status === 'timed_out'
        ? 'failed'
        : null;
}
