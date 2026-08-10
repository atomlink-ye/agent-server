import { createHash } from 'node:crypto';

const SECRET_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|raw[_-]?payload|provider(?:[_-]?(?:request|response|agent|payload))?|model|runtime[_-]?session|prompt|environment[_-]?value)/iu;
const SECRET_VALUE =
  /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:token|secret|password|credential|api[_ -]?key|authorization|cookie)\s*[:=]\s*[^\s,}]+|(?:\/Users\/|\/Volumes\/|\/private\/var\/|[A-Za-z]:[\\/]))/iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

export const RUN_EVENT_PAYLOAD_KEYS = new Set([
  'event',
  'kind',
  'text',
  'detail',
  'detail_kind',
  'detail_text',
  'exit_code',
  'activity_id',
  'parent_activity_id',
  'category',
  'label',
  'tool_name',
  'provider',
  'item_kind',
  'decision',
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'total_cost_usd',
  'context_window_max_tokens',
  'context_window_used_tokens',
  'error',
  'status',
  'phase',
  'sequence',
  'attempt_no',
  'work_item_id',
  'attempt_id',
  'message_id',
  'summary',
  'reason_code',
  'code',
  'message',
  'failure_code',
]);

export class RecordingSecretError extends Error {
  constructor(path, reason = 'sensitive_recording_field') {
    super(`recording_secret_detected:${reason}:${path}`);
    this.name = 'RecordingSecretError';
    this.code = 'recording_secret_detected';
    this.path = path;
  }
}

function cleanString(value, path) {
  if (SECRET_VALUE.test(value))
    throw new RecordingSecretError(path, 'sensitive_value');
  return value
    .replace(CONTROL, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4096);
}

/** Fail closed. No redaction is performed for a value that is not explicitly safe. */
export function sanitizeRecording(value, path = '$', options = {}) {
  const { allowKeys = new Set(), allowProviderSummary = false } = options;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item, index) =>
      sanitizeRecording(item, `${path}[${index}]`, options),
    );
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
      const keyAllowed = allowKeys.has(key) || allowKeys.has(normalized);
      const providerSummaryAllowed =
        allowProviderSummary && (key === 'provider' || key === 'model');
      if (!keyAllowed && !providerSummaryAllowed && SECRET_KEY.test(key)) {
        throw new RecordingSecretError(`${path}.${key}`, 'sensitive_key');
      }
      output[key] = sanitizeRecording(item, `${path}.${key}`, options);
    }
    return output;
  }
  if (typeof value === 'string') return cleanString(value, path);
  if (
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  )
    return value;
  throw new RecordingSecretError(path, 'unsupported_value');
}

/** Project run_events.payload before the general scanner sees it. */
export function sanitizeRunEventPayload(payload, path = '$.payload') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RecordingSecretError(path, 'run_event_payload_shape');
  }
  const projected = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!RUN_EVENT_PAYLOAD_KEYS.has(key))
      throw new RecordingSecretError(`${path}.${key}`, 'run_event_payload_key');
    projected[key] = value;
  }
  return sanitizeRecording(projected, path, {
    allowKeys: RUN_EVENT_PAYLOAD_KEYS,
  });
}

export function stableStringify(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.keys(entry)
          .sort()
          .map((key) => [key, normalize(entry[key])]),
      );
    }
    return entry;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value) {
  return sha256(stableStringify(value));
}

export function scanSecretText(value, path = '$') {
  sanitizeRecording(value, path);
  return true;
}

export function assertNoEnvironmentValues(value, environment = process.env) {
  const serialized = stableStringify(value);
  for (const [name, candidate] of Object.entries(environment)) {
    if (!candidate || candidate.length < 8) continue;
    if (
      /^(?:NODE_ENV|PATH|PWD|OLDPWD|HOME|SHELL|TERM|LANG|TZ|PASEO_PROVIDER|PASEO_MODEL|SERVICE_REVISION|AGENT_TENANT_ID|AGENT_WORKSPACE_ID|AGENT_PRINCIPAL_ID|SERVICE_ACCOUNT_ID)$/u.test(
        name,
      )
    )
      continue;
    if (serialized.includes(candidate))
      throw new RecordingSecretError(`$env.${name}`, 'environment_value');
  }
  return true;
}
