import { describe, expect, it } from 'vitest';

import {
  CANARY_READINESS_TIMEOUT_MS,
  CORE_READINESS_TIMEOUT_MS,
  RUNTIME_READINESS_TIMEOUT_MS,
  canaryReadinessTimeout,
  runtimeReadinessTimeout,
} from './readiness-timeout.js';

describe('readiness timeout selection', () => {
  it('uses the runtime default and keeps core readiness independent', () => {
    expect(runtimeReadinessTimeout({})).toBe(RUNTIME_READINESS_TIMEOUT_MS);
    expect(CORE_READINESS_TIMEOUT_MS).toBe(30_000);
    expect(canaryReadinessTimeout({})).toBe(CANARY_READINESS_TIMEOUT_MS);
  });

  it('prefers a positive CANARY timeout over the Paseo timeout', () => {
    const environment = {
      CANARY_READY_TIMEOUT_MS: '120000',
      PASEO_DAEMON_STARTUP_TIMEOUT_MS: '240000',
    };
    expect(runtimeReadinessTimeout(environment)).toBe(120_000);
    expect(canaryReadinessTimeout(environment)).toBe(120_000);
  });

  it('uses the positive Paseo timeout when no Canary timeout is set', () => {
    expect(
      runtimeReadinessTimeout({ PASEO_DAEMON_STARTUP_TIMEOUT_MS: '90000' }),
    ).toBe(90_000);
  });

  it.each([
    ['0', 'CANARY_READY_TIMEOUT_MS'],
    ['12ms', 'CANARY_READY_TIMEOUT_MS'],
    ['-1', 'PASEO_DAEMON_STARTUP_TIMEOUT_MS'],
    [String(Number.MAX_SAFE_INTEGER) + '0', 'PASEO_DAEMON_STARTUP_TIMEOUT_MS'],
  ])('rejects invalid %s timeout values', (value, name) => {
    expect(() => runtimeReadinessTimeout({ [name]: value })).toThrow(name);
  });
});
