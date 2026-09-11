import { useEffect, useState } from 'react';

import {
  loadSessionTranscripts,
  type SessionTranscriptsResponse,
} from '../../run-trace/run-trace-gateway';
import type { ObserveEntry } from './use-observe-entries';

export type ObserveRunMetrics = {
  readonly agentNames: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  /** Whether any usage entry reported token counts at all. */
  readonly hasTokenData: boolean;
  readonly costUsd: number;
  /** Whether any usage entry reported a non-null cost. */
  readonly hasCostData: boolean;
  /** Milliseconds spanned by the Run's captured entries, or null if fewer
   * than two distinct timestamps were captured. */
  readonly durationMs: number | null;
};

export type RunMetricsByEntry = ReadonlyMap<string, ObserveRunMetrics>;

const EMPTY_METRICS: ObserveRunMetrics = {
  agentNames: [],
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  hasTokenData: false,
  costUsd: 0,
  hasCostData: false,
  durationMs: null,
};

// The Work list carries no durable Agent identity per Work, and no
// aggregate cost/token/duration figures either, so this hook derives both
// from the same per-Run session-transcripts fetch the Trace detail view
// already relies on (see run-trace-gateway#loadSessionTranscripts), rather
// than adding a new backend aggregation endpoint.
export function useObserveRunMetrics(entries: readonly ObserveEntry[]): {
  readonly metrics: RunMetricsByEntry;
  readonly resolving: boolean;
} {
  const [metrics, setMetrics] = useState<RunMetricsByEntry>(new Map());
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    const pending = entries.filter(
      (entry) => entry.latest_run_summary !== null && !metrics.has(entry.id),
    );
    if (pending.length === 0) return;
    let active = true;
    setResolving(true);
    void Promise.all(
      pending.map(async (entry) => {
        const workRunId = entry.latest_run_summary!.id;
        try {
          const transcripts = await loadSessionTranscripts(entry.id, workRunId);
          return [entry.id, deriveMetrics(transcripts)] as const;
        } catch {
          return [entry.id, EMPTY_METRICS] as const;
        }
      }),
    ).then((resolved) => {
      if (!active) return;
      setMetrics((current) => {
        const next = new Map(current);
        for (const [workId, entryMetrics] of resolved)
          next.set(workId, entryMetrics);
        return next;
      });
      setResolving(false);
    });
    return () => {
      active = false;
    };
  }, [entries, metrics]);

  return { metrics, resolving };
}

function deriveMetrics(
  transcripts: SessionTranscriptsResponse,
): ObserveRunMetrics {
  const agentNames = transcripts.sessions.map((session) => session.label.name);

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let hasTokenData = false;
  let costUsd = 0;
  let hasCostData = false;
  let minTimestamp: number | null = null;
  let maxTimestamp: number | null = null;
  let distinctTimestamps = 0;
  const seenTimestamps = new Set<number>();

  for (const session of transcripts.sessions) {
    for (const entry of session.entries) {
      const at = Date.parse(entry.created_at);
      if (!Number.isNaN(at)) {
        if (!seenTimestamps.has(at)) {
          seenTimestamps.add(at);
          distinctTimestamps += 1;
        }
        minTimestamp = minTimestamp === null ? at : Math.min(minTimestamp, at);
        maxTimestamp = maxTimestamp === null ? at : Math.max(maxTimestamp, at);
      }

      if (entry.kind !== 'usage') continue;
      if (entry.input_tokens !== null) {
        inputTokens += entry.input_tokens;
        hasTokenData = true;
      }
      if (entry.output_tokens !== null) {
        outputTokens += entry.output_tokens;
        hasTokenData = true;
      }
      if (entry.cached_input_tokens !== null) {
        cachedInputTokens += entry.cached_input_tokens;
        hasTokenData = true;
      }
      if (entry.total_cost_usd !== null) {
        costUsd += entry.total_cost_usd;
        hasCostData = true;
      }
    }
  }

  const durationMs =
    distinctTimestamps >= 2 && minTimestamp !== null && maxTimestamp !== null
      ? maxTimestamp - minTimestamp
      : null;

  return {
    agentNames,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    hasTokenData,
    costUsd,
    hasCostData,
    durationMs,
  };
}
