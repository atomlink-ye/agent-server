import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import {
  formatWorkListTime,
  latestRunSummary,
  productStatePresentation,
} from '../work/components/work-presentation';
import {
  deriveObserveAggregate,
  type ObserveAggregate,
} from './observe-aggregate';
import { useObserveRunMetrics } from './queries/use-observe-run-metrics';
import { useObserveRoster } from './queries/use-observe-roster';
import {
  useObserveEntries,
  type ObserveEntry,
} from './queries/use-observe-entries';
import { stripMarkdownPreview } from './strip-markdown-preview';

export const STATUS_OPTIONS: readonly WorkListItem['product_state'][] = [
  'running',
  'needs_you',
  'complete',
  'problem',
  'not_captured',
];

export function ObservePane({
  onAggregateChange,
}: {
  /** Lets ObservePage render an aggregate dashboard for the currently
   * filtered list without a second, duplicate fetch of the same traces --
   * ObservePane already owns the single fetch of entries + per-Run
   * metrics. */
  readonly onAggregateChange?: (
    aggregate: ObserveAggregate,
    resolving: boolean,
  ) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { status, entries, refresh, autoRefresh, setAutoRefresh } =
    useObserveEntries();
  const roster = useObserveRoster();

  const traced = useMemo(
    () => entries.filter((entry) => entry.latest_run_summary !== null),
    [entries],
  );
  const { metrics, resolving } = useObserveRunMetrics(traced);

  const selectedWorkId = searchParams.get('work');
  const agentFilter = searchParams.get('agent');
  const statusFilter = searchParams.get('status');

  const filtered = useMemo(() => {
    return traced.filter((entry) => {
      if (statusFilter && entry.product_state !== statusFilter) return false;
      if (agentFilter) {
        const agent = roster.agents.find(
          (candidate) => candidate.id === agentFilter,
        );
        if (!agent?.workDefinitionIds.has(entry.definition_id)) return false;
      }
      return true;
    });
  }, [traced, statusFilter, agentFilter, roster.agents]);

  useEffect(() => {
    onAggregateChange?.(deriveObserveAggregate(filtered, metrics), resolving);
  }, [filtered, metrics, resolving, onAggregateChange]);

  const updateFilter = (key: 'agent' | 'status', value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const controlsDisabled = status === 'unavailable' || status === 'error';

  return (
    <aside className="sidebar observe-pane" aria-label="Observe navigation">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Agent Observability</span>
          <h1>Observe</h1>
        </div>
        <div className="work-pane-actions">
          {status === 'ready' ? (
            <span
              className="pane-count"
              aria-label={`${filtered.length} traces`}
            >
              {filtered.length}
            </span>
          ) : null}
          <button
            className="pane-refresh"
            type="button"
            aria-label="Refresh traces"
            disabled={status === 'loading' || controlsDisabled}
            onClick={refresh}
          >
            ↻
          </button>
        </div>
      </div>
      <p className="observe-pane-subhead">
        Backend traces for every agent turn
      </p>
      <div className="observe-filters">
        <label>
          Agent
          <select
            aria-label="Filter by Agent"
            disabled={controlsDisabled}
            value={agentFilter ?? ''}
            onChange={(event) => updateFilter('agent', event.target.value)}
          >
            <option value="">All agents</option>
            {roster.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Filter by Status"
            disabled={controlsDisabled}
            value={statusFilter ?? ''}
            onChange={(event) => updateFilter('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((state) => (
              <option key={state} value={state}>
                {productStatePresentation(state).label}
              </option>
            ))}
          </select>
        </label>
        <label className="observe-auto-refresh">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto refresh
        </label>
      </div>

      {filtered.length === 0 && status === 'loading' ? (
        <p
          className="pane-placeholder"
          data-testid="observe-list-loading"
          role="status"
          aria-live="polite"
        >
          Getting your traces…
        </p>
      ) : null}
      {filtered.length === 0 && status === 'unavailable' ? (
        <div
          className="pane-placeholder"
          data-testid="observe-list-unavailable"
          role="status"
        >
          <p className="eyebrow">Observe isn&apos;t available here</p>
          <p>This workspace doesn&apos;t currently offer Work execution.</p>
        </div>
      ) : null}
      {filtered.length === 0 && status === 'error' ? (
        <div
          className="pane-placeholder"
          data-testid="observe-list-error"
          role="alert"
        >
          <p className="eyebrow">Couldn&apos;t load traces</p>
          <p>This is a connection problem, not a statement about any Run.</p>
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}
      {filtered.length === 0 && status === 'ready' ? (
        <div
          className="pane-placeholder"
          data-testid="observe-list-empty"
          role="status"
        >
          <p>No traced Run matches the current filters.</p>
        </div>
      ) : null}
      {filtered.length > 0 ? (
        <ul
          className="work-list"
          aria-label="Traces"
          data-testid="observe-list"
        >
          {filtered.map((entry) => (
            <ObserveListRow
              key={entry.id}
              entry={entry}
              agentNames={metrics.get(entry.id)?.agentNames ?? []}
              runtimeModels={entry.latest_run_summary?.runtime_models ?? []}
              durationMs={metrics.get(entry.id)?.durationMs ?? null}
              selected={selectedWorkId === entry.id}
              search={searchParams}
            />
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function ObserveListRow({
  entry,
  agentNames,
  runtimeModels,
  durationMs,
  selected,
  search,
}: {
  readonly entry: ObserveEntry;
  readonly agentNames: readonly string[];
  readonly runtimeModels: readonly string[];
  readonly durationMs: number | null;
  readonly selected: boolean;
  readonly search: URLSearchParams;
}) {
  const stateView = productStatePresentation(entry.product_state);
  const runId = entry.latest_run_summary!.id;
  const next = new URLSearchParams(search);
  next.set('work', entry.id);
  next.set('run', runId);

  return (
    <li>
      <Link
        aria-current={selected ? 'page' : undefined}
        className="work-list-item"
        to={{ search: next.toString() }}
      >
        <span className="work-list-mark" aria-hidden="true">
          {entry.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="work-list-copy">
          <strong>{entry.title}</strong>
          <span className="work-list-description">
            {stripMarkdownPreview(latestRunSummary(entry))}
          </span>
          <span className="observe-row-meta">
            <span className="observe-row-timestamp">
              {formatWorkListTime(entry.updated_at)}
            </span>
            {durationMs !== null ? (
              <span className="observe-row-duration">
                {formatRowDurationMs(durationMs)}
              </span>
            ) : null}
          </span>
          {agentNames.length ? (
            <span className="observe-agent-chip">{agentNames.join(', ')}</span>
          ) : null}
          {runtimeModels.length ? (
            <span className="observe-agent-chip">
              Model: {runtimeModels.join(', ')}
            </span>
          ) : null}
        </span>
        <span
          className="work-list-status"
          data-product-state={entry.product_state}
        >
          <span
            aria-hidden="true"
            className={`work-status-dot work-status-dot--${entry.product_state}`}
          />
          {stateView.label}
        </span>
      </Link>
    </li>
  );
}

/** A compact row-level duration label; mirrors ObserveDetail's headline
 * formatting but stays terse for the navigation index. */
function formatRowDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default ObservePane;
