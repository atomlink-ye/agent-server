import { useEffect, useState } from 'react';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';
import { workClient } from './clients/work-client';

export interface WorkPaneProps {
  readonly onOpenWork: (workId: string) => void;
  readonly onCreateNew: () => void;
  readonly selectedWorkId?: string | null;
}

type WorkPaneState =
  | { readonly status: 'loading'; readonly works: readonly WorkListItem[] }
  | { readonly status: 'ready'; readonly works: readonly WorkListItem[] }
  | {
      readonly status: 'error';
      readonly works: readonly WorkListItem[];
      readonly error: string;
    };

export function WorkPane({
  onOpenWork,
  onCreateNew,
  selectedWorkId = null,
}: WorkPaneProps) {
  const [state, setState] = useState<WorkPaneState>({
    status: 'loading',
    works: [],
  });

  const load = (): void => {
    setState((current) => ({ status: 'loading', works: current.works }));
    void workClient
      .list()
      .then((response) => setState({ status: 'ready', works: response.works }))
      .catch((error: unknown) => {
        setState((current) => ({
          status: 'error',
          works: current.works,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  };

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', works: [] });
    void workClient
      .list()
      .then((response) => {
        if (active) setState({ status: 'ready', works: response.works });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          works: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <aside className="sidebar work-pane" aria-label="Work navigation">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Work</h1>
        </div>
        <div className="work-pane-actions">
          <button
            className="pane-refresh"
            type="button"
            aria-label="Create Work"
            onClick={onCreateNew}
          >
            +
          </button>
          <button
            className="pane-refresh"
            type="button"
            aria-label="Refresh Work"
            disabled={state.status === 'loading'}
            onClick={load}
          >
            ↻
          </button>
        </div>
      </div>

      <div className="work-list" aria-label="Work items">
        {state.status === 'loading' && state.works.length === 0 ? (
          <p className="pane-placeholder" role="status">
            Loading Work…
          </p>
        ) : null}
        {state.status === 'error' && state.works.length === 0 ? (
          <div className="pane-placeholder" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={load}>
              Retry
            </button>
          </div>
        ) : null}
        {state.status === 'ready' && state.works.length === 0 ? (
          <p className="pane-placeholder">No Work yet.</p>
        ) : null}
        {state.works.map((work) => (
          <button
            aria-current={selectedWorkId === work.id ? 'page' : undefined}
            className="work-list-item"
            data-active={selectedWorkId === work.id ? 'true' : 'false'}
            key={work.id}
            type="button"
            onClick={() => onOpenWork(work.id)}
          >
            <span className="work-list-mark" aria-hidden="true">
              {work.title.slice(0, 1).toUpperCase()}
            </span>
            <span className="work-list-copy">
              <strong>{work.title}</strong>
              <span>
                <span
                  className={`work-status-dot work-status-dot--${work.product_state}`}
                />
                {workStateLabel(work.product_state)}
              </span>
            </span>
            <time dateTime={work.updated_at}>
              {formatUpdatedTime(work.updated_at)}
            </time>
          </button>
        ))}
      </div>
    </aside>
  );
}

function workStateLabel(state: WorkListItem['product_state']): string {
  switch (state) {
    case 'running':
      return 'Running';
    case 'needs_you':
      return 'Needs you';
    case 'complete':
      return 'Complete';
    case 'problem':
      return 'Problem';
    case 'not_captured':
      return 'Not captured';
  }
}

function formatUpdatedTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default WorkPane;
