import {
  formatTimestamp,
  productStatePresentation,
  resultCaptureLabel,
} from '../work/components/work-presentation';
import { useWorkDetail } from '../work/queries/use-work-detail';
import { RunTrace } from '../run-trace/run-trace-view';
import { longestAttemptMs } from '../run-trace/selectors';
import type { NormalizedTrace } from '../run-trace/normalized';
import { useObserveRunTokens } from './queries/use-observe-run-tokens';
import { AssistantMarkdown } from '@/features/conversations/components/assistant-markdown';
import { useT } from '../../i18n';
import './observe.css';

export function ObserveDetail({
  workId,
  runId,
}: {
  readonly workId: string;
  readonly runId: string;
}) {
  const t = useT();
  const query = useWorkDetail({
    workId,
    selectedRunId: runId,
    preferCurrentDefinition: false,
    includeTrace: true,
  });
  const tokens = useObserveRunTokens(workId, runId);
  const detail = query.detail;

  if (query.status === 'loading') {
    return (
      <p className="work-detail-loading" aria-live="polite">
        {t('observe.loadingTrace')}
      </p>
    );
  }
  if (query.status === 'starting') {
    return (
      <p className="work-detail-loading" aria-live="polite">
        {t('observe.startingRun')}
      </p>
    );
  }
  if (query.status === 'error' || !detail || !detail.run || !detail.trace) {
    return (
      <section
        className="pane-placeholder"
        role="alert"
        data-testid="observe-detail-error"
      >
        <p className="eyebrow">{t('observe.loadTraceError')}</p>
        <p>{t('observe.selectedRunUnavailable')}</p>
      </section>
    );
  }

  const run = detail.run.work_run;
  const stateView = productStatePresentation(run.product_state);
  const live = run.product_state === 'running';

  return (
    <section className="observe-detail" data-testid="observe-detail">
      <header className="observe-detail-header">
        <div>
          <p className="observe-kicker">{t('observe.run')}</p>
          <h2>{run.id}</h2>
          <p className="observe-detail-timestamps">
            {t('observe.startedUpdated', {
              started: formatTimestamp(run.created_at),
              updated: formatTimestamp(run.updated_at),
            })}
          </p>
        </div>
        <span
          className={`observe-state-pill observe-state-pill--${run.product_state}`}
          data-testid="observe-detail-state"
        >
          {stateView.label}
        </span>
      </header>
      {run.result_summary ? (
        <div className="observe-detail-result">
          <AssistantMarkdown text={run.result_summary} />
        </div>
      ) : (
        <p className="observe-detail-result">
          {resultCaptureLabel(run.result_capture_status)}
        </p>
      )}
      <ObserveMetricCards trace={detail.trace} tokens={tokens} />
      <RunTrace live={live} trace={detail.trace} />
    </section>
  );
}

function ObserveMetricCards({
  trace,
  tokens,
}: {
  readonly trace: NormalizedTrace;
  readonly tokens: ReturnType<typeof useObserveRunTokens>;
}) {
  const t = useT();
  const durationMs = longestAttemptMs(trace);
  const tokensReady = tokens.status === 'ready' && tokens.totalTokens !== null;
  return (
    <div className="observe-metric-cards" data-testid="observe-metric-cards">
      <ObserveMetricCard
        label={t('observe.duration')}
        value={durationMs === null ? '—' : formatDurationMs(durationMs)}
        hint={durationMs === null ? t('observe.notCaptured') : undefined}
      />
      <ObserveMetricCard
        label={t('observe.inbox')}
        value={String(trace.messages.size)}
      />
      <ObserveMetricCard
        label={t('observe.tools')}
        value={String(trace.activities.length)}
      />
      <ObserveMetricCard
        label={t('observe.tokens')}
        value={tokensReady ? tokens.totalTokens!.toLocaleString() : '—'}
        hint={
          tokensReady
            ? undefined
            : tokens.status === 'loading'
              ? t('observe.loading')
              : t('observe.notCaptured')
        }
      />
    </div>
  );
}

function ObserveMetricCard({
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
      data-testid={`observe-metric-${label.toLowerCase()}`}
    >
      <p className="observe-metric-card-value">{value}</p>
      <p className="observe-metric-card-label">{label}</p>
      {hint ? <p className="observe-metric-card-hint">{hint}</p> : null}
    </div>
  );
}

/** Mirrors inspector.tsx's seconds formatting, but a headline card reads
 * better as minutes+seconds once a Run runs past a minute. */
function formatDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default ObserveDetail;
