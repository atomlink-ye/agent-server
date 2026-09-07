import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  activityStateLabel,
  formatActivityTime,
  loadCoworkerActivity,
  type CoworkerActivity,
} from './coworker-activity';

type ActivityState =
  | { readonly status: 'loading'; readonly activity: null }
  | { readonly status: 'ready'; readonly activity: CoworkerActivity };

const KIND_LABEL = { work: 'Work', chat: 'Chat' } as const;

export function CoworkerRecentActivity({
  agentId,
  capabilityDefinitionIds,
}: {
  readonly agentId: string;
  readonly capabilityDefinitionIds: readonly string[];
}) {
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
          <span className="eyebrow">Recently</span>
          <h2 id="coworker-activity-heading">Activity</h2>
        </div>
      </div>

      {state.status === 'loading' ? (
        <p className="agents-activity-note" role="status">
          Loading recent activity…
        </p>
      ) : null}

      {activity && bothFailed ? (
        <div className="agents-activity-error" role="alert">
          <p>Recent activity couldn&apos;t be loaded.</p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {activity && partlyFailed ? (
        <div className="agents-activity-error" role="alert">
          <p>
            {activity.work === 'failed'
              ? 'Work history couldn’t be loaded, so this list may be incomplete.'
              : 'Conversation history couldn’t be loaded, so this list may be incomplete.'}
          </p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {activity && !bothFailed && activity.items.length === 0 ? (
        <p className="agents-activity-note">
          Nothing yet. Chat with this Coworker, or start one of its Capabilities
          — the Work and conversations you create show up here.
        </p>
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
                      {KIND_LABEL[item.kind]}
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
          <p className="agents-activity-note">
            Work here was started from this Coworker&apos;s Capabilities.
          </p>
        </>
      ) : null}
    </section>
  );
}

export default CoworkerRecentActivity;
