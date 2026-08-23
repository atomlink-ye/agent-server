import { useState } from 'react';

import { NewWork } from '../components/new-work';
import { WorkListContent, WorkListHeader } from '../components/work-header';
import { WorkProductFrame } from '../components/work-product-frame';
import { useWorkList } from '../queries/use-work-list';
import '../components/work-shell.css';
import '../components/work-list.css';

export function WorkListPage({
  originConversationId = null,
}: {
  readonly originConversationId?: string | null;
}) {
  const [showNewWork, setShowNewWork] = useState(false);
  const query = useWorkList();

  return (
    <WorkProductFrame testId="work-list-shell">
      <WorkListHeader
        showNewWork={showNewWork}
        onToggleNewWork={() => setShowNewWork((current) => !current)}
      />
      {showNewWork ? (
        <NewWork originConversationId={originConversationId} />
      ) : null}
      {query.status === 'loading' && query.works.length === 0 ? (
        <WorkListLoading />
      ) : null}
      {query.status === 'error' && query.works.length === 0 ? (
        <WorkListError onRetry={query.refresh} />
      ) : null}
      {query.status === 'ready' && query.works.length === 0 ? (
        <WorkListEmpty
          showNewWork={showNewWork}
          onNewWork={() => setShowNewWork(true)}
        />
      ) : null}
      {query.works.length > 0 ? <WorkListContent works={query.works} /> : null}
    </WorkProductFrame>
  );
}

function WorkListLoading() {
  return (
    <section
      aria-live="polite"
      className="work-list-state work-list-state--loading"
      data-testid="work-list-loading"
    >
      <p className="work-list-state__eyebrow">Loading</p>
      <h2>Getting your Work records</h2>
      <p>We are retrieving the current Product Work projection.</p>
      <div aria-hidden="true" className="work-list-skeleton">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

function WorkListError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <section
      className="work-list-state work-list-state--error"
      data-testid="work-list-error"
      role="alert"
    >
      <p className="work-list-state__eyebrow">Couldn't load Work</p>
      <h2>Work records are temporarily unavailable.</h2>
      <p>
        This is a connection problem, not a statement about the status of any
        Work. Refresh the page to try again.
      </p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function WorkListEmpty({
  showNewWork,
  onNewWork,
}: {
  readonly showNewWork: boolean;
  readonly onNewWork: () => void;
}) {
  if (showNewWork) return null;
  return (
    <section
      aria-labelledby="work-list-empty-heading"
      className="work-list-state work-list-state--empty"
      data-testid="work-list-empty"
    >
      <p className="work-list-state__eyebrow">No Work records</p>
      <h2>Nothing is available yet.</h2>
      <p>When Work is created, it will appear here as the durable entry.</p>
      <button type="button" onClick={onNewWork}>
        New Work
      </button>
    </section>
  );
}
