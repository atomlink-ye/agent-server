import type {
  WorkListItem,
  WorkResponse,
} from '@atomlink-ye/agent-server/product-contract';

import type { AnchoredRun } from '../clients/work-run-client';
import {
  latestRunSummary,
  productStatePresentation,
} from './work-presentation';

export function WorkListHeader({
  showNewWork,
  onToggleNewWork,
}: {
  readonly showNewWork: boolean;
  readonly onToggleNewWork: () => void;
}) {
  return (
    <header className="work-list-header">
      <div>
        <p className="work-shell-kicker">My Work</p>
        <h1>My Work</h1>
        <p className="work-list-header__summary">
          Does this need me? What happened in the latest Run?
        </p>
        <p className="work-list-header__coverage">
          Delivered Artifacts are not shown until the Product API exposes them;
          this view does not infer them from messages or tool output.
        </p>
      </div>
      <button
        onClick={onToggleNewWork}
        type="button"
        data-testid="new-work-cta"
        className="work-list-header__cta"
      >
        {showNewWork ? 'Hide' : 'New Work'}
      </button>
    </header>
  );
}

export function WorkListContent({
  works,
}: {
  readonly works: readonly WorkListItem[];
}) {
  return (
    <section aria-labelledby="work-list-heading" className="work-list-region">
      <div className="work-list-region__heading">
        <p className="work-list-region__eyebrow">Available Work</p>
        <h2 id="work-list-heading">Current Work</h2>
      </div>
      <ul data-testid="work-list" className="work-list">
        {works.map((work) => {
          const stateView = productStatePresentation(work.product_state);
          return (
            <li className="work-list-card" key={work.id}>
              <div className="work-list-card__state">
                <span
                  className={`work-state-pill work-state-pill--${work.product_state}`}
                  data-product-state={work.product_state}
                >
                  {stateView.label}
                </span>
                <p>{stateView.description}</p>
              </div>
              <div className="work-list-card__identity">
                <a href={`/works/${encodeURIComponent(work.id)}`}>
                  {work.title}
                </a>
                <p>{latestRunSummary(work)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
