import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { useWorkList } from './queries/use-work-list';

export interface WorkPaneProps {
  readonly onOpenWork: (workId: string) => void;
  readonly onCreateNew: () => void;
  readonly selectedWorkId?: string | null;
}

export function WorkPane({
  onOpenWork,
  onCreateNew,
  selectedWorkId = null,
}: WorkPaneProps) {
  const { status, works, error, refresh } = useWorkList();

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
            disabled={status === 'loading'}
            onClick={refresh}
          >
            ↻
          </button>
        </div>
      </div>

      <div className="work-list" aria-label="Work items">
        {status === 'loading' && works.length === 0 ? (
          <p className="pane-placeholder" role="status">
            Loading Work…
          </p>
        ) : null}
        {status === 'error' && works.length === 0 ? (
          <div className="pane-placeholder" role="alert">
            <p>{error}</p>
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : null}
        {status === 'ready' && works.length === 0 ? (
          <p className="pane-placeholder">No Work yet.</p>
        ) : null}
        {works.map((work) => (
          <WorkListItemButton
            key={work.id}
            work={work}
            selected={selectedWorkId === work.id}
            onOpenWork={onOpenWork}
          />
        ))}
      </div>
    </aside>
  );
}

function WorkListItemButton({
  work,
  selected,
  onOpenWork,
}: {
  readonly work: WorkListItem;
  readonly selected: boolean;
  readonly onOpenWork: (workId: string) => void;
}) {
  return (
    <button
      aria-current={selected ? 'page' : undefined}
      className="work-list-item"
      data-active={selected ? 'true' : 'false'}
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
