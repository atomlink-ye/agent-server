import { useEffect, useState } from 'react';
import type { WorkRunSummary } from '@atomlink-ye/agent-server/product-contract';
import type { WorkDetailData } from '../../queries/load-work-detail';
import { workRunClient, type AnchoredRun } from '../../clients/work-run-client';
import { RunTrigger } from '../run-trigger';
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
        <h2>{t('work.runs.emptyTitle')}</h2>
        <RunTrigger
          workId={data.work.id}
          definitionVersion={data.currentDefinitionVersion}
          originConversationId={originConversationId}
        />
      </section>
    );
  return (
    <section className="work-runs" aria-label={t('work.tab.runs')}>
      <ol className="work-run-list">
        {data.runs.map((run, index) => (
          <li key={run.id}>
            <div className="work-run-list__identity">
              <strong>
                {t('work.run.number', { number: data.runs.length - index })}
              </strong>
              <time dateTime={run.created_at}>
                {formatTimestamp(run.created_at)}
              </time>
            </div>
            <RunState
              run={run}
              selected={data.run?.work_run.id === run.id ? data.run : null}
            />
            <a
              href={workTabHref(
                data.work.id,
                'chat',
                run.id,
                originConversationId,
              )}
            >
              {t('work.run.open')}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RunState({
  run,
  selected,
}: {
  readonly run: WorkRunSummary;
  readonly selected: AnchoredRun | null;
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
    setState(null);
    setReadFailed(false);
    void workRunClient.get(run.work_id, run.id).then(
      (detail) => {
        if (active)
          setState(
            'projection_status' in detail &&
              detail.projection_status === 'internally_anchored'
              ? detail.work_run.product_state
              : 'not_captured',
          );
      },
      () => {
        if (active) setReadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [run.id, run.work_id, run.updated_at, selected, retryVersion]);
  if (!selected && readFailed)
    return (
      <span className="work-run-read-error">
        <span role="status">{t('work.run.stateError')}</span>
        <button
          type="button"
          onClick={() => setRetryVersion((value) => value + 1)}
        >
          {t('work.retry')}
        </button>
      </span>
    );
  const current = selected?.work_run.product_state ?? state;
  return (
    <span
      className={`work-state-pill${current ? ` work-state-pill--${current}` : ''}`}
    >
      {current
        ? productStatePresentation(current).label
        : t('work.run.stateLoading')}
    </span>
  );
}
