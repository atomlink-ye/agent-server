import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import type { WorkDetailData } from '../../queries/load-work-detail';
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
        <p className="work-shell-kicker">{t('work.tab.runs')}</p>
        <h2>{t('work.runs.emptyTitle')}</h2>
      </section>
    );

  return (
    <section className="work-runs" aria-labelledby="work-runs-heading">
      <div className="work-section-heading">
        <p className="work-shell-kicker">{t('work.tab.runs')}</p>
        <h2 id="work-runs-heading">{t('work.runs.historyTitle')}</h2>
        <p>{t('work.runs.historyBody')}</p>
      </div>
      <ol className="work-run-list">
        {data.runs.map((run, index) => {
          const selected = data.run?.work_run.id === run.id;
          const exactDefinition =
            data.definitionVersion?.id === run.definition_version_id
              ? definitionName(data.definitionVersion)
              : null;
          return (
            <li data-selected={selected ? 'true' : undefined} key={run.id}>
              <div className="work-run-list__identity">
                <strong>{index === 0 ? t('work.latestRun') : t('work.historicalRun')}</strong>
                <time dateTime={run.created_at}>
                  {formatTimestamp(run.created_at)}
                </time>
              </div>
              <div className="work-run-list__definition">
                <span>{t('work.tab.definition')}</span>
                {exactDefinition ? (
                  <strong>{exactDefinition}</strong>
                ) : (
                  <code>{run.definition_version_id}</code>
                )}
              </div>
              {selected && data.run ? (
                <span
                  className={`work-state-pill work-state-pill--${data.run.work_run.product_state}`}
                >
                  {
                    productStatePresentation(data.run.work_run.product_state)
                      .label
                  }
                </span>
              ) : (
                <span className="work-run-list__quiet">
                  {t('work.outcomeLoads')}
                </span>
              )}
              <a
                href={workTabHref(
                  data.work.id,
                  'overview',
                  run.id,
                  originConversationId,
                )}
              >
                {selected ? t('work.viewOverview') : t('work.openRun')}
              </a>
              <a
                href={workTabHref(
                  data.work.id,
                  'definition',
                  run.id,
                  originConversationId,
                )}
              >
                {t('work.definitionUsed')}
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function definitionName(
  version: ProductWorkDefinitionVersionResponse,
): string | null {
  const metadata = version.source.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return null;
  const name = (metadata as Record<string, unknown>).name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}
