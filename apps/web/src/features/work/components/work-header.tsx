import type { WorkResponse } from '@atomlink-ye/agent-server/product-contract';

import type { AnchoredRun } from '../clients/work-run-client';
import { productStatePresentation } from './work-presentation';

export function WorkDetailHeader({
  work,
  run,
  latestRunId,
}: {
  readonly work: WorkResponse;
  readonly run: AnchoredRun | null;
  readonly latestRunId: string | undefined;
}) {
  const runContext = !run
    ? 'No Run recorded'
    : run.work_run.id === latestRunId
      ? 'Latest Run'
      : 'Historical Run';
  return (
    <>
      <p className="work-shell-breadcrumb">
        <a href="/">My Work</a> / {work.title}
      </p>
      <header className="work-detail-header work-detail-header--stacked">
        <div>
          <p className="work-shell-kicker">Work</p>
          <h1>{work.title}</h1>
          <p className="work-detail-header__summary">
            {runContext}
            {run
              ? ` · ${productStatePresentation(run.work_run.product_state).label}`
              : ''}
          </p>
          <p className="work-detail-surface-note">
            Define, run, inspect collaboration, and review through Product
            facts.
          </p>
        </div>
      </header>
    </>
  );
}
