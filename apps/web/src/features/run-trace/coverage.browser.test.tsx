import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import parallelRecording from '@/test-support/fixtures/product-recordings/parallel-success.json';
import reworkRecording from '@/test-support/fixtures/product-recordings/rework-once.json';
import { RunTrace } from './run-trace-view';
import { parseRecordedTrace } from '@/test-support/run-trace-recording-test-helpers';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps MCP-only coverage disclosure present across views and selection', async () => {
  for (const recording of [parallelRecording, reworkRecording]) {
    const trace = parseRecordedTrace(recording);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<RunTrace trace={trace} />);
      });

      const coverage = host.querySelector<HTMLElement>(
        '[data-testid="trace-coverage-disclosure"]',
      );
      expect(coverage).not.toBeNull();
      if (!coverage) continue;
      expect(trace.coverage.completeness).toBe('mcp_only');
      expect(coverage.textContent).toContain('MCP-only');
      expect(coverage.textContent?.toLowerCase()).toContain(
        'mcp dispatch and confirmation',
      );
      for (const excluded of trace.coverage.excludedExecution) {
        expect(coverage.textContent?.toLowerCase()).toContain(
          excluded.replaceAll('_', ' '),
        );
      }

      const attempt = host.querySelector<HTMLButtonElement>(
        '[data-testid="trace-attempt"]',
      );
      expect(attempt).not.toBeNull();
      await act(async () => {
        attempt?.focus();
        attempt?.click();
      });
      expect(
        host.querySelector('[data-testid="trace-coverage-disclosure"]'),
      ).toBe(coverage);

      const eventsTab = [
        ...host.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) => button.textContent?.trim() === 'MCP Activity');
      expect(eventsTab).toBeDefined();
      await act(async () => eventsTab?.click());
      expect(
        host.querySelector('[data-testid="trace-coverage-disclosure"]'),
      ).toBe(coverage);
      expect(coverage.textContent).toContain('MCP-only');
      for (const excluded of trace.coverage.excludedExecution) {
        expect(coverage.textContent?.toLowerCase()).toContain(
          excluded.replaceAll('_', ' '),
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
});
