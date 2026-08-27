import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { WorkListItem } from '@atomlink-ye/agent-server/product-contract';

import { workPath } from '../../app/routes';
import {
  latestRunSummary,
  productStatePresentation,
} from './components/work-presentation';
import { useWorkList, type WorkListQuery } from './queries/use-work-list';

export interface WorkPaneProps {
  readonly onCreateNew: () => void;
  readonly selectedWorkId?: string | null;
  readonly originConversationId?: string | null;
  readonly onStatusChange?: (status: WorkListQuery['status']) => void;
}

export function WorkPane({
  onCreateNew,
  selectedWorkId = null,
  originConversationId = null,
  onStatusChange,
}: WorkPaneProps) {
  const { status, works, refresh } = useWorkList();

  // The list/detail split of a Work destination must read the same load
  // state. WorkPane owns the fetch (so tests and assistive tech can treat it
  // as the single source of truth for "is the list present?"), and reports
  // status upward so the sibling detail pane never contradicts it.
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const controlsDisabled = status === 'unavailable' || status === 'error';

  return (
    <aside className="sidebar work-pane" aria-label="Work navigation">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Work</h1>
        </div>
        <div className="work-pane-actions">
          {/* The count is only known once a load has actually succeeded. A
              non-ready state must not assert "0 Work items" alongside a
              message that says the count could not be determined. */}
          {status === 'ready' ? (
            <span
              className="pane-count"
              aria-label={`${works.length} Work items`}
            >
              {works.length}
            </span>
          ) : null}
          <button
            className="pane-refresh"
            type="button"
            data-testid="new-work-cta"
            aria-label="Create Work"
            disabled={controlsDisabled}
            onClick={onCreateNew}
          >
            +
          </button>
          <button
            className="pane-refresh"
            type="button"
            aria-label="Refresh Work"
            disabled={status === 'loading' || controlsDisabled}
            onClick={refresh}
          >
            ↻
          </button>
        </div>
      </div>

      {/* The list element only exists once there is a list. A non-ready state
          is a sibling placeholder, not an empty <ul> holding a status row, so
          "is the list present?" stays an honest question for both tests and
          assistive technology. */}
      {works.length === 0 && status === 'loading' ? (
        <p
          className="pane-placeholder"
          data-testid="work-list-loading"
          role="status"
          aria-live="polite"
        >
          Getting your Work records…
        </p>
      ) : null}
      {works.length === 0 && status === 'unavailable' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-unavailable"
          role="status"
        >
          <p className="eyebrow">Work isn&apos;t available here</p>
          {/* feature_unavailable means this workspace does not compose the
              Product Work surface at all. Offering Retry would be a false
              promise, so this state has no Retry control. */}
          <p>This workspace doesn&apos;t currently offer Work execution.</p>
        </div>
      ) : null}
      {works.length === 0 && status === 'error' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-error"
          role="alert"
        >
          <p className="eyebrow">Couldn&apos;t load Work</p>
          {/* A failed read must not be mistaken for a statement about any
              Work's own state, and must not leak the upstream error string
              (which can be control-plane prose). The backend owns product
              state; an empty pane here means "we could not ask", not
              "nothing needs you". */}
          <p>
            This is a connection problem, not a statement about the status of
            any Work.
          </p>
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}
      {works.length === 0 && status === 'ready' ? (
        <div
          className="pane-placeholder"
          data-testid="work-list-empty"
          role="status"
        >
          <p>Nothing is available yet.</p>
          <button type="button" onClick={onCreateNew}>
            New Work
          </button>
        </div>
      ) : null}
      {works.length > 0 ? (
        <ul
          className="work-list"
          aria-label="Work items"
          data-testid="work-list"
        >
          {works.map((work) => (
            <WorkListRow
              key={work.id}
              work={work}
              selected={selectedWorkId === work.id}
              originConversationId={originConversationId}
            />
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function WorkListRow({
  work,
  selected,
  originConversationId,
}: {
  readonly work: WorkListItem;
  readonly selected: boolean;
  readonly originConversationId: string | null;
}) {
  const stateView = productStatePresentation(work.product_state);
  return (
    <li>
      <Link
        aria-current={selected ? 'page' : undefined}
        className="work-list-item"
        to={workPath(work.id, originConversationId)}
      >
        <span className="work-list-mark" aria-hidden="true">
          {work.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="work-list-copy">
          <strong>{work.title}</strong>
          <span className="work-list-description">{stateView.description}</span>
          <span className="work-list-summary">{latestRunSummary(work)}</span>
        </span>
        <span
          className="work-list-status"
          data-product-state={work.product_state}
        >
          <span
            aria-hidden="true"
            className={`work-status-dot work-status-dot--${work.product_state}`}
          />
          {stateView.label}
        </span>
      </Link>
    </li>
  );
}

export default WorkPane;
