import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TitleBar } from '../../app/shell/TitleBar';
import { ObserveDetail } from './ObserveDetail';
import { ObservePane } from './ObservePane';
import { ObserveSummary } from './ObserveSummary';
import type { ObserveAggregate } from './observe-aggregate';
import './observe.css';

export function ObservePage() {
  const [searchParams] = useSearchParams();
  const workId = searchParams.get('work');
  const runId = searchParams.get('run');
  const hasSelection = Boolean(workId && runId);

  const [aggregate, setAggregate] = useState<ObserveAggregate | null>(null);
  const [aggregateResolving, setAggregateResolving] = useState(false);
  const handleAggregateChange = useCallback(
    (nextAggregate: ObserveAggregate, resolving: boolean) => {
      setAggregate(nextAggregate);
      setAggregateResolving(resolving);
    },
    [],
  );

  return (
    <>
      <ObservePane onAggregateChange={handleAggregateChange} />
      <main className="chat-panel work-main">
        <TitleBar section="Observe" />
        <section
          aria-label="Observe detail"
          className="work-main-content"
          data-empty={hasSelection || aggregate ? 'false' : 'true'}
        >
          {workId && runId ? (
            <ObserveDetail workId={workId} runId={runId} />
          ) : aggregate ? (
            <ObserveSummary
              aggregate={aggregate}
              resolving={aggregateResolving}
            />
          ) : (
            <div className="work-main-empty" data-testid="observe-page-empty">
              <span className="work-main-icon" aria-hidden="true">
                ◈
              </span>
              <h1>Select a Run</h1>
              <p>Choose a Run from the list to inspect its recorded Trace.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export default ObservePage;
