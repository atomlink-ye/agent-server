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
import {
  formatTimestamp,
  workTabHref,
  normalizeWorkTab,
} from '../components/work-presentation';
import { workRootPath } from '../../../app/routes';
import { useWorkDetail } from '../queries/use-work-detail';
import { WorkDetailRootNotFoundError } from '../queries/load-work-detail';
import { NotFoundContent } from '../../../app/router/NotFoundPage';
import { useT } from '../../../i18n';
import { isFeatureUnavailable } from '../../../api/feature-availability';
import { ProductReadError } from '../clients/errors';
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
  const requestedRunView =
    Boolean(selectedRunId) && !['runs', 'artifacts'].includes(tab ?? '');
  const requestedTab = normalizeWorkTab(tab, requestedRunView);
  const includeRun = requestedRunView || tab === 'chat';
  const preferCurrentDefinition = !includeRun;
  const query = useWorkDetail({
    workId,
    selectedRunId,
    preferCurrentDefinition,
    includeTrace: requestedTab !== 'definition',
    includeRun,
  });
  const detail = query.detail;
  const runId = detail?.run?.work_run.id;
  const latestRunId = detail?.runs[0]?.id;
  const runView =
    requestedRunView || (tab === 'chat' && Boolean(detail?.runs.length));
  const activeTab = normalizeWorkTab(tab, runView);
  const runOrdinal =
    detail && runId
      ? detail.runs.length - detail.runs.findIndex((run) => run.id === runId)
      : undefined;
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
            return runView ? (
              <WorkChatPane workId={detail.work.id} workRunId={runId} />
            ) : (
              <WorkChatPane workId={detail.work.id} />
            );
          case 'overview':
            return (
              <WorkRecord
                data={detail}
                originConversationId={originConversationId}
              />
            );
          case 'result':
            return (
              <>
                <a
                  className="work-run-definition-link"
                  href={workTabHref(
                    detail.work.id,
                    'definition',
                    runId,
                    originConversationId,
                  )}
                >
                  {t('work.definitionUsed')}
                </a>
                <OverviewPane
                  data={detail}
                  originConversationId={originConversationId}
                />
              </>
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
            return (
              <ArtifactsPane
                workId={workId}
                originConversationId={originConversationId}
              />
            );
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
    <div
      className={`work-shell${runView ? ' work-shell--run' : ''}`}
      data-load-state={query.status}
      data-active-tab={activeTab}
      data-testid="work-detail-shell"
    >
      {query.status === 'loading' ? (
        <section
          className="work-detail-feedback work-loading-feedback"
          role="status"
        >
          <h2>{t('work.detail.loading')}</h2>
          <p>{t('work.loading.body')}</p>
          <Link to={workRootPath(originConversationId ?? null)}>
            {t('work.invalidLink.back')}
          </Link>
        </section>
      ) : null}
      {query.status === 'starting' ? (
        <section className="work-detail-feedback" role="status">
          <h2>{t('work.detail.starting')}</h2>
          <p>{t('work.detail.startingBody')}</p>
          <Link to={workRootPath(originConversationId ?? null)}>
            {t('work.invalidLink.back')}
          </Link>
        </section>
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
            run={runView ? detail.run : null}
            runOrdinal={runOrdinal}
            originConversationId={originConversationId}
            actions={
              runView ? undefined : (
                <RunTrigger
                  workId={detail.work.id}
                  originConversationId={originConversationId}
                  definitionVersion={detail.currentDefinitionVersion}
                />
              )
            }
          />
          <WorkTabs
            activeTab={activeTab}
            preparation={detail.runs.length === 0}
            runId={runView ? runId : undefined}
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
  const unavailable = isFeatureUnavailable(error);
  const denied =
    error instanceof ProductReadError &&
    (error.status === 401 || error.status === 403);
  if (unavailable || denied)
    return (
      <section className="work-detail-feedback" role="status">
        <h2>
          {t(unavailable ? 'work.unavailable.title' : 'work.permission.title')}
        </h2>
        <p>
          {t(unavailable ? 'work.unavailable.body' : 'work.permission.body')}
        </p>
        <Link
          to={
            unavailable
              ? '/conversations'
              : workRootPath(originConversationId ?? null)
          }
        >
          {t(
            unavailable ? 'work.backToConversations' : 'work.invalidLink.back',
          )}
        </Link>
      </section>
    );
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
    <section
      className="work-detail-feedback work-list-state--error"
      role="alert"
    >
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

function WorkRecord({
  data,
  originConversationId,
}: {
  readonly data: NonNullable<ReturnType<typeof useWorkDetail>['detail']>;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  return (
    <section className="work-record" data-testid="work-record">
      <h2>{t('work.record.summary')}</h2>
      <dl>
        <dt>{t('work.record.definition')}</dt>
        <dd>
          <a
            href={workTabHref(
              data.work.id,
              'definition',
              undefined,
              originConversationId,
            )}
          >
            {data.work.definition_version_id}
          </a>
        </dd>
        <dt>{t('work.tab.runs')}</dt>
        <dd>
          <a
            href={workTabHref(
              data.work.id,
              'runs',
              undefined,
              originConversationId,
            )}
          >
            {t(
              data.runs.length === 1
                ? 'work.record.oneRun'
                : 'work.record.runCount',
              { count: data.runs.length },
            )}
          </a>
        </dd>
        <dt>{t('work.record.created')}</dt>
        <dd>{formatTimestamp(data.work.created_at)}</dd>
        <dt>{t('work.record.updated')}</dt>
        <dd>{formatTimestamp(data.work.updated_at)}</dd>
      </dl>
    </section>
  );
}
