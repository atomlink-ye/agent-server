import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertNoEnvironmentValues } from './sanitize-recording.mjs';

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
        () => assertNoEnvironmentValues({ value: candidate }, { [name]: candidate }),
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
