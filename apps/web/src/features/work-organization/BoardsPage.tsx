import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  WorkBoardDto,
  WorkBoardSnapshotDto,
  WorkItemDto,
} from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
import { workOrganizationClient } from './client';
import './work-organization.css';

const BOARDS_LOAD_ERROR =
  'Boards could not be loaded. Check your connection and try again.';
const BOARDS_UNAVAILABLE =
  "This workspace doesn't currently offer Board organization.";
const BOARDS_ACTION_ERROR =
  'That Board change could not be saved. Please try again.';

type RecoverableError = {
  readonly source: 'snapshot' | 'action';
  readonly message: string;
  readonly retry?: () => void;
};

// The left pane's "No Boards yet." claim is a factual statement about the
// user's data. It must only be reachable from a successful load, never from
// "we could not ask" (error) or "this capability is off" (unavailable).
type ListStatus = 'loading' | 'ready' | 'unavailable' | 'error';
type SelectionStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';

export interface BoardsPageProps {
  readonly selectedBoardId?: string | null;
}

export function BoardsPage({ selectedBoardId = null }: BoardsPageProps) {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<readonly WorkBoardDto[]>([]);
  const [snapshot, setSnapshot] = useState<WorkBoardSnapshotDto | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [selectionStatus, setSelectionStatus] =
    useState<SelectionStatus>('idle');
  const [error, setError] = useState<RecoverableError | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');

  const loadBoards = useCallback(async () => {
    setListStatus('loading');
    try {
      const next = await workOrganizationClient.listBoards();
      setBoards(next);
      setListStatus('ready');
      if (!selectedBoardId && next[0]) {
        navigate(`/boards/${encodeURIComponent(next[0].id)}`, {
          replace: true,
        });
      }
    } catch (reason) {
      setListStatus(isFeatureUnavailable(reason) ? 'unavailable' : 'error');
    }
  }, [navigate, selectedBoardId]);

  const loadSnapshot = useCallback(async () => {
    if (!selectedBoardId) {
      setSnapshot(null);
      setSelectionStatus('idle');
      return;
    }
    setSnapshot(null);
    setSelectionStatus('loading');
    try {
      setSnapshot(await workOrganizationClient.getBoard(selectedBoardId));
      setSelectionStatus('ready');
      setError((current) => (current?.source === 'snapshot' ? null : current));
    } catch (reason) {
      if (isResourceNotFound(reason)) {
        setSelectionStatus('not_found');
        setError(null);
        return;
      }
      setSelectionStatus('error');
      setError({
        source: 'snapshot',
        message: BOARDS_LOAD_ERROR,
        retry: () => void loadSnapshot(),
      });
      setSnapshot(null);
    }
  }, [selectedBoardId]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  async function createBoard(event: React.FormEvent) {
    event.preventDefault();
    const title = newBoardTitle.trim();
    if (!title) return;
    try {
      const board = await workOrganizationClient.createBoard({ title });
      setBoards((current) => [board, ...current]);
      setNewBoardTitle('');
      setCreatingBoard(false);
      navigate(`/boards/${encodeURIComponent(board.id)}`);
    } catch {
      setError({ source: 'action', message: BOARDS_ACTION_ERROR });
    }
  }

  return (
    <>
      <aside className="sidebar work-org-pane" aria-label="Boards navigation">
        <div className="pane-heading work-org-heading">
          <div>
            <span className="eyebrow">Coworker Workspace</span>
            <h1>Boards</h1>
          </div>
          <button
            type="button"
            className="work-org-primary"
            disabled={listStatus === 'unavailable' || listStatus === 'error'}
            onClick={() => setCreatingBoard(true)}
          >
            + Board
          </button>
        </div>
        {creatingBoard ? (
          <form
            className="work-org-filters"
            onSubmit={(event) => void createBoard(event)}
          >
            <input
              autoFocus
              aria-label="New board title"
              value={newBoardTitle}
              onChange={(event) => setNewBoardTitle(event.target.value)}
              placeholder="Board title"
            />
            <button type="submit">Create</button>
            <button type="button" onClick={() => setCreatingBoard(false)}>
              Cancel
            </button>
          </form>
        ) : null}
        <div className="work-org-list">
          {listStatus === 'loading' && boards.length === 0 ? (
            <p className="pane-placeholder">Loading Boards…</p>
          ) : null}
          {listStatus === 'unavailable' ? (
            <div className="pane-placeholder" role="status">
              <p>{BOARDS_UNAVAILABLE}</p>
            </div>
          ) : null}
          {listStatus === 'error' ? (
            <div className="pane-placeholder" role="alert">
              <p>{BOARDS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void loadBoards()}>
                Retry
              </button>
            </div>
          ) : null}
          {listStatus === 'ready' && boards.length === 0 ? (
            <p className="pane-placeholder">No Boards yet.</p>
          ) : null}
          {listStatus === 'ready'
            ? boards.map((board) => (
                <button
                  type="button"
                  className="work-org-list-item"
                  data-active={selectedBoardId === board.id ? 'true' : 'false'}
                  key={board.id}
                  onClick={() =>
                    navigate(`/boards/${encodeURIComponent(board.id)}`)
                  }
                >
                  <strong>{board.title}</strong>
                  <small>
                    {board.description ?? 'Shared human + Agent board'}
                  </small>
                </button>
              ))
            : null}
        </div>
      </aside>

      <main className="chat-panel work-board-main">
        <TitleBar section="Boards" />
        <section className="work-org-content" aria-label="Board canvas">
          <div className="work-org-mobile-picker">
            <label>
              <span>Board</span>
              <select
                aria-label="Choose a Board"
                value={selectedBoardId ?? ''}
                onChange={(event) =>
                  navigate(
                    event.target.value
                      ? `/boards/${encodeURIComponent(event.target.value)}`
                      : '/boards',
                  )
                }
              >
                <option value="">Choose a Board</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="work-org-primary"
              disabled={listStatus === 'unavailable' || listStatus === 'error'}
              onClick={() => setCreatingBoard(true)}
            >
              + Board
            </button>
          </div>
          {error &&
          selectionStatus !== 'not_found' &&
          selectionStatus !== 'error' ? (
            <div className="work-org-error" role="alert">
              <p>{error.message}</p>
              {error.retry ? (
                <button type="button" onClick={error.retry}>
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {listStatus === 'unavailable' ? (
            <div className="work-main-empty" data-testid="boards-unavailable">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>Boards aren&apos;t available</h1>
              <p>{BOARDS_UNAVAILABLE}</p>
            </div>
          ) : listStatus === 'error' ? (
            <div className="work-main-empty" data-testid="boards-error">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>Boards could not be loaded</h1>
              <p>{BOARDS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void loadBoards()}>
                Retry
              </button>
            </div>
          ) : selectionStatus === 'not_found' ? (
            <div className="work-main-empty" data-testid="boards-not-found">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>The selected Board is unavailable.</h1>
              <p>
                This Board may have been deleted or moved out of this workspace.
              </p>
              <button type="button" onClick={() => navigate('/boards')}>
                Back to Boards
              </button>
            </div>
          ) : selectionStatus === 'error' ? (
            <div
              className="work-main-empty"
              data-testid="boards-selected-error"
            >
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>Board could not be loaded</h1>
              <p>{BOARDS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void loadSnapshot()}>
                Retry
              </button>
            </div>
          ) : creatingBoard ? (
            <BoardCreationForm
              className="work-org-board-create--mobile"
              title={newBoardTitle}
              onCancel={() => setCreatingBoard(false)}
              onChange={setNewBoardTitle}
              onSubmit={createBoard}
            />
          ) : snapshot ? (
            <BoardCanvas
              snapshot={snapshot}
              onSnapshot={setSnapshot}
              onBoardDeleted={async () => {
                setSnapshot(null);
                await loadBoards();
                navigate('/boards');
              }}
              onError={(message) => setError({ source: 'action', message })}
            />
          ) : (
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>Choose a Board</h1>
              <p>
                Organize lightweight work before it becomes formal Work
                execution.
              </p>
              <button type="button" onClick={() => setCreatingBoard(true)}>
                New Board
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function BoardCreationForm({
  className,
  title,
  onCancel,
  onChange,
  onSubmit,
}: {
  readonly className: string;
  readonly title: string;
  readonly onCancel: () => void;
  readonly onChange: (title: string) => void;
  readonly onSubmit: (event: React.FormEvent) => Promise<void>;
}) {
  return (
    <form
      className={`work-org-card work-org-board-create ${className}`}
      onSubmit={(event) => void onSubmit(event)}
    >
      <span className="eyebrow">New Board</span>
      <h2>Name this Board</h2>
      <label>
        Board title
        <input
          autoFocus
          value={title}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Board title"
        />
      </label>
      <div className="work-org-actions">
        <button
          type="submit"
          className="work-org-primary"
          disabled={!title.trim()}
        >
          Create Board
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BoardCanvas({
  snapshot,
  onSnapshot,
  onBoardDeleted,
  onError,
}: {
  readonly snapshot: WorkBoardSnapshotDto;
  readonly onSnapshot: (snapshot: WorkBoardSnapshotDto) => void;
  readonly onBoardDeleted: () => Promise<void>;
  readonly onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const placementsByColumn = useMemo(() => {
    const result = new Map<
      string,
      Array<{ item: WorkItemDto; position: number }>
    >();
    const items = new Map(snapshot.work_items.map((item) => [item.id, item]));
    for (const column of snapshot.columns) result.set(column.id, []);
    for (const placement of snapshot.placements) {
      const item = items.get(placement.work_item_id);
      if (!item) continue;
      result
        .get(placement.column_id)
        ?.push({ item, position: placement.position });
    }
    for (const entries of result.values())
      entries.sort((a, b) => a.position - b.position);
    return result;
  }, [snapshot]);

  async function refresh() {
    onSnapshot(await workOrganizationClient.getBoard(snapshot.board.id));
  }

  async function createColumn(event: React.FormEvent) {
    event.preventDefault();
    if (!newColumnTitle.trim()) return;
    try {
      await workOrganizationClient.createColumn(snapshot.board.id, {
        title: newColumnTitle.trim(),
        position: snapshot.columns.length,
      });
      setNewColumnTitle('');
      setAddingColumn(false);
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function renameBoard() {
    const title = window.prompt('Board title', snapshot.board.title)?.trim();
    if (!title || title === snapshot.board.title) return;
    try {
      await workOrganizationClient.updateBoard(snapshot.board.id, { title });
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function deleteBoard() {
    if (
      !window.confirm(
        `Delete “${snapshot.board.title}”? WorkItems are kept; only this Board projection is removed.`,
      )
    )
      return;
    try {
      await workOrganizationClient.deleteBoard(snapshot.board.id);
      await onBoardDeleted();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function renameColumn(columnId: string, current: string) {
    const title = window.prompt('Column title', current)?.trim();
    if (!title || title === current) return;
    try {
      await workOrganizationClient.updateColumn(snapshot.board.id, columnId, {
        title,
      });
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function deleteColumn(columnId: string, title: string) {
    if (
      !window.confirm(
        `Delete column “${title}”? Cards remain as Tasks but leave this Board.`,
      )
    )
      return;
    try {
      await workOrganizationClient.deleteColumn(snapshot.board.id, columnId);
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function addCard(columnId: string, position: number) {
    const title = window.prompt('Task title')?.trim();
    if (!title) return;
    const description = window.prompt('Description (optional)')?.trim() ?? '';
    try {
      await workOrganizationClient.createWorkItem({
        title,
        description: description || null,
        boardId: snapshot.board.id,
        columnId,
        position,
      });
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  async function moveCard(
    workItemId: string,
    columnId: string,
    position: number,
  ) {
    try {
      await workOrganizationClient.placeWorkItem(snapshot.board.id, {
        columnId,
        workItemId,
        position,
      });
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  return (
    <>
      <header className="work-board-toolbar">
        <div>
          <span className="eyebrow">Shared work</span>
          <h1>{snapshot.board.title}</h1>
          {snapshot.board.description ? (
            <p className="work-org-muted">{snapshot.board.description}</p>
          ) : null}
        </div>
        <div className="work-org-actions">
          <button type="button" onClick={() => void renameBoard()}>
            Rename
          </button>
          <button type="button" onClick={() => void deleteBoard()}>
            Delete
          </button>
          <button
            type="button"
            className="work-org-primary"
            onClick={() => setAddingColumn(true)}
          >
            + Column
          </button>
        </div>
      </header>
      <div className="work-board-canvas">
        {snapshot.columns.map((column) => {
          const cards = placementsByColumn.get(column.id) ?? [];
          return (
            <section
              key={column.id}
              className="work-board-column"
              data-drag-over={dragOverColumnId === column.id ? 'true' : 'false'}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverColumnId(column.id);
              }}
              onDragLeave={() => setDragOverColumnId(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverColumnId(null);
                const workItemId = event.dataTransfer.getData(
                  'application/x-agent-server-work-item',
                );
                if (workItemId)
                  void moveCard(workItemId, column.id, cards.length);
              }}
            >
              <div className="work-board-column-header">
                <h2>
                  {column.title} · {cards.length}
                </h2>
                <div className="work-board-column-actions">
                  <button
                    type="button"
                    aria-label={`Rename ${column.title}`}
                    onClick={() => void renameColumn(column.id, column.title)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${column.title}`}
                    onClick={() => void deleteColumn(column.id, column.title)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="work-board-cards">
                {cards.map(({ item }) => (
                  <article
                    key={item.id}
                    className="work-board-card"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(
                        'application/x-agent-server-work-item',
                        item.id,
                      );
                    }}
                    onDoubleClick={() =>
                      navigate(`/tasks/${encodeURIComponent(item.id)}`)
                    }
                  >
                    <span
                      className={`work-org-status work-org-status--${item.status}`}
                    >
                      {item.status.replace('_', ' ')}
                    </span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.assignee_id
                        ? `Assigned · ${item.assignee_id}`
                        : 'Unassigned'}
                    </small>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/tasks/${encodeURIComponent(item.id)}`)
                      }
                    >
                      Open Task
                    </button>
                    {snapshot.columns.length > 1 ? (
                      <label className="work-board-card-move">
                        <span>Move to</span>
                        <select
                          aria-label={`Move ${item.title} to another column`}
                          defaultValue=""
                          onChange={(event) => {
                            const columnId = event.currentTarget.value;
                            event.currentTarget.value = '';
                            if (!columnId) return;
                            void moveCard(
                              item.id,
                              columnId,
                              (placementsByColumn.get(columnId) ?? []).length,
                            );
                          }}
                        >
                          <option value="">Choose column…</option>
                          {snapshot.columns
                            .filter((target) => target.id !== column.id)
                            .map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.title}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="work-board-add-card"
                onClick={() => void addCard(column.id, cards.length)}
              >
                + Task
              </button>
            </section>
          );
        })}
        {addingColumn ? (
          <form
            className="work-board-column"
            onSubmit={(event) => void createColumn(event)}
          >
            <input
              autoFocus
              value={newColumnTitle}
              onChange={(event) => setNewColumnTitle(event.target.value)}
              placeholder="Column title"
            />
            <div className="work-org-actions">
              <button type="submit" className="work-org-primary">
                Add
              </button>
              <button type="button" onClick={() => setAddingColumn(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="work-board-column work-board-add-column"
            onClick={() => setAddingColumn(true)}
          >
            + Add column
          </button>
        )}
      </div>
    </>
  );
}

export default BoardsPage;
