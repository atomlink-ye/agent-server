import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  assertNoEnvironmentValues,
  createRecordingSanitizerAudit,
  finalizeRecordingSanitizerAudit,
  RecordingSecretError,
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
