import type { RunUsage } from '../../domain/runs/run.js';

export type PaseoFinishStatus = 'idle' | 'error' | 'permission' | 'timeout';

export type RuntimeFinishStatus = 'failed' | 'timed_out' | null;

export function normalizeUsage(
  usage: RunUsage | null | undefined,
): RunUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const output: Record<string, number> = {};
  for (const key of [
    'inputTokens',
    'cachedInputTokens',
    'outputTokens',
    'contextWindowMaxTokens',
    'contextWindowUsedTokens',
  ] as const) {
    const value = usage[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0)
      output[key] = value;
  }
  if (
    usage.totalCostUsd !== undefined &&
    Number.isFinite(usage.totalCostUsd) &&
    usage.totalCostUsd >= 0
  )
    output.totalCostUsd = usage.totalCostUsd;
  return Object.keys(output).length ? output : null;
}

export function hasPositiveModelUsage(
  usage: RunUsage | null | undefined,
): boolean {
  return (
    (typeof usage?.inputTokens === 'number' &&
      Number.isFinite(usage.inputTokens) &&
      usage.inputTokens > 0) ||
    (typeof usage?.cachedInputTokens === 'number' &&
      Number.isFinite(usage.cachedInputTokens) &&
      usage.cachedInputTokens > 0) ||
    (typeof usage?.outputTokens === 'number' &&
      Number.isFinite(usage.outputTokens) &&
      usage.outputTokens > 0) ||
    (typeof usage?.totalCostUsd === 'number' &&
      Number.isFinite(usage.totalCostUsd) &&
      usage.totalCostUsd > 0)
  );
}

export function mapPaseoFinishStatus(
  status: PaseoFinishStatus,
): RuntimeFinishStatus {
  if (status === 'timeout') {
    return 'timed_out';
  }
  if (status === 'idle') return null;
  return 'failed';
}
