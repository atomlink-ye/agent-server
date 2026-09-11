import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TitleBar } from '../../app/shell/TitleBar';
import { useT } from '../../i18n';
import { ObserveDetail } from './ObserveDetail';
import { ObservePane } from './ObservePane';
import { ObserveSummary } from './ObserveSummary';
import type { ObserveAggregate } from './observe-aggregate';
import './observe.css';

export function ObservePage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const workId = searchParams.get('work');
  const workRunId = searchParams.get('run');
  const hasSelection = Boolean(workId && workRunId);

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
        <TitleBar section={t('observe.title')} />
        <section
          aria-label={t('observe.detail')}
          className="work-main-content scroll-region"
          data-empty={hasSelection || aggregate ? 'false' : 'true'}
        >
          {workId && workRunId ? (
            <ObserveDetail workId={workId} workRunId={workRunId} />
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
              <h1>{t('observe.selectRun')}</h1>
              <p>{t('observe.selectRunHint')}</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export default ObservePage;
