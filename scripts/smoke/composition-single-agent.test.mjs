import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COMPOSITION_ADMISSION_TIMEOUT_ENV,
  DEFAULT_COMPOSITION_ADMISSION_TIMEOUT_MS,
  MAX_COMPOSITION_ADMISSION_TIMEOUT_MS,
  classifyCompositionWorkRunState,
  collectCompositionAdmissionAbortDiagnostic,
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

  it('classifies a WorkRun that is still pending and unbound', () => {
    expect(
      classifyCompositionWorkRunState({
        summary: { id: 'run-1', bound_at: null },
      }),
    ).toEqual({
      state: 'pending_unbound',
      work_run_id: 'run-1',
      bound_at: null,
      product_state: null,
    });
  });

  it('classifies a bound WorkRun that is still running', () => {
    expect(
      classifyCompositionWorkRunState({
        summary: { id: 'run-2', bound_at: '2026-08-26T07:00:00.000Z' },
        detail: {
          work_run: {
            id: 'run-2',
            bound_at: '2026-08-26T07:00:00.000Z',
            product_state: 'running',
          },
        },
      }),
    ).toEqual({
      state: 'bound_running',
      work_run_id: 'run-2',
      bound_at: '2026-08-26T07:00:00.000Z',
      product_state: 'running',
    });
  });

  it.each(['complete', 'problem', 'not_captured'])(
    'classifies terminal product state %j',
    (productState) => {
      expect(
        classifyCompositionWorkRunState({
          detail: {
            work_run: {
              id: 'run-terminal',
              bound_at: '2026-08-26T07:00:00.000Z',
              product_state: productState,
            },
          },
        }),
      ).toMatchObject({
        state: 'terminal',
        work_run_id: 'run-terminal',
        product_state: productState,
      });
    },
  );

  it('collects a safe causal diagnostic after admission timeout', async () => {
    const calls = [];
    const diagnostic = await collectCompositionAdmissionAbortDiagnostic({
      workId: 'work-1',
      triggerRef: 'composition-single-scenario',
      error: { name: 'TimeoutError', message: 'private transport detail' },
      request: async (path) => {
        calls.push(path);
        if (path.includes('?'))
          return {
            work_runs: [
              {
                id: 'run-3',
                trigger_ref: 'composition-single-scenario',
                bound_at: '2026-08-26T07:00:00.000Z',
              },
            ],
          };
        return {
          work_run: {
            id: 'run-3',
            bound_at: '2026-08-26T07:00:00.000Z',
            product_state: 'running',
          },
        };
      },
    });

    expect(calls).toEqual([
      '/api/v1/works/work-1/runs?limit=100&order=created_desc',
      '/api/v1/works/work-1/runs/run-3',
    ]);
    expect(diagnostic).toEqual({
      work_id: 'work-1',
      admission_error: 'timeout',
      lookup: 'found',
      state: 'bound_running',
      work_run_id: 'run-3',
      bound_at: '2026-08-26T07:00:00.000Z',
      product_state: 'running',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private transport');
  });

  it('uses the composition timeout for both WorkRun admission requests', () => {
    const admissionRequests = compositionSmokeSource.match(
      /request\(`\/api\/v1\/works\/\$\{workId\}\/runs`,[\s\S]*?requestTimeoutMs: compositionAdmissionTimeoutMs,[\s\S]*?\n      \}\);/gu,
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
