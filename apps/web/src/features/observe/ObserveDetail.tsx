import {
  formatTimestamp,
  productStatePresentation,
  resultCaptureLabel,
} from '../work/components/work-presentation';
import { useWorkDetail } from '../work/queries/use-work-detail';
import { RunTrace } from '../run-trace/run-trace-view';

export function ObserveDetail({
  workId,
  runId,
}: {
  readonly workId: string;
  readonly runId: string;
}) {
  const query = useWorkDetail({
    workId,
    selectedRunId: runId,
    preferCurrentDefinition: false,
    includeTrace: true,
  });
  const detail = query.detail;

  if (query.status === 'loading') {
    return (
      <p className="work-detail-loading" aria-live="polite">
        Loading Trace…
      </p>
    );
  }
  if (query.status === 'starting') {
    return (
      <p className="work-detail-loading" aria-live="polite">
        Run is starting…
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
        <p className="eyebrow">Couldn&apos;t load this Trace</p>
        <p>The selected Run is unavailable.</p>
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
          <p className="observe-kicker">Run</p>
          <h2>{run.id}</h2>
          <p className="observe-detail-timestamps">
            Started {formatTimestamp(run.created_at)} · Updated{' '}
            {formatTimestamp(run.updated_at)}
          </p>
        </div>
        <span
          className={`observe-state-pill observe-state-pill--${run.product_state}`}
          data-testid="observe-detail-state"
        >
          {stateView.label}
        </span>
      </header>
      <p className="observe-detail-result">
        {run.result_summary ?? resultCaptureLabel(run.result_capture_status)}
      </p>
      <RunTrace live={live} trace={detail.trace} />
    </section>
  );
}

export default ObserveDetail;
