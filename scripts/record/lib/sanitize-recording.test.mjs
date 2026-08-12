import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  assertNoEnvironmentValues,
  createRecordingSanitizerAudit,
  finalizeRecordingSanitizerAudit,
  RecordingSecretError,
  RUN_EVENT_PAYLOAD_KEYS,
  sanitizeRecording,
  sanitizeRunEventPayload,
} from './sanitize-recording.mjs';

test('allows exact public environment fixture values', () => {
  const safeClasses = {
    AGENT_PRINCIPAL_TYPE: ['service_account'],
    NODE_ENV: ['development', 'test', 'production'],
    PASEO_PROVIDER: ['opencode', 'claude', 'codex'],
    PASEO_MODEL: ['opencode-go/deepseek-v4-flash'],
    AGENT_TENANT_ID: ['tenant_local'],
    AGENT_SERVER_TENANT_ID: ['tenant_local'],
    AGENT_WORKSPACE_ID: ['00000000-0000-4000-8000-000000000001'],
    AGENT_SERVER_WORKSPACE_ID: ['00000000-0000-4000-8000-000000000001'],
    AGENT_PRINCIPAL_ID: ['svc_local'],
    SERVICE_ACCOUNT_ID: ['svc_local'],
    AGENT_SERVER_SERVICE_ACCOUNT_ID: ['svc_local'],
  };

  for (const [name, candidates] of Object.entries(safeClasses)) {
    for (const candidate of candidates) {
      assert.doesNotThrow(
        () =>
          assertNoEnvironmentValues(
            { value: candidate },
            { [name]: candidate },
          ),
        `${name}=${candidate}`,
      );
    }
  }
});

test('rejects poisoned known environment classes', () => {
  const cases = [
    ['AGENT_PRINCIPAL_TYPE', 'user'],
    ['PASEO_PROVIDER', 'unsafe-provider'],
    ['PASEO_MODEL', 'opencode-go/glm-5.2'],
    ['NODE_ENV', 'staging'],
  ];

  for (const [name, candidate] of cases) {
    assert.throws(
      () =>
        assertNoEnvironmentValues({ value: candidate }, { [name]: candidate }),
      /recording_secret_detected:environment_value/,
      name,
    );
  }
});

test('rejects paths and source revisions instead of exempting their names', () => {
  for (const [name, candidate] of [
    ['PATH', '/Users/fanye/bin'],
    ['PWD', '/Volumes/AgentsWorkspace'],
    ['OLDPWD', '/private/var/tmp/previous'],
    ['HOME', '/Users/fanye'],
    ['SHELL', '/bin/zsh'],
    ['TERM', 'xterm-256color'],
    ['LANG', 'en_US.UTF-8'],
    ['TZ', 'Asia/Shanghai'],
    ['SERVICE_REVISION', 'revision-20260813'],
  ]) {
    assert.throws(
      () =>
        assertNoEnvironmentValues({ value: candidate }, { [name]: candidate }),
      /recording_secret_detected:environment_value/,
      name,
    );
  }
});

test('rejects poisoned AGENT_SERVER scope aliases', () => {
  for (const [name, candidate] of [
    ['AGENT_SERVER_TENANT_ID', 'tenant_other'],
    ['AGENT_SERVER_WORKSPACE_ID', '00000000-0000-4000-8000-000000000002'],
    ['AGENT_SERVER_SERVICE_ACCOUNT_ID', 'svc_other'],
  ]) {
    assert.throws(
      () =>
        assertNoEnvironmentValues({ value: candidate }, { [name]: candidate }),
      /recording_secret_detected:environment_value/,
      name,
    );
  }
});

test('continues rejecting token and database URL values', () => {
  const token = 'token-local-dev';
  const databaseUrl = 'postgresql://postgres:password@127.0.0.1:5432/postgres';

  assert.throws(
    () =>
      assertNoEnvironmentValues(
        { token },
        { AGENT_SERVER_SERVICE_TOKEN: token },
      ),
    /recording_secret_detected:environment_value/,
  );
  assert.throws(
    () =>
      assertNoEnvironmentValues({ databaseUrl }, { DATABASE_URL: databaseUrl }),
    /recording_secret_detected:environment_value/,
  );
});

