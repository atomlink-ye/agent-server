import { createHash } from 'node:crypto';

const SECRET_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|raw[_-]?payload|provider(?:[_-]?(?:request|response|agent|payload))?|model|runtime[_-]?session|prompt|environment[_-]?value)/iu;
const SECRET_VALUE =
  /(?:bearer\s+[a-z0-9._~+/=-]{8,}|(?:token|secret|password|credential|api[_ -]?key|authorization|cookie)\s*[:=]\s*[^\s,}]+|(?:\/Users\/|\/Volumes\/|\/private\/var\/|[A-Za-z]:[\\/]))/iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
export const RECORDING_REDACTION_PLACEHOLDER = '[REDACTED]';

// These are public local fixture values, not name-based exemptions. A value
// from one of these environment variables is safe only when it is an exact
// member of its intentionally small, checked-in class.
const SAFE_ENVIRONMENT_VALUES = new Map([
  ['AGENT_PRINCIPAL_TYPE', new Set(['service_account'])],
  ['NODE_ENV', new Set(['development', 'test', 'production'])],
  ['PASEO_PROVIDER', new Set(['opencode', 'claude', 'codex'])],
  ['PASEO_MODEL', new Set(['opencode-go/deepseek-v4-flash'])],
  ['AGENT_TENANT_ID', new Set(['tenant_local'])],
  ['AGENT_SERVER_TENANT_ID', new Set(['tenant_local'])],
  ['AGENT_WORKSPACE_ID', new Set(['00000000-0000-4000-8000-000000000001'])],
  [
    'AGENT_SERVER_WORKSPACE_ID',
    new Set(['00000000-0000-4000-8000-000000000001']),
  ],
  ['AGENT_PRINCIPAL_ID', new Set(['svc_local'])],
  ['SERVICE_ACCOUNT_ID', new Set(['svc_local'])],
  ['AGENT_SERVER_SERVICE_ACCOUNT_ID', new Set(['svc_local'])],
]);

// Former name-only exemptions stay on the scan path. Known recorder scope
// names also bypass the historical short-value optimization so poisoned
// values such as "prod" or "svc" cannot evade the exact-value classes above.
const ENVIRONMENT_NAMES_WITH_REQUIRED_SCAN = new Set([
  ...SAFE_ENVIRONMENT_VALUES.keys(),
  'PATH',
  'PWD',
  'OLDPWD',
  'HOME',
  'SHELL',
  'TERM',
  'LANG',
  'TZ',
  'SERVICE_REVISION',
]);

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
  'member',
  'provenance',
  'tool_identity_capture_status',
  'response_observed',
]);

const RUN_EVENT_PAYLOAD_EXACT_VALUES = new Map([
  ['provenance', new Set(['server_authorized_team_mcp_catalog'])],
  ['tool_identity_capture_status', new Set(['present'])],
  ['response_observed', new Set([true, false])],
]);
const RUN_EVENT_NUMERIC_METRIC_KEYS = new Set([
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'context_window_max_tokens',
  'context_window_used_tokens',
]);

export class RecordingSecretError extends Error {
  constructor(path, reason = 'sensitive_recording_field') {
    super(`recording_secret_detected:${reason}:${path}`);
    this.name = 'RecordingSecretError';
    this.code = 'recording_secret_detected';
    this.path = path;
  }
}

/** Create a shared collector for recording sanitizer audit mode. */
export function createRecordingSanitizerAudit() {
  const hits = new Map();
  return {
    add(reason, path) {
      const key = `${reason}\u0000${path}`;
      if (!hits.has(key)) hits.set(key, { reason, path });
    },
    entries() {
      return [...hits.values()].sort((left, right) => {
        const pathOrder =
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
        if (pathOrder) return pathOrder;
        return left.reason < right.reason
          ? -1
          : left.reason > right.reason
            ? 1
            : 0;
      });
    },
  };
}

export function recordingSanitizerAuditEnabled(environment = process.env) {
  return environment.RECORDING_SANITIZER_AUDIT === '1';
}

/** Always throws in audit mode, including when no findings were collected. */
export function finalizeRecordingSanitizerAudit(collector) {
  throw new Error(JSON.stringify(collector?.entries?.() ?? []));
}

function report(collector, path, reason) {
  if (collector) {
    collector.add(reason, path);
    return true;
  }
  throw new RecordingSecretError(path, reason);
}

