import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  WorkBoardDto,
  WorkBoardSnapshotDto,
  WorkItemDto,
} from '@atomlink-ye/agent-server/product-contract';
import { WORK_BOARD_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import { loadCoworkers } from '../agents/agents-gateway';
import type { Coworker } from '../agents/contracts';
import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
import BoardCardPeek from './BoardCardPeek';
import { planCardMove } from './board-move';
import { workOrganizationClient } from './client';
import { descriptionPreview, formatWorkTime } from './format';
import MentionedText from './MentionedText';
import MentionTextField from './MentionTextField';
import ParticipantChip from './ParticipantChip';
import { buildParticipantDirectory, type Participant } from './participants';
import {
  columnKind,
  findDoingColumn,
  readCommentCount,
  readMentionIds,
} from './work-item-extensions';
import { CommentCount, MentionRow, StatusBadge } from './WorkItemMeta';
import './work-organization.css';

const BOARDS_LOAD_ERROR = '看板加载失败，请检查网络连接后重试。';
const BOARDS_UNAVAILABLE = '当前工作区暂未开启看板协作。';
const BOARDS_ACTION_ERROR = '这次看板改动没能保存，请重试。';

/**
 * How often an open Board re-reads its snapshot.
 *
 * A Board is shared, so someone else's move has to show up without a reload.
 * There is no event bus for work organization the way conversations have one,
 * so this is the same visibility-aware poll `ConversationsPage` uses, at the
 * same interval as its list: frequent enough to feel live, cheap enough to
 * leave running, and stopped outright while the tab is hidden.
 */
const BOARD_REFRESH_INTERVAL_MS = 5000;

/** What a card drag carries; a column drag carries its own type. */
const CARD_MIME = 'application/x-agent-server-work-item';
const COLUMN_MIME = 'application/x-agent-server-board-column';

type RecoverableError = {
  readonly source: 'snapshot' | 'action';
  readonly message: string;
  readonly retry?: () => void;
};

// The left pane's "还没有看板。" claim is a factual statement about the
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
  const selectionRequest = useRef(0);
  const [error, setError] = useState<RecoverableError | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [agents, setAgents] = useState<readonly Coworker[]>([]);
  // A refresh in flight while the user is dragging would land on top of the
  // optimistic snapshot, so every mutation holds this counter for its duration
  // and the poll simply stands down while it is held.
  const mutations = useRef(0);
  const refreshInFlight = useRef(false);

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
    const request = ++selectionRequest.current;
    if (!selectedBoardId) {
      setSnapshot(null);
      setSelectionStatus('idle');
      return;
    }
    setSnapshot(null);
    setSelectionStatus('loading');
    try {
      const next = await workOrganizationClient.getBoard(selectedBoardId);
      if (request !== selectionRequest.current) return;
      setSnapshot(next);
      setSelectionStatus('ready');
      setError((current) => (current?.source === 'snapshot' ? null : current));
    } catch (reason) {
      if (request !== selectionRequest.current) return;
      if (isResourceNotFound(reason, WORK_BOARD_NOT_FOUND_CODE)) {
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

  // The mention directory needs the Coworker roster. A workspace that does not
  // compose the agents surface simply has no Coworkers to offer, which is not
  // an error the Board has to report.
  useEffect(() => {
    let disposed = false;
    void loadCoworkers()
      .then((next) => {
        if (!disposed) setAgents(next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedBoardId || selectionStatus !== 'ready') return;
    let disposed = false;
    let intervalId: number | null = null;
    const stopPolling = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };
    const refresh = (): void => {
      if (
        disposed ||
        refreshInFlight.current ||
        mutations.current > 0 ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      refreshInFlight.current = true;
      void workOrganizationClient
        .getBoard(selectedBoardId)
        .then((next) => {
          // Another mutation may have started while this read was in flight,
          // and the user may have navigated to a different Board.
          if (disposed || mutations.current > 0) return;
          setSnapshot((current) =>
            current && current.board.id === next.board.id ? next : current,
          );
        })
        // A failed poll is not news the reader can act on — the surface is
        // already showing a snapshot that loaded, and the next tick retries.
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight.current = false;
        });
    };
    const startPolling = (): void => {
      if (disposed || document.visibilityState !== 'visible') return;
      stopPolling();
      intervalId = window.setInterval(refresh, BOARD_REFRESH_INTERVAL_MS);
    };
    const handleVisibilityChange = (): void => {
      stopPolling();
      if (document.visibilityState === 'visible') {
        refresh();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startPolling();
    return () => {
      disposed = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedBoardId, selectionStatus]);

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
      <aside className="sidebar work-org-pane" aria-label="看板导航">
        <div className="pane-heading work-org-heading">
          <div>
            <span className="eyebrow">AI 同事工作区</span>
            <h1>看板</h1>
          </div>
          <button
            type="button"
            className="work-org-primary"
            disabled={listStatus === 'unavailable' || listStatus === 'error'}
            onClick={() => setCreatingBoard(true)}
          >
            + 新建看板
          </button>
        </div>
        {creatingBoard ? (
          <form
            className="work-org-filters"
            onSubmit={(event) => void createBoard(event)}
          >
            <input
              autoFocus
              aria-label="新看板标题"
              value={newBoardTitle}
              onChange={(event) => setNewBoardTitle(event.target.value)}
              placeholder="看板标题"
            />
            <button type="submit">创建</button>
            <button type="button" onClick={() => setCreatingBoard(false)}>
              取消
            </button>
          </form>
        ) : null}
        <div className="work-org-list">
          {listStatus === 'loading' && boards.length === 0 ? (
            <p className="pane-placeholder">正在加载看板…</p>
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
                重试
              </button>
            </div>
          ) : null}
          {listStatus === 'ready' && boards.length === 0 ? (
            <p className="pane-placeholder">还没有看板。</p>
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
                  <small>{board.description ?? '人和 AI 同事共用的看板'}</small>
                </button>
              ))
            : null}
        </div>
      </aside>

      <main className="chat-panel work-board-main">
        <TitleBar section="看板" />
        <section className="work-org-content" aria-label="看板画布">
          <div className="work-org-mobile-picker">
            <label>
              <span>看板</span>
              <select
                aria-label="选择看板"
                value={selectedBoardId ?? ''}
                onChange={(event) =>
                  navigate(
                    event.target.value
                      ? `/boards/${encodeURIComponent(event.target.value)}`
                      : '/boards',
                  )
                }
              >
                <option value="">选择看板</option>
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
              + 新建看板
            </button>
          </div>
          {error &&
          selectionStatus !== 'not_found' &&
          selectionStatus !== 'error' ? (
            <div className="work-org-error" role="alert">
              <p>{error.message}</p>
              {error.retry ? (
                <button type="button" onClick={error.retry}>
                  重试
                </button>
              ) : null}
            </div>
          ) : null}
          {listStatus === 'unavailable' ? (
            <div className="work-main-empty" data-testid="boards-unavailable">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>看板功能未开启</h1>
              <p>{BOARDS_UNAVAILABLE}</p>
            </div>
          ) : listStatus === 'error' ? (
            <div className="work-main-empty" data-testid="boards-error">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>看板加载失败</h1>
              <p>{BOARDS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void loadBoards()}>
                重试
              </button>
            </div>
          ) : selectionStatus === 'loading' ? (
            <div
              className="work-main-empty"
              data-testid="boards-selected-loading"
            >
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>正在加载所选看板…</h1>
            </div>
          ) : selectionStatus === 'not_found' ? (
            <div className="work-main-empty" data-testid="boards-not-found">
              <span className="work-main-icon" aria-hidden="true">
                ▦
              </span>
              <h1>所选看板已不可用。</h1>
              <p>这个看板可能已被删除，或已移出当前工作区。</p>
              <button type="button" onClick={() => navigate('/boards')}>
                返回看板列表
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
              <h1>看板加载失败</h1>
              <p>{BOARDS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void loadSnapshot()}>
                重试
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
              agents={agents}
              onSnapshot={setSnapshot}
              onMutationStart={() => {
                mutations.current += 1;
              }}
              onMutationEnd={() => {
                mutations.current = Math.max(0, mutations.current - 1);
              }}
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
              <h1>选择一个看板</h1>
              <p>在工作正式进入 Work 执行之前，先用看板把它梳理清楚。</p>
              <button type="button" onClick={() => setCreatingBoard(true)}>
                新建看板
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * The snapshot a planned move produces, before the server has confirmed it.
 *
 * Only positions and the moved card's column change, so the placement rows
 * keep their own identities and timestamps — this is the same snapshot with the
 * cards where the reader just put them.
 */
function applyCardPlan(
  snapshot: WorkBoardSnapshotDto,
  columnId: string,
  placements: readonly {
    readonly workItemId: string;
    readonly position: number;
  }[],
): WorkBoardSnapshotDto {
  const planned = new Map(
    placements.map((placement) => [placement.workItemId, placement.position]),
  );
  return {
    ...snapshot,
    placements: snapshot.placements.map((placement) => {
      const position = planned.get(placement.work_item_id);
      return position === undefined
        ? placement
        : { ...placement, column_id: columnId, position };
    }),
  };
}

function BoardAuthoringForm({
  className,
  eyebrow,
  heading,
  submitLabel,
  submitDisabled = false,
  onCancel,
  onSubmit,
  children,
}: {
  readonly className: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly submitLabel: string;
  readonly submitDisabled?: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (event: React.FormEvent) => Promise<void>;
  readonly children: React.ReactNode;
}) {
  return (
    <form
      className={`work-org-card work-org-board-create work-org-form ${className}`}
      onSubmit={(event) => void onSubmit(event)}
    >
      <span className="eyebrow">{eyebrow}</span>
      <h2>{heading}</h2>
      {children}
      <div className="work-org-actions">
        <button
          type="submit"
          className="work-org-primary"
          disabled={submitDisabled}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
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
    <BoardAuthoringForm
      className={className}
      eyebrow="新建看板"
      heading="给这个看板起个名字"
      submitLabel="创建看板"
      submitDisabled={!title.trim()}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      <label>
        看板标题
        <input
          autoFocus
          value={title}
          onChange={(event) => onChange(event.target.value)}
          placeholder="看板标题"
        />
      </label>
    </BoardAuthoringForm>
  );
}

function BoardCanvas({
  snapshot,
  agents,
  onSnapshot,
  onMutationStart,
  onMutationEnd,
  onBoardDeleted,
  onError,
}: {
  readonly snapshot: WorkBoardSnapshotDto;
  readonly agents: readonly Coworker[];
  readonly onSnapshot: (snapshot: WorkBoardSnapshotDto) => void;
  readonly onMutationStart: () => void;
  readonly onMutationEnd: () => void;
  readonly onBoardDeleted: () => Promise<void>;
  readonly onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [authoring, setAuthoring] = useState<
    | {
        readonly kind: 'rename-board';
        readonly title: string;
      }
    | {
        readonly kind: 'rename-column';
        readonly columnId: string;
        readonly title: string;
      }
    | {
        readonly kind: 'create-card';
        readonly columnId: string;
        readonly position: number;
        readonly title: string;
        readonly description: string;
      }
    | {
        readonly kind: 'delete-board';
      }
    | {
        readonly kind: 'delete-column';
        readonly columnId: string;
        readonly title: string;
      }
    | null
  >(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<{
    readonly columnId: string;
    readonly index: number;
  } | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [columnDropId, setColumnDropId] = useState<string | null>(null);
  const [peekWorkItemId, setPeekWorkItemId] = useState<string | null>(null);
  // Set once this deployment answers "no claim endpoint here", so the panel
  // stops offering an action that cannot exist yet.
  const [claimSupported, setClaimSupported] = useState(true);

  const columns = useMemo(
    () =>
      [...snapshot.columns].sort(
        (left, right) =>
          left.position - right.position ||
          left.title.localeCompare(right.title),
      ),
    [snapshot.columns],
  );

  // The Board's own mention/assignee directory: the Coworker roster plus every
  // principal these cards have actually shown us.
  const participants = useMemo(
    () =>
      buildParticipantDirectory({
        agents,
        principalIds: [
          snapshot.board.created_by,
          ...snapshot.work_items.flatMap((item) => [
            item.created_by,
            item.assignee_id,
          ]),
        ],
      }),
    [agents, snapshot.board.created_by, snapshot.work_items],
  );

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

  async function submitAuthoring(event: React.FormEvent) {
    event.preventDefault();
    if (!authoring) return;
    try {
      if (authoring.kind === 'rename-board') {
        const title = authoring.title.trim();
        if (!title || title === snapshot.board.title) return;
        await workOrganizationClient.updateBoard(snapshot.board.id, { title });
        await refresh();
      } else if (authoring.kind === 'delete-board') {
        await workOrganizationClient.deleteBoard(snapshot.board.id);
        await onBoardDeleted();
      } else if (authoring.kind === 'rename-column') {
        const title = authoring.title.trim();
        const column = snapshot.columns.find(
          (entry) => entry.id === authoring.columnId,
        );
        if (!title || title === column?.title) return;
        await workOrganizationClient.updateColumn(
          snapshot.board.id,
          authoring.columnId,
          { title },
        );
        await refresh();
      } else if (authoring.kind === 'delete-column') {
        await workOrganizationClient.deleteColumn(
          snapshot.board.id,
          authoring.columnId,
        );
        await refresh();
      } else {
        const title = authoring.title.trim();
        if (!title) return;
        await workOrganizationClient.createWorkItem({
          title,
          description: authoring.description.trim() || null,
          boardId: snapshot.board.id,
          columnId: authoring.columnId,
          position: authoring.position,
        });
        await refresh();
      }
      setAuthoring(null);
    } catch {
      onError(BOARDS_ACTION_ERROR);
    }
  }

  /**
   * Move a card to `index` within a column, optimistically.
   *
   * Cumora reconciles a drag by interpolating a new position between the cards
   * the drop landed between, so only the moved card is written. `planCardMove`
   * does the same against this backend's integer positions and falls back to
   * renumbering the column when no integer fits. The canvas shows the result
   * immediately and the server read is what finally decides — a rejected move
   * snaps back to whatever the Board really says.
   */
  async function moveCard(workItemId: string, columnId: string, index: number) {
    const destination = (placementsByColumn.get(columnId) ?? [])
      .filter((entry) => entry.item.id !== workItemId)
      .map((entry) => ({
        workItemId: entry.item.id,
        position: entry.position,
      }));
    const plan = planCardMove({ workItemId, destination, index });
    onMutationStart();
    onSnapshot(applyCardPlan(snapshot, columnId, plan.placements));
    try {
      for (const placement of plan.placements)
        await workOrganizationClient.placeWorkItem(snapshot.board.id, {
          columnId,
          workItemId: placement.workItemId,
          position: placement.position,
        });
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
      // The optimistic snapshot is now a claim nobody backs. Whatever the
      // server says replaces it, even if only part of a renumber landed.
      await refresh().catch(() => undefined);
    } finally {
      onMutationEnd();
    }
  }

  /** Reorder columns by dropping one onto another, optimistically. */
  async function moveColumn(columnId: string, beforeColumnId: string) {
    if (columnId === beforeColumnId) return;
    const ordered = columns
      .map((column) => column.id)
      .filter((id) => id !== columnId);
    const at = ordered.indexOf(beforeColumnId);
    ordered.splice(at < 0 ? ordered.length : at, 0, columnId);
    const positions = new Map(ordered.map((id, index) => [id, index]));
    const changed = columns.filter(
      (column) => positions.get(column.id) !== column.position,
    );
    if (changed.length === 0) return;
    onMutationStart();
    onSnapshot({
      ...snapshot,
      columns: snapshot.columns.map((column) => ({
        ...column,
        position: positions.get(column.id) ?? column.position,
      })),
    });
    try {
      for (const column of changed)
        await workOrganizationClient.updateColumn(
          snapshot.board.id,
          column.id,
          {
            position: positions.get(column.id) ?? column.position,
          },
        );
      await refresh();
    } catch {
      onError(BOARDS_ACTION_ERROR);
      await refresh().catch(() => undefined);
    } finally {
      onMutationEnd();
    }
  }

  /** After a claim, the card belongs where work in progress lives. */
  async function moveClaimedCard(workItemId: string) {
    const doing = findDoingColumn(columns);
    const holding = columns.find((column) =>
      (placementsByColumn.get(column.id) ?? []).some(
        (entry) => entry.item.id === workItemId,
      ),
    );
    if (!doing || holding?.id === doing.id) {
      await refresh().catch(() => onError(BOARDS_ACTION_ERROR));
      return;
    }
    await moveCard(
      workItemId,
      doing.id,
      (placementsByColumn.get(doing.id) ?? []).length,
    );
  }

  function readDragKind(event: React.DragEvent): 'card' | 'column' | null {
    const types = [...event.dataTransfer.types];
    if (types.includes(COLUMN_MIME)) return 'column';
    if (types.includes(CARD_MIME)) return 'card';
    // Chromium hides custom types from `dragover`, so the in-progress drag we
    // started is the only other thing this can be.
    return draggingColumnId ? 'column' : 'card';
  }

  return (
    <>
      <header className="work-board-toolbar">
        <div>
          <span className="eyebrow">共享工作</span>
          <h1>{snapshot.board.title}</h1>
          {snapshot.board.description ? (
            <p className="work-org-muted">{snapshot.board.description}</p>
          ) : null}
        </div>
        <div className="work-org-actions">
          <button
            type="button"
            onClick={() =>
              setAuthoring({
                kind: 'rename-board',
                title: snapshot.board.title,
              })
            }
          >
            重命名
          </button>
          <button
            type="button"
            onClick={() => setAuthoring({ kind: 'delete-board' })}
          >
            删除
          </button>
          <button
            type="button"
            className="work-org-primary"
            onClick={() => setAddingColumn(true)}
          >
            + 新建列
          </button>
        </div>
      </header>
      {authoring ? (
        <BoardAuthoringForm
          className="work-board-authoring"
          eyebrow={
            authoring.kind === 'create-card'
              ? '新建任务'
              : authoring.kind.startsWith('delete')
                ? '确认删除'
                : '编辑看板'
          }
          heading={
            authoring.kind === 'rename-board'
              ? '重命名这个看板'
              : authoring.kind === 'rename-column'
                ? '重命名这一列'
                : authoring.kind === 'create-card'
                  ? '添加任务卡片'
                  : authoring.kind === 'delete-board'
                    ? `删除“${snapshot.board.title}”？`
                    : `删除列“${authoring.title}”？`
          }
          submitLabel={
            authoring.kind.startsWith('delete')
              ? '删除'
              : authoring.kind === 'create-card'
                ? '添加任务'
                : '保存'
          }
          submitDisabled={
            authoring.kind === 'create-card'
              ? !authoring.title.trim()
              : authoring.kind === 'rename-board'
                ? !authoring.title.trim() ||
                  authoring.title.trim() === snapshot.board.title
                : authoring.kind === 'rename-column'
                  ? !authoring.title.trim() ||
                    authoring.title.trim() ===
                      snapshot.columns.find(
                        (column) => column.id === authoring.columnId,
                      )?.title
                  : false
          }
          onCancel={() => setAuthoring(null)}
          onSubmit={submitAuthoring}
        >
          {authoring.kind === 'rename-board' ||
          authoring.kind === 'rename-column' ? (
            <label>
              {authoring.kind === 'rename-board' ? '看板标题' : '列标题'}
              <input
                autoFocus
                value={authoring.title}
                onChange={(event) =>
                  setAuthoring((current) =>
                    current &&
                    (current.kind === 'rename-board' ||
                      current.kind === 'rename-column')
                      ? { ...current, title: event.target.value }
                      : current,
                  )
                }
              />
            </label>
          ) : authoring.kind === 'create-card' ? (
            <>
              <MentionTextField
                label="任务标题"
                value={authoring.title}
                onChange={(title) =>
                  setAuthoring((current) =>
                    current?.kind === 'create-card'
                      ? { ...current, title }
                      : current,
                  )
                }
                participants={participants}
                placeholder="任务标题…"
                maxLength={200}
                multiline
                rows={2}
                submitOnModEnter
                autoFocus
                hint={
                  <small className="work-org-muted">
                    Enter 换行，⌘/Ctrl + Enter 提交；输入 @ 可以提及 AI
                    同事或团队成员。
                  </small>
                }
              />
              <MentionTextField
                label="描述（可选）"
                value={authoring.description}
                onChange={(description) =>
                  setAuthoring((current) =>
                    current?.kind === 'create-card'
                      ? { ...current, description }
                      : current,
                  )
                }
                participants={participants}
                placeholder="描述一下这个任务"
                multiline
                rows={4}
                hint={
                  <small className="work-org-muted">
                    输入 @ 可以提及 AI 同事或团队成员。
                  </small>
                }
              />
            </>
          ) : (
            <p>
              {authoring.kind === 'delete-board'
                ? '任务本身会保留，只移除这个看板视图。'
                : '卡片会作为任务保留，但会离开这个看板。'}
            </p>
          )}
        </BoardAuthoringForm>
      ) : null}
      <div className="work-board-shell">
        <div className="work-board-canvas">
          {columns.map((column) => {
            const cards = placementsByColumn.get(column.id) ?? [];
            return (
              <section
                key={column.id}
                className="work-board-column"
                data-column-kind={columnKind(column) ?? 'unknown'}
                data-dragging={
                  draggingColumnId === column.id ? 'true' : 'false'
                }
                data-drag-over={
                  dragOverColumnId === column.id ? 'true' : 'false'
                }
                data-column-drop-over={
                  columnDropId === column.id ? 'true' : 'false'
                }
                onDragOver={(event) => {
                  event.preventDefault();
                  if (readDragKind(event) === 'column') {
                    setColumnDropId(column.id);
                    return;
                  }
                  setDragOverColumnId(column.id);
                }}
                onDragLeave={() => {
                  setDragOverColumnId(null);
                  setColumnDropId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOverColumnId(null);
                  setColumnDropId(null);
                  setDropSlot(null);
                  const draggedColumnId =
                    event.dataTransfer.getData(COLUMN_MIME);
                  if (draggedColumnId) {
                    void moveColumn(draggedColumnId, column.id);
                    return;
                  }
                  const workItemId = event.dataTransfer.getData(CARD_MIME);
                  // A drop on the column body, not between two cards, means the
                  // end of the column.
                  if (workItemId)
                    void moveCard(workItemId, column.id, cards.length);
                }}
              >
                <div className="work-board-column-header">
                  <span
                    className="work-board-column-handle"
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-label={`拖动 ${column.title} 调整列顺序`}
                    data-testid="work-board-column-handle"
                    data-column-id={column.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(COLUMN_MIME, column.id);
                      setDraggingColumnId(column.id);
                    }}
                    onDragEnd={() => {
                      setDraggingColumnId(null);
                      setColumnDropId(null);
                    }}
                  >
                    <span aria-hidden="true">⠿</span>
                  </span>
                  <h2>
                    {column.title} · {cards.length}
                  </h2>
                  <div className="work-board-column-actions">
                    <button
                      type="button"
                      aria-label={`重命名 ${column.title}`}
                      onClick={() =>
                        setAuthoring({
                          kind: 'rename-column',
                          columnId: column.id,
                          title: column.title,
                        })
                      }
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${column.title}`}
                      onClick={() =>
                        setAuthoring({
                          kind: 'delete-column',
                          columnId: column.id,
                          title: column.title,
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="work-board-cards">
                  {cards.map(({ item }, index) => (
                    <div className="work-board-slot" key={item.id}>
                      <CardDropZone
                        columnId={column.id}
                        index={index}
                        active={
                          dropSlot?.columnId === column.id &&
                          dropSlot.index === index
                        }
                        onOver={() =>
                          setDropSlot({ columnId: column.id, index })
                        }
                        onDrop={(workItemId) => {
                          setDropSlot(null);
                          setDragOverColumnId(null);
                          void moveCard(workItemId, column.id, index);
                        }}
                      />
                      <BoardCard
                        item={item}
                        participants={participants}
                        columns={columns}
                        columnId={column.id}
                        onDragStart={() => setDropSlot(null)}
                        onOpenPeek={() => setPeekWorkItemId(item.id)}
                        onOpenTask={() =>
                          navigate(`/tasks/${encodeURIComponent(item.id)}`)
                        }
                        onMoveTo={(targetColumnId) =>
                          void moveCard(
                            item.id,
                            targetColumnId,
                            (placementsByColumn.get(targetColumnId) ?? [])
                              .length,
                          )
                        }
                      />
                    </div>
                  ))}
                  <CardDropZone
                    columnId={column.id}
                    index={cards.length}
                    active={
                      dropSlot?.columnId === column.id &&
                      dropSlot.index === cards.length
                    }
                    onOver={() =>
                      setDropSlot({ columnId: column.id, index: cards.length })
                    }
                    onDrop={(workItemId) => {
                      setDropSlot(null);
                      setDragOverColumnId(null);
                      void moveCard(workItemId, column.id, cards.length);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="work-board-add-card"
                  onClick={() =>
                    setAuthoring({
                      kind: 'create-card',
                      columnId: column.id,
                      position: cards.length,
                      title: '',
                      description: '',
                    })
                  }
                >
                  + 新建任务
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
                placeholder="列标题"
              />
              <div className="work-org-actions">
                <button type="submit" className="work-org-primary">
                  添加
                </button>
                <button type="button" onClick={() => setAddingColumn(false)}>
                  取消
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="work-board-column work-board-add-column"
              onClick={() => setAddingColumn(true)}
            >
              + 添加列
            </button>
          )}
        </div>
        {peekWorkItemId ? (
          <BoardCardPeek
            workItemId={peekWorkItemId}
            participants={participants}
            claimSupported={claimSupported}
            onClaimed={(workItemId) => void moveClaimedCard(workItemId)}
            onClaimUnsupported={() => setClaimSupported(false)}
            onClose={() => setPeekWorkItemId(null)}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The gap between two cards, as a drop target.
 *
 * Cumora decides a drop position from where the pointer is inside a column.
 * An explicit zone per gap says the same thing without measuring geometry, so
 * the index a drop resolves to is the one the reader saw highlighted.
 */
function CardDropZone({
  columnId,
  index,
  active,
  onOver,
  onDrop,
}: {
  readonly columnId: string;
  readonly index: number;
  readonly active: boolean;
  readonly onOver: () => void;
  readonly onDrop: (workItemId: string) => void;
}) {
  return (
    <div
      className="work-board-dropzone"
      data-testid="work-board-dropzone"
      data-column-id={columnId}
      data-drop-index={index}
      data-active={active ? 'true' : 'false'}
      aria-hidden="true"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(COLUMN_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        onOver();
      }}
      onDrop={(event) => {
        const workItemId = event.dataTransfer.getData(CARD_MIME);
        if (!workItemId) return;
        event.preventDefault();
        event.stopPropagation();
        onDrop(workItemId);
      }}
    />
  );
}

/**
 * A Board card.
 *
 * Cumora's card is a summary, not a title: status, a description preview, who
 * holds it, who was mentioned, how much conversation it carries. Every one of
 * those signals is optional here — the projection reports some of them only
 * once the backend ships the field — and an absent signal renders as nothing
 * rather than as a zero or a guess.
 */
function BoardCard({
  item,
  participants,
  columns,
  columnId,
  onDragStart,
  onOpenPeek,
  onOpenTask,
  onMoveTo,
}: {
  readonly item: WorkItemDto;
  readonly participants: readonly Participant[];
  readonly columns: readonly WorkBoardSnapshotDto['columns'][number][];
  readonly columnId: string;
  readonly onDragStart: () => void;
  readonly onOpenPeek: () => void;
  readonly onOpenTask: () => void;
  readonly onMoveTo: (columnId: string) => void;
}) {
  const preview = descriptionPreview(item.description, 120);
  return (
    <article
      className="work-board-card"
      data-testid="work-board-card"
      data-work-item-id={item.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(CARD_MIME, item.id);
        onDragStart();
      }}
      onClick={(event) => {
        // The card's own controls are not the card.
        if (
          (event.target as HTMLElement).closest(
            'button, select, input, textarea, label, a',
          )
        )
          return;
        onOpenPeek();
      }}
      onDoubleClick={onOpenTask}
    >
      <span className="work-board-card-top">
        <StatusBadge status={item.status} />
        <small className="work-org-muted">
          {formatWorkTime(item.updated_at)}
        </small>
      </span>
      <strong>{item.title}</strong>
      {preview ? (
        <small className="work-board-card-preview">
          <MentionedText text={preview} participants={participants} />
        </small>
      ) : null}
      <MentionRow ids={readMentionIds(item)} participants={participants} />
      <span className="work-board-card-footer">
        <ParticipantChip participants={participants} id={item.assignee_id} />
        <CommentCount count={readCommentCount(item)} />
      </span>
      <div className="work-board-card-actions">
        <button type="button" onClick={onOpenPeek}>
          卡片详情
        </button>
        <button type="button" onClick={onOpenTask}>
          打开任务
        </button>
      </div>
      {columns.length > 1 ? (
        <label className="work-board-card-move">
          <span>移动到</span>
          <select
            aria-label={`把 ${item.title} 移动到其他列`}
            defaultValue=""
            onChange={(event) => {
              const target = event.currentTarget.value;
              event.currentTarget.value = '';
              if (target) onMoveTo(target);
            }}
          >
            <option value="">选择列…</option>
            {columns
              .filter((target) => target.id !== columnId)
              .map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title}
                </option>
              ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

export default BoardsPage;