test('audit mode aggregates every finding without retaining values', () => {
  const audit = createRecordingSanitizerAudit();
  const highEntropy = 'f3b8c0e1d9a74f26b5c8e2a1d4f60793';

  sanitizeRecording(
    {
      authorization: 'Bearer abcdefghijklmnop',
      nested: { password: 'secret=do-not-record' },
      unsupported: Symbol('unsupported'),
    },
    '$.trace',
    { collector: audit },
  );
  sanitizeRunEventPayload(
    {
      event: 'tool_call',
      unknown_field: { detail: 'still traverse this value' },
    },
    '$.payload',
    { collector: audit },
  );
  sanitizeRunEventPayload([], '$.bad_payload', { collector: audit });
  assertNoEnvironmentValues(
    { marker: highEntropy },
    { CAPTURE_HIGH_ENTROPY: highEntropy },
    { collector: audit },
  );

  const findings = audit.entries();
  assert.deepEqual(findings, [
    { reason: 'run_event_payload_shape', path: '$.bad_payload' },
    { reason: 'run_event_payload_key', path: '$.payload.unknown_field' },
    { reason: 'sensitive_key', path: '$.trace.authorization' },
    { reason: 'sensitive_value', path: '$.trace.authorization' },
    { reason: 'sensitive_key', path: '$.trace.nested.password' },
    { reason: 'sensitive_value', path: '$.trace.nested.password' },
    { reason: 'unsupported_value', path: '$.trace.unsupported' },
    { reason: 'environment_value', path: '$env.CAPTURE_HIGH_ENTROPY' },
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes('abcdefghijklmnop'), false);
  assert.equal(serialized.includes(highEntropy), false);
});

test('audit finalization always throws deterministic JSON, including empty findings', () => {
  assert.throws(
    () => finalizeRecordingSanitizerAudit(createRecordingSanitizerAudit()),
    (error) => error instanceof Error && error.message === '[]',
  );

  const audit = createRecordingSanitizerAudit();
  audit.add('sensitive_value', '$.token');
  assert.throws(
    () => finalizeRecordingSanitizerAudit(audit),
    (error) =>
      error instanceof Error &&
      error.message === '[{"reason":"sensitive_value","path":"$.token"}]',
  );
});

test('normal sanitizer mode remains fail-fast', () => {
  assert.throws(
    () => sanitizeRecording({ token: 'token=do-not-record' }),
    (error) =>
      error instanceof RecordingSecretError &&
      error.reason === undefined &&
      error.path === '$.token',
  );
  assert.throws(
    () => sanitizeRunEventPayload({ unknown_field: true }),
    /recording_secret_detected:run_event_payload_key:\$\.payload\.unknown_field/,
  );
});

test('allows the canonical run-event identity domains and numeric usage metrics', () => {
  const payload = {
    provenance: 'server_authorized_team_mcp_catalog',
    tool_identity_capture_status: 'present',
    response_observed: true,
    input_tokens: 12,
    cached_input_tokens: 3,
    output_tokens: 4,
    context_window_max_tokens: 1000,
    context_window_used_tokens: 250,
  };

  assert.deepEqual(sanitizeRunEventPayload(payload), payload);
  assert.deepEqual(sanitizeRunEventPayload({ response_observed: false }), {
    response_observed: false,
  });
  assert.deepEqual(
    sanitizeRecording({ payload }, '$.db.run_events', {
      allowKeys: RUN_EVENT_PAYLOAD_KEYS,
    }),
    { payload },
  );
});

test('rejects poisoned run-event identity domains without exposing values', () => {
  const cases = [
    ['provenance', 'untrusted_catalog'],
    ['tool_identity_capture_status', 'missing'],
    ['response_observed', 'true'],
  ];

  for (const [key, value] of cases) {
    assert.throws(
      () => sanitizeRunEventPayload({ [key]: value }),
      (error) =>
        error instanceof RecordingSecretError &&
        error.message ===
          `recording_secret_detected:run_event_payload_value:$.payload.${key}`,
      key,
    );
  }

  const audit = createRecordingSanitizerAudit();
  for (const [key, value] of cases)
    sanitizeRunEventPayload({ [key]: value }, '$.payload', {
      collector: audit,
    });
  assert.deepEqual(audit.entries(), [
    { reason: 'run_event_payload_value', path: '$.payload.provenance' },
    {
      reason: 'run_event_payload_value',
      path: '$.payload.response_observed',
    },
    {
      reason: 'run_event_payload_value',
      path: '$.payload.tool_identity_capture_status',
    },
  ]);
  const serialized = JSON.stringify(audit.entries());
  assert.equal(serialized.includes('untrusted_catalog'), false);
  assert.equal(serialized.includes('missing'), false);
  assert.equal(serialized.includes('true'), false);
});

test('rejects non-numeric or negative run-event usage metrics', () => {
  for (const [key, value] of [
    ['input_tokens', '12'],
    ['cached_input_tokens', -1],
    ['output_tokens', 1.5],
    ['context_window_max_tokens', Number.NaN],
    ['context_window_used_tokens', Number.POSITIVE_INFINITY],
  ]) {
    assert.throws(
      () => sanitizeRunEventPayload({ [key]: value }),
      (error) =>
        error instanceof RecordingSecretError &&
        error.message ===
          `recording_secret_detected:run_event_payload_value:$.payload.${key}`,
      key,
    );
  }
});

test('allows only the exact manifest provider_run value', () => {
  const allowExactValues = new Map([['provider_run', new Set(['real'])]]);
  assert.deepEqual(
    sanitizeRecording({ provider_run: 'real' }, '$.manifest', {
      allowExactValues,
    }),
    { provider_run: 'real' },
  );

  assert.throws(
    () =>
      sanitizeRecording({ provider_run: 'fake' }, '$.manifest', {
        allowExactValues,
      }),
    /recording_secret_detected:sensitive_key:\$\.manifest\.provider_run/,
  );

  const audit = createRecordingSanitizerAudit();
  sanitizeRecording({ provider_run: 'fake' }, '$.manifest', {
    allowExactValues,
    collector: audit,
  });
  assert.deepEqual(audit.entries(), [
    { reason: 'sensitive_key', path: '$.manifest.provider_run' },
  ]);
  assert.equal(JSON.stringify(audit.entries()).includes('fake'), false);
});

test('audit finalization precedes checksum validation and rename', async () => {
  const source = await readFile(
    new URL('./capture-product-run.mjs', import.meta.url),
    'utf8',
  );
  const finalize = source.indexOf(
    'if (audit) finalizeRecordingSanitizerAudit(audit);',
  );
  const checksums = source.indexOf('const checksumFiles =', finalize);
  const rename = source.indexOf('await rename(temporary, target);', finalize);
  assert.ok(finalize >= 0);
  assert.ok(checksums > finalize);
  assert.ok(rename > finalize);
});
