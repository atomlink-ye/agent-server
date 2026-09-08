import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import type { ObserveEntry } from './queries/use-observe-entries';
import type { RunMetricsByEntry } from './queries/use-observe-run-metrics';

export type ObserveAggregate = {
  readonly traceCount: number;
  readonly statusCounts: ReadonlyMap<WorkListItem['product_state'], number>;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCachedInputTokens: number;
  readonly hasTokenData: boolean;
  /** cachedInputTokens / (cachedInputTokens + inputTokens), or null when
   * there is not enough data to derive a meaningful ratio. */
  readonly cacheHitRate: number | null;
  readonly totalCostUsd: number;
  readonly hasCostData: boolean;
  readonly avgDurationMs: number | null;
  readonly medianDurationMs: number | null;
};

// Aggregates over the currently *filtered* list of traced Work entries, using
// the same per-Run metrics ObserveListRow already resolves via
// useObserveRunMetrics -- no separate backend aggregation exists, so this is
// purely a client-side reduction over already-fetched data.
export function deriveObserveAggregate(
  entries: readonly ObserveEntry[],
  metrics: RunMetricsByEntry,
): ObserveAggregate {
  const statusCounts = new Map<WorkListItem['product_state'], number>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedInputTokens = 0;
  let hasTokenData = false;
  let totalCostUsd = 0;
  let hasCostData = false;
  const durations: number[] = [];

  for (const entry of entries) {
    statusCounts.set(
      entry.product_state,
      (statusCounts.get(entry.product_state) ?? 0) + 1,
    );

    const entryMetrics = metrics.get(entry.id);
    if (!entryMetrics) continue;

    if (entryMetrics.hasTokenData) {
      totalInputTokens += entryMetrics.inputTokens;
      totalOutputTokens += entryMetrics.outputTokens;
      totalCachedInputTokens += entryMetrics.cachedInputTokens;
      hasTokenData = true;
    }
    if (entryMetrics.hasCostData) {
      totalCostUsd += entryMetrics.costUsd;
      hasCostData = true;
    }
    if (entryMetrics.durationMs !== null)
      durations.push(entryMetrics.durationMs);
  }

  const cacheHitDenominator = totalCachedInputTokens + totalInputTokens;
  const cacheHitRate =
    cacheHitDenominator > 0
      ? totalCachedInputTokens / cacheHitDenominator
      : null;

  return {
    traceCount: entries.length,
    statusCounts,
    totalInputTokens,
    totalOutputTokens,
    totalCachedInputTokens,
    hasTokenData,
    cacheHitRate,
    totalCostUsd,
    hasCostData,
    avgDurationMs: average(durations),
    medianDurationMs: median(durations),
  };
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
