import { useSearchParams } from 'react-router-dom';

import { TitleBar } from '../../app/shell/TitleBar';
import { ObserveDetail } from './ObserveDetail';
import { ObservePane } from './ObservePane';
import './observe.css';

export function ObservePage() {
  const [searchParams] = useSearchParams();
  const workId = searchParams.get('work');
  const runId = searchParams.get('run');
  const hasSelection = Boolean(workId && runId);

  return (
    <>
      <ObservePane />
      <main className="chat-panel work-main">
        <TitleBar section="Observe" />
        <section
          aria-label="Observe detail"
          className="work-main-content"
          data-empty={hasSelection ? 'false' : 'true'}
        >
          {workId && runId ? (
            <ObserveDetail workId={workId} runId={runId} />
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