function cleanString(value, path, collector) {
  if (SECRET_VALUE.test(value)) {
    report(collector, path, 'sensitive_value');
    if (collector) return RECORDING_REDACTION_PLACEHOLDER;
  }
  return value
    .replace(CONTROL, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 4096);
}

/** Fail closed. No redaction is performed for a value that is not explicitly safe. */
export function sanitizeRecording(value, path = '$', options = {}) {
  const {
    allowKeys = new Set(),
    allowProviderSummary = false,
    allowExactValues = new Map(),
    collector,
  } = options;
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
      const exactValueAllowed =
        allowExactValues.get(key)?.has(item) ||
        allowExactValues.get(normalized)?.has(item);
      const providerSummaryAllowed =
        allowProviderSummary && (key === 'provider' || key === 'model');
      if (
        !keyAllowed &&
        !exactValueAllowed &&
        !providerSummaryAllowed &&
        SECRET_KEY.test(key)
      ) {
        const keyPath = `${path}.${key}`;
        report(collector, keyPath, 'sensitive_key');
        if (collector) {
          // Traverse the value to aggregate every finding, but never retain a
          // value under a key that was itself classified as sensitive.
          sanitizeRecording(item, keyPath, options);
          output[key] = RECORDING_REDACTION_PLACEHOLDER;
          continue;
        }
      }
      output[key] = sanitizeRecording(item, `${path}.${key}`, options);
    }
    return output;
  }
  if (typeof value === 'string') return cleanString(value, path, collector);
  if (
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  )
    return value;
  report(collector, path, 'unsupported_value');
  return RECORDING_REDACTION_PLACEHOLDER;
}

/** Project run_events.payload before the general scanner sees it. */
export function sanitizeRunEventPayload(
  payload,
  path = '$.payload',
  options = {},
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    report(options.collector, path, 'run_event_payload_shape');
    return RECORDING_REDACTION_PLACEHOLDER;
  }
  const projected = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!RUN_EVENT_PAYLOAD_KEYS.has(key)) {
      report(options.collector, `${path}.${key}`, 'run_event_payload_key');
    }
    const exactValues = RUN_EVENT_PAYLOAD_EXACT_VALUES.get(key);
    const invalidNumericMetric =
      RUN_EVENT_NUMERIC_METRIC_KEYS.has(key) &&
      (!Number.isSafeInteger(value) || value < 0);
    if ((exactValues && !exactValues.has(value)) || invalidNumericMetric) {
      const valuePath = `${path}.${key}`;
      report(options.collector, valuePath, 'run_event_payload_value');
      projected[key] = RECORDING_REDACTION_PLACEHOLDER;
      continue;
    }
    projected[key] = value;
  }
  return sanitizeRecording(projected, path, {
    allowKeys: RUN_EVENT_PAYLOAD_KEYS,
    ...options,
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

export function scanSecretText(value, path = '$', options = {}) {
  sanitizeRecording(value, path, options);
  return true;
}

function environmentSearchText(value) {
  const chunks = [];
  const visit = (entry) => {
    if (entry instanceof Date) {
      chunks.push(entry.toISOString());
      return;
    }
    if (typeof entry === 'string') {
      chunks.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    if (entry && typeof entry === 'object') {
      for (const [key, item] of Object.entries(entry)) {
        chunks.push(key);
        visit(item);
      }
      return;
    }
    if (entry !== undefined && entry !== null) chunks.push(String(entry));
  };
  visit(value);
  return chunks.join('\u0000');
}

export function assertNoEnvironmentValues(
  value,
  environment = process.env,
  options = {},
) {
  let serialized;
  if (options.collector) serialized = environmentSearchText(value);
  else serialized = stableStringify(value);
  const names = Object.keys(environment);
  if (options.collector) names.sort();
  for (const name of names) {
    const candidate = environment[name];
    if (!candidate) continue;
    const safeValues = SAFE_ENVIRONMENT_VALUES.get(name);
    if (safeValues?.has(candidate)) continue;
    if (candidate.length < 8 && !ENVIRONMENT_NAMES_WITH_REQUIRED_SCAN.has(name))
      continue;
    if (serialized.includes(candidate)) {
      const path = `$env.${name}`;
      if (options.collector)
        report(options.collector, path, 'environment_value');
      else throw new RecordingSecretError(path, 'environment_value');
    }
  }
  return true;
}
