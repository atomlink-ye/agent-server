import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COMPOSITION_ADMISSION_TIMEOUT_ENV,
  DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS,
  MAX_COMPOSITION_ADMISSION_TIMEOUT_MS,
  resolveCompositionAdmissionTimeoutMs,
} from './composition-single-agent.mjs';

const compositionSmokeSource = readFileSync(
  new URL('./composition-single-agent.mjs', import.meta.url),
  'utf8',
);

describe('composition smoke admission timeout', () => {
  it('uses the safe default when the override is absent or blank', () => {
    expect(resolveCompositionAdmissionTimeoutMs({})).toBe(
      DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS,
    );
    expect(
      resolveCompositionAdmissionTimeoutMs({
        [COMPOSITION_ADMISSION_TIMEOUT_ENV]: ' \t',
      }),
    ).toBe(DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS);
    expect(DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS).toBeGreaterThanOrEqual(
      60_000,
    );
  });

  it('accepts a positive bounded environment override', () => {
    expect(
      resolveCompositionAdmissionTimeoutMs({
        [COMPOSITION_ADMISSION_TIMEOUT_ENV]: '120000',
      }),
    ).toBe(120_000);
    expect(
      resolveCompositionAdmissionTimeoutMs({
        [COMPOSITION_ADMISSION_TIMEOUT_ENV]: String(
          MAX_COMPOSITION_ADMISSION_TIMEOUT_MS,
        ),
      }),
    ).toBe(MAX_COMPOSITION_ADMISSION_TIMEOUT_MS);
  });

  it.each(['abc', '0', '-1', '1.5', '600001'])(
    'rejects invalid or out-of-bounds override %j',
    (value) => {
      expect(() =>
        resolveCompositionAdmissionTimeoutMs({
          [COMPOSITION_ADMISSION_TIMEOUT_ENV]: value,
        }),
      ).toThrow(COMPOSITION_ADMISSION_TIMEOUT_ENV);
    },
  );

  it('uses the composition timeout for both WorkRun admission requests', () => {
    const admissionRequests = compositionSmokeSource.match(
      /const started = await request\([\s\S]*?expectedStatus: 202,[\s\S]*?\n    \}\);/gu,
    );
    expect(admissionRequests).toHaveLength(2);
    for (const request of admissionRequests ?? []) {
      expect(request).toContain(
        'requestTimeoutMs: compositionAdmissionTimeoutMs',
      );
      expect(request).not.toContain('AbortSignal.timeout(10_000)');
    }
  });
});
