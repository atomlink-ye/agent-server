import { ArtifactsPane } from '../components/panes/artifacts-pane';
import { DefinitionPane } from '../components/panes/definition-pane';
import { OverviewPane } from '../components/panes/overview-pane';
import { RunsPane } from '../components/panes/runs-pane';
import { TranscriptPane } from '../components/panes/transcript-pane';
import { RunTrigger } from '../components/run-trigger';
import { WorkDetailHeader } from '../components/work-header';
import { WorkProductFrame } from '../components/work-product-frame';
import { WorkTabs } from '../components/work-tabs';
import { normalizeWorkTab } from '../components/work-presentation';
import { useWorkDetail } from '../queries/use-work-detail';
import '../components/work-shell.css';
import '../components/work-shell-overrides.css';

export function WorkDetailPage({
  workId,
  tab,
  selectedRunId,
  selectedSessionIndex,
  originConversationId,
}: {
  readonly workId: string;
  readonly tab?: string;
  readonly selectedRunId?: string;
  readonly selectedSessionIndex?: number;
  readonly originConversationId?: string | null;
}) {
  const activeTab = normalizeWorkTab(tab);
  const preferCurrentDefinition = activeTab === 'definition' && !selectedRunId;
  const query = useWorkDetail({
    workId,
    selectedRunId,
    preferCurrentDefinition,
    includeTrace: activeTab !== 'definition',
  });
  const detail = query.detail;
  const runId = detail?.run?.work_run.id;
  const latestRunId = detail?.runs[0]?.id;
  const pane = detail
    ? (() => {
        switch (activeTab) {
          case 'overview':
            return (
              <OverviewPane
                data={detail}
                originConversationId={originConversationId}
              />
            );
          case 'runs':
            return (
              <RunsPane
                data={detail}
                originConversationId={originConversationId}
              />
            );
          case 'transcript':
            return (
              <TranscriptPane
                data={detail}
                selectedSessionIndex={selectedSessionIndex}
              />
            );
          case 'artifacts':
            return <ArtifactsPane />;
          case 'definition':
            return (
              <DefinitionPane
                data={detail}
                selectedRunId={selectedRunId}
                workId={detail.work.id}
                originConversationId={originConversationId}
              />
            );
        }
      })()
    : null;

  return (
    <WorkProductFrame testId="work-detail-shell">
      {query.status === 'loading' ? (
        <p className="work-detail-loading" aria-live="polite">
          Loading Work…
        </p>
      ) : null}
      {query.status === 'starting' ? (
        <p className="work-detail-loading" aria-live="polite">
          Run is starting…
        </p>
      ) : null}
      {query.status === 'error' ? <WorkDetailError /> : null}
      {detail ? (
        <>
          <WorkDetailHeader
            work={detail.work}
            run={detail.run}
            latestRunId={latestRunId}
          />
          <RunTrigger
            workId={detail.work.id}
            originConversationId={originConversationId}
          />
          <WorkTabs
            activeTab={activeTab}
            definitionRunId={undefined}
            runId={runId}
            workId={detail.work.id}
            originConversationId={originConversationId}
          />
          {pane}
        </>
      ) : null}
    </WorkProductFrame>
  );
}

function WorkDetailError() {
  return (
    <section className="work-list-state work-list-state--error" role="alert">
      <p className="work-list-state__eyebrow">Couldn't load Work</p>
      <h2>The selected Work or Run is unavailable.</h2>
      <p>Return to My Work and choose an available Product Work record.</p>
    </section>
  );
}
