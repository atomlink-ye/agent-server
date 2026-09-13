import { useEffect, useState } from 'react';
import type { WorkRunSummary } from '@atomlink-ye/agent-server/product-contract';
import type { WorkDetailData } from '../../queries/load-work-detail';
import { workRunClient, type AnchoredRun } from '../../clients/work-run-client';
import {
  formatTimestamp,
  productStatePresentation,
  workTabHref,
} from '../work-presentation';
import { useT } from '../../../../i18n';

export function RunsPane({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  if (data.runs.length === 0)
    return (
      <section className="work-detail-state">
        <h2>{t('work.scope.emptyTitle')}</h2>
        <p>{t('work.scope.emptyBody')}</p>
        <a
          href={workTabHref(
            data.work.id,
            'chat',
            undefined,
            originConversationId,
          )}
        >
          {t('work.record.preparation')}
        </a>
      </section>
    );
  return (
    <section className="work-runs" aria-label={t('work.scope.history')}>
      <ol className="work-run-list">
        {data.runs.map((run, index) => (
          <RunListItem
            key={run.id}
            run={run}
            ordinal={data.runs.length - index}
            latest={index === 0}
            selected={data.run?.work_run.id === run.id ? data.run : null}
            originConversationId={originConversationId}
          />
        ))}
      </ol>
    </section>
  );
}

function RunListItem({
  run,
  ordinal,
  latest,
  selected,
  originConversationId,
}: {
  readonly run: WorkRunSummary;
  readonly ordinal: number;
  readonly latest: boolean;
  readonly selected: AnchoredRun | null;
  readonly originConversationId?: string | null;
}) {
  const t = useT();
  const [state, setState] = useState<
    AnchoredRun['work_run']['product_state'] | null
  >(null);
  const [readFailed, setReadFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    if (selected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(null);
    setReadFailed(false);
    const refresh = () =>
      void workRunClient.get(run.work_id, run.id).then(
        (detail) => {
          if (!active) return;
          setState(
            'projection_status' in detail &&
              detail.projection_status === 'internally_anchored'
              ? detail.work_run.product_state
              : 'not_captured',
          );
          if (
            'work_run' in detail &&
            detail.work_run &&
            ['running', 'needs_you'].includes(detail.work_run.product_state)
          )
            timer = setTimeout(refresh, 2_000);
        },
        () => {
          if (active) setReadFailed(true);
        },
      );
    refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [run.id, run.work_id, run.updated_at, selected, retryVersion]);
  const current = selected?.work_run.product_state ?? state;
  const primaryTab =
    current === 'complete'
      ? 'result'
      : current === 'needs_you'
        ? 'chat'
        : 'transcript';
  const primaryLabel =
    current === 'complete'
      ? t('work.run.readResult')
      : current === 'needs_you'
        ? t('work.run.respond')
        : current === 'problem'
          ? t('work.run.inspectProblem')
          : t('work.run.followProgress');
  return (
    <li className={latest ? 'work-run-list__latest' : undefined}>
      <div className="work-run-list__identity">
        <strong>
          {t('work.scope.number', { number: ordinal })}
          {latest ? <small>{t('work.latestRun')}</small> : null}
        </strong>
        <time dateTime={run.created_at}>{formatTimestamp(run.created_at)}</time>
      </div>
      {!selected && readFailed ? (
        <span className="work-run-read-error">
          <span role="status">{t('work.run.stateError')}</span>
          <button
            type="button"
            onClick={() => setRetryVersion((value) => value + 1)}
          >
            {t('work.retry')}
          </button>
        </span>
      ) : (
        <span
          className={`work-state-pill${current ? ` work-state-pill--${current}` : ''}`}
        >
          {current
            ? productStatePresentation(current).label
            : t('work.run.stateLoading')}
        </span>
      )}
      {latest && current ? (
        <p className="work-run-list__guidance">
          {t(`work.scope.state.${current}`)}
        </p>
      ) : null}
      <div className="work-run-list__actions">
        {latest ? (
          <a
            className="work-run-list__primary"
            href={workTabHref(
              run.work_id,
              primaryTab,
              run.id,
              originConversationId,
            )}
          >
            {primaryLabel}
          </a>
        ) : null}
        {(['result', 'transcript', 'chat'] as const)
          .filter((tab) => !latest || tab !== primaryTab)
          .map((tab) => (
            <a
              key={tab}
              href={workTabHref(run.work_id, tab, run.id, originConversationId)}
            >
              {t(
                tab === 'chat'
                  ? 'work.run.conversation'
                  : tab === 'result'
                    ? 'work.scope.output'
                    : 'work.scope.activity',
              )}
            </a>
          ))}
      </div>
    </li>
  );
}
