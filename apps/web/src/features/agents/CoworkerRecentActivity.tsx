import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  activityStateLabel,
  formatActivityTime,
  loadCoworkerActivity,
  type CoworkerActivity,
} from './coworker-activity';
import { useT } from '../../i18n';

type ActivityState =
  | { readonly status: 'loading'; readonly activity: null }
  | { readonly status: 'ready'; readonly activity: CoworkerActivity };

export function CoworkerRecentActivity({
  agentId,
  capabilityDefinitionIds,
}: {
  readonly agentId: string;
  readonly capabilityDefinitionIds: readonly string[];
}) {
  const t = useT();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ActivityState>({
    status: 'loading',
    activity: null,
  });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading', activity: null });
    void loadCoworkerActivity({ agentId, capabilityDefinitionIds }).then(
      (activity) => {
        if (active) setState({ status: 'ready', activity });
      },
    );
    return () => {
      active = false;
    };
  }, [agentId, capabilityDefinitionIds, reload]);

  const activity = state.activity;
  const bothFailed = activity?.work === 'failed' && activity.chat === 'failed';
  const partlyFailed =
    !bothFailed && (activity?.work === 'failed' || activity?.chat === 'failed');

  return (
    <section
      className="agents-activity"
      aria-labelledby="coworker-activity-heading"
    >
      <div className="agents-section-heading">
        <div>
          <span className="eyebrow">{t('agents.recently')}</span>
          <h2 id="coworker-activity-heading">{t('agents.activity')}</h2>
        </div>
      </div>

      {state.status === 'loading' ? (
        <p className="agents-activity-note" role="status">
          {t('agents.loadingActivity')}
        </p>
      ) : null}

      {activity && bothFailed ? (
        <div className="agents-activity-error" role="alert">
          <p>{t('agents.activityLoadError')}</p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {activity && partlyFailed ? (
        <div className="agents-activity-error" role="alert">
          <p>
            {activity.work === 'failed'
              ? t('agents.workHistoryLoadError')
              : t('agents.conversationHistoryLoadError')}
          </p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {activity && !bothFailed && activity.items.length === 0 ? (
        <p className="agents-activity-note">{t('agents.activityEmpty')}</p>
      ) : null}

      {activity && activity.items.length > 0 ? (
        <>
          <ul className="agents-activity-list">
            {activity.items.map((item) => {
              const when = formatActivityTime(item.at);
              return (
                <li key={item.id}>
                  <Link className="agents-activity-item" to={item.to}>
                    <span
                      className={`agents-activity-kind agents-activity-kind--${item.kind}`}
                    >
                      {item.kind === 'work'
                        ? t('agents.work')
                        : t('agents.chat')}
                    </span>
                    <span className="agents-activity-copy">
                      <strong>{item.title}</strong>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </span>
                    <span className="agents-activity-meta">
                      {item.state ? (
                        <span
                          className={`agents-activity-state agents-activity-state--${item.state}`}
                        >
                          {activityStateLabel(item.state)}
                        </span>
                      ) : null}
                      {when ? <time dateTime={item.at}>{when}</time> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="agents-activity-note">{t('agents.activityWorkHint')}</p>
        </>
      ) : null}
    </section>
  );
}

export default CoworkerRecentActivity;
