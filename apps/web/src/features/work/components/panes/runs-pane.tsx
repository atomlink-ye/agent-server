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
          <li key={run.id}>
            <div className="work-run-list__identity">
              <strong>
                {t('work.scope.number', { number: data.runs.length - index })}
              </strong>
              <time dateTime={run.created_at}>
                {formatTimestamp(run.created_at)}
              </time>
            </div>
            <RunState
              run={run}
              selected={data.run?.work_run.id === run.id ? data.run : null}
            />
            <div className="work-run-list__actions">
              {(['chat', 'result', 'transcript'] as const).map((tab) => (
                <a
                  key={tab}
                  href={workTabHref(
                    data.work.id,
                    tab,
                    run.id,
                    originConversationId,
                  )}
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
  useEffect(() => {
    if (selected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState(null);
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
          if (active) setState('not_captured');
        },
      );
    refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [run.id, run.work_id, run.updated_at, selected]);
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
