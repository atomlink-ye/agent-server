import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PROVIDER_SMOKE_ENVIRONMENT_NAMES,
  PROVIDER_SMOKE_MODEL,
  PROVIDER_SMOKE_PROVIDER,
} from './provider-smoke-contract.mjs';

const guardPath = fileURLToPath(
  new URL('../ci/check-provider-smoke-env.mjs', import.meta.url),
);
const baseEnvironment = { ...process.env };
for (const name of PROVIDER_SMOKE_ENVIRONMENT_NAMES)
  delete baseEnvironment[name];

function runGuard(values = {}) {
  return spawnSync(process.execPath, [guardPath], {
    env: { ...baseEnvironment, ...values },
    encoding: 'utf8',
  });
}

describe('provider smoke contract', () => {
  it('pins the authenticated provider and model', () => {
    expect(PROVIDER_SMOKE_PROVIDER).toBe('opencode');
    expect(PROVIDER_SMOKE_MODEL).toBe('opencode-go/deepseek-v4-flash');
    expect(PROVIDER_SMOKE_ENVIRONMENT_NAMES).toEqual([
      'OPENCODE_GO_API_KEY',
      'PASEO_PROVIDER',
      'PASEO_MODEL',
    ]);
  });

  it('skips with false output when all credentials are absent', () => {
    const result = runGuard();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('should_run=false\n');
    expect(result.stderr).toBe('');
  });

  it.each([
    { OPENCODE_GO_API_KEY: 'dummy-key' },
    {
      OPENCODE_GO_API_KEY: 'dummy-key',
      PASEO_PROVIDER: 'claude',
      PASEO_MODEL: PROVIDER_SMOKE_MODEL,
    },
  ])('rejects partial or incorrectly pinned values %#', (values) => {
    const result = runGuard(values);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('dummy-key');
  });

  it('accepts the complete pinned contract without printing the key', () => {
    const result = runGuard({
      OPENCODE_GO_API_KEY: 'dummy-key',
      PASEO_PROVIDER: PROVIDER_SMOKE_PROVIDER,
      PASEO_MODEL: PROVIDER_SMOKE_MODEL,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('should_run=true\n');
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toContain('dummy-key');
  });
});
