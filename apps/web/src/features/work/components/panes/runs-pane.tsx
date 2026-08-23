import type { ProductWorkDefinitionVersionResponse } from '@atomlink-ye/agent-server/product-contract';

import type { WorkDetailData } from '../../queries/load-work-detail';
import {
  formatTimestamp,
  productStatePresentation,
  workTabHref,
} from '../work-presentation';

export function RunsPane({
  data,
  originConversationId,
}: {
  readonly data: WorkDetailData;
  readonly originConversationId?: string | null;
}) {
  if (data.runs.length === 0)
    return (
      <section className="work-detail-state">
        <p className="work-shell-kicker">Runs</p>
        <h2>No Run history yet.</h2>
      </section>
    );

  return (
    <section className="work-runs" aria-labelledby="work-runs-heading">
      <div className="work-section-heading">
        <p className="work-shell-kicker">Runs</p>
        <h2 id="work-runs-heading">Historical execution records</h2>
        <p>
          Each Run remains pinned to the exact immutable Definition version it
          used.
        </p>
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
                <strong>{index === 0 ? 'Latest Run' : 'Historical Run'}</strong>
                <time dateTime={run.created_at}>
                  {formatTimestamp(run.created_at)}
                </time>
              </div>
              <div className="work-run-list__definition">
                <span>Definition</span>
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
                  Outcome loads on open
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
                {selected ? 'View Overview' : 'Open Run'}
              </a>
              <a
                href={workTabHref(
                  data.work.id,
                  'definition',
                  run.id,
                  originConversationId,
                )}
              >
                Definition used
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
