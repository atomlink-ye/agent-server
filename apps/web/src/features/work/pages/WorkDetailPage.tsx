import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { ArtifactsPane } from '../components/panes/artifacts-pane';
import { DefinitionPane } from '../components/panes/definition-pane';
import { OverviewPane } from '../components/panes/overview-pane';
import { RunsPane } from '../components/panes/runs-pane';
import { TranscriptPane } from '../components/panes/transcript-pane';
import { WorkChatPane } from '../components/panes/work-chat-pane';
import { RunTrigger } from '../components/run-trigger';
import { WorkDetailHeader } from '../components/work-header';
import { WorkTabs } from '../components/work-tabs';
import { normalizeWorkTab } from '../components/work-presentation';
import { workRootPath } from '../../../app/routes';
import { useWorkDetail } from '../queries/use-work-detail';
import { WorkDetailRootNotFoundError } from '../queries/load-work-detail';
import { NotFoundContent } from '../../../app/router/NotFoundPage';
import { useT } from '../../../i18n';
import '../components/work-shell.css';
import '../components/work-list.css';
import '../components/work-detail.css';

export function WorkDetailPage({
  workId,
  tab,
  selectedRunId,
  selectedSessionIndex,
  originConversationId,
  onSelectedLatestRunState,
}: {
  readonly workId: string;
  readonly tab?: string;
  readonly selectedRunId?: string;
  readonly selectedSessionIndex?: number;
  readonly originConversationId?: string | null;
  readonly onSelectedLatestRunState?: (
    state: {
      readonly workId: string;
      readonly runId: string;
      readonly state: WorkListItem['product_state'];
    } | null,
  ) => void;
}) {
  const t = useT();
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
  useEffect(() => {
    const selectedRun = detail?.run?.work_run;
    onSelectedLatestRunState?.(
      detail?.work.id === workId &&
        selectedRun &&
        selectedRun.id === latestRunId &&
        (!selectedRunId || selectedRun.id === selectedRunId)
        ? { workId, runId: selectedRun.id, state: selectedRun.product_state }
        : null,
    );
  }, [
    detail?.work.id,
    detail?.run?.work_run,
    latestRunId,
    onSelectedLatestRunState,
    selectedRunId,
    workId,
  ]);
  const pane = detail
    ? (() => {
        switch (activeTab) {
          case 'chat':
            return <WorkChatPane workId={detail.work.id} />;
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
    <div className="work-shell" data-testid="work-detail-shell">
      {query.status === 'loading' ? (
        <p className="work-detail-loading" aria-live="polite">
          {t('work.detail.loading')}
        </p>
      ) : null}
      {query.status === 'starting' ? (
        <p className="work-detail-loading" aria-live="polite">
          {t('work.detail.starting')}
        </p>
      ) : null}
      {query.status === 'error' ? (
        <WorkDetailError
          error={query.error}
          originConversationId={originConversationId}
        />
      ) : null}
      {detail ? (
        <>
          <WorkDetailHeader
            work={detail.work}
            run={detail.run}
            latestRunId={latestRunId}
            originConversationId={originConversationId}
          />
          <RunTrigger
            workId={detail.work.id}
            originConversationId={originConversationId}
            definitionVersion={detail.currentDefinitionVersion}
            runState={detail.run?.work_run.product_state}
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
    </div>
  );
}

function WorkDetailError({
  error,
  originConversationId,
}: {
  readonly error: unknown | null;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const rootWorkMissing = error instanceof WorkDetailRootNotFoundError;
  if (rootWorkMissing) {
    return (
      <NotFoundContent
        title={t('work.detailUnavailable.title')}
        to={workRootPath(originConversationId ?? null)}
        linkLabel={t('work.invalidLink.back')}
        eyebrow={t('work.detailUnavailable.eyebrow')}
      >
        {t('work.detailMissing.body')}
      </NotFoundContent>
    );
  }

  return (
    <section className="work-list-state work-list-state--error" role="alert">
      <p className="work-list-state__eyebrow">{t('work.couldNotLoad')}</p>
      <h2>{t('work.couldNotLoad.title')}</h2>
      <p>{t('work.couldNotLoad.body')}</p>
      <div className="work-status-actions">
        <Link to={workRootPath(originConversationId ?? null)}>
          {t('work.invalidLink.back')}
        </Link>
        <button type="button" onClick={() => window.location.reload()}>
          {t('work.retryLoading')}
        </button>
      </div>
    </section>
  );
}
