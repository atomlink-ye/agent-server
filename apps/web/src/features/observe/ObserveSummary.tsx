import { productStatePresentation } from '../work/components/work-presentation';
import { useT } from '../../i18n';
import { STATUS_OPTIONS } from './ObservePane';
import type { ObserveAggregate } from './observe-aggregate';
import './observe.css';

/**
 * The dashboard shown in the main Observe area when no Run is selected --
 * an aggregate over the currently filtered list of traced Works, derived
 * client-side from the per-Run metrics ObservePane already resolves (see
 * ObservePane#onAggregateChange). Replaces the previous blank "Select a
 * Run" placeholder.
 */
export function ObserveSummary({
  aggregate,
  resolving,
}: {
  readonly aggregate: ObserveAggregate;
  readonly resolving: boolean;
}) {
  const t = useT();
  return (
    <section className="observe-summary" data-testid="observe-summary">
      <header className="observe-summary-header">
        <p className="observe-kicker">{t('observe.overview')}</p>
        <h1>{t('observe.tracedRuns')}</h1>
        <p className="observe-summary-subhead">
          {aggregate.traceCount === 0
            ? t('observe.empty')
            : t('observe.aggregateSummary', { count: aggregate.traceCount })}
        </p>
      </header>

      <div className="observe-metric-cards" data-testid="observe-summary-cards">
        <ObserveSummaryCard
          label={t('observe.traces')}
          value={String(aggregate.traceCount)}
        />
        <ObserveSummaryCard
          label={t('observe.totalCost')}
          value={
            aggregate.hasCostData ? formatCost(aggregate.totalCostUsd) : '—'
          }
          hint={
            aggregate.hasCostData
              ? undefined
              : resolving
                ? t('observe.loading')
                : t('observe.notTracked')
          }
        />
        <ObserveSummaryCard
          label={t('observe.tokens')}
          value={
            aggregate.hasTokenData
              ? (
                  aggregate.totalInputTokens + aggregate.totalOutputTokens
                ).toLocaleString()
              : '—'
          }
          hint={
            aggregate.hasTokenData
              ? undefined
              : resolving
                ? t('observe.loading')
                : t('observe.notCaptured')
          }
        />
        <ObserveSummaryCard
          label={t('observe.cacheHitRate')}
          value={
            aggregate.cacheHitRate === null
              ? '—'
              : formatPercent(aggregate.cacheHitRate)
          }
          hint={
            aggregate.cacheHitRate === null
              ? t('observe.notEnoughData')
              : undefined
          }
        />
        <ObserveSummaryCard
          label={t('observe.averageDuration')}
          value={
            aggregate.avgDurationMs === null
              ? '—'
              : formatDurationMs(aggregate.avgDurationMs)
          }
          hint={
            aggregate.avgDurationMs === null
              ? t('observe.notEnoughData')
              : undefined
          }
        />
        <ObserveSummaryCard
          label={t('observe.medianDuration')}
          value={
            aggregate.medianDurationMs === null
              ? '—'
              : formatDurationMs(aggregate.medianDurationMs)
          }
          hint={
            aggregate.medianDurationMs === null
              ? t('observe.notEnoughData')
              : undefined
          }
        />
      </div>

      <div
        className="observe-summary-status"
        data-testid="observe-summary-status"
      >
        <p className="observe-metric-card-label">{t('observe.byStatus')}</p>
        <ul className="observe-summary-status-list">
          {STATUS_OPTIONS.map((state) => {
            const count = aggregate.statusCounts.get(state) ?? 0;
            if (count === 0) return null;
            return (
              <li key={state}>
                <span
                  aria-hidden="true"
                  className={`work-status-dot work-status-dot--${state}`}
                />
                <span className="observe-summary-status-label">
                  {productStatePresentation(state).label}
                </span>
                <strong>{count}</strong>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function ObserveSummaryCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <div
      className="observe-metric-card"
      data-testid={`observe-summary-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <p className="observe-metric-card-value">{value}</p>
      <p className="observe-metric-card-label">{label}</p>
      {hint ? <p className="observe-metric-card-hint">{hint}</p> : null}
    </div>
  );
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Mirrors ObserveDetail's headline duration formatting. */
function formatDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default ObserveSummary;
