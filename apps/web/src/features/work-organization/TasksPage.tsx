import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  WorkItemDetailDto,
  WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import { loadCoworkers } from '../agents/agents-gateway';
import type { Coworker } from '../agents/contracts';
import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
import { workOrganizationClient } from './client';
import type { PublishedWorkDefinition } from './client';
import './work-organization.css';

const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

const TASKS_LOAD_ERROR =
  'Tasks could not be loaded. Check your connection and try again.';
const TASKS_UNAVAILABLE =
  "This workspace doesn't currently offer Task tracking.";
const TASKS_ACTION_ERROR =
  'That Task change could not be saved. Please try again.';
const DEFINITIONS_UNAVAILABLE =
  "This workspace doesn't currently offer Work execution.";

type RecoverableError = {
  readonly source: 'comments' | 'action';
  readonly message: string;
  readonly retry?: () => void;
};

// The left pane's "No Tasks in this view." claim is a factual statement
// about the user's data. It must only be reachable from a successful load,
// never from "we could not ask" (error) or "this capability is off"
// (unavailable) — those get their own honest, mutually exclusive states.
type ListStatus = 'loading' | 'ready' | 'unavailable' | 'error';
type SelectionStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';

export interface TasksPageProps {
  readonly selectedWorkItemId?: string | null;
}

export function TasksPage({ selectedWorkItemId = null }: TasksPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<readonly WorkItemDetailDto[]>([]);
  const [agents, setAgents] = useState<readonly Coworker[]>([]);
  const [comments, setComments] = useState<
    Awaited<ReturnType<typeof workOrganizationClient.listComments>>
  >([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [selectionStatus, setSelectionStatus] =
    useState<SelectionStatus>('idle');
  const selectionRequest = useRef(0);
  const commentsRequest = useRef(0);
  const [error, setError] = useState<RecoverableError | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<WorkItemStatus | 'all'>('all');

  const load = useCallback(async () => {
    const request = ++selectionRequest.current;
    setListStatus('loading');
    setSelectionStatus(selectedWorkItemId ? 'loading' : 'idle');
    setError(null);
    try {
      const [nextItems, nextAgents] = await Promise.all([
        workOrganizationClient.listWorkItems(),
        loadCoworkers().catch(() => [] as readonly Coworker[]),
      ]);
      if (request !== selectionRequest.current) return;
      setItems(nextItems);
      setAgents(nextAgents);
      setListStatus('ready');
      if (selectedWorkItemId) {
        const detail = nextItems.find(
          (entry) => entry.work_item.id === selectedWorkItemId,
        );
        if (detail) {
          if (request !== selectionRequest.current) return;
          setSelectionStatus('ready');
        } else {
          try {
            const fetched =
              await workOrganizationClient.getWorkItem(selectedWorkItemId);
            if (request !== selectionRequest.current) return;
            setItems((current) => [fetched, ...current]);
            setSelectionStatus('ready');
          } catch (reason) {
            if (request !== selectionRequest.current) return;
            if (isResourceNotFound(reason, 'task_not_found')) {
              setSelectionStatus('not_found');
            } else {
              setSelectionStatus('error');
            }
          }
        }
      }
    } catch (reason) {
      if (request !== selectionRequest.current) return;
      setListStatus(isFeatureUnavailable(reason) ? 'unavailable' : 'error');
    }
  }, [selectedWorkItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadComments = useCallback(async () => {
    const request = ++commentsRequest.current;
    if (!selectedWorkItemId) {
      setComments([]);
      return;
    }
    try {
      const next =
        await workOrganizationClient.listComments(selectedWorkItemId);
      if (request !== commentsRequest.current) return;
      setComments(next);
      setError((current) => (current?.source === 'comments' ? null : current));
    } catch {
      if (request !== commentsRequest.current) return;
      setError({
        source: 'comments',
        message:
          'Comments for this Task could not be loaded. Please try again.',
        retry: () => void loadComments(),
      });
    }
  }, [selectedWorkItemId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    const state = location.state as {
      createTask?: unknown;
      sourceConversationId?: unknown;
      sourceMessageId?: unknown;
      title?: unknown;
      description?: unknown;
    } | null;
    if (state?.createTask === true) setCreating(true);
  }, [location.state]);

  const visibleItems = useMemo(
    () =>
      filter === 'all'
        ? items
        : items.filter((entry) => entry.work_item.status === filter),
    [filter, items],
  );
  const selected = selectedWorkItemId
    ? (items.find((entry) => entry.work_item.id === selectedWorkItemId) ?? null)
    : null;

  const replaceItem = (detail: WorkItemDetailDto): void => {
    setItems((current) => {
      const found = current.some(
        (entry) => entry.work_item.id === detail.work_item.id,
      );
      return found
        ? current.map((entry) =>
            entry.work_item.id === detail.work_item.id ? detail : entry,
          )
        : [detail, ...current];
    });
  };

  return (
    <>
      <aside className="sidebar work-org-pane" aria-label="Tasks navigation">
        <div className="pane-heading work-org-heading">
          <div>
            <span className="eyebrow">Coworker Workspace</span>
            <h1>Tasks</h1>
          </div>
          <button
            type="button"
            className="work-org-primary"
            disabled={listStatus === 'unavailable' || listStatus === 'error'}
            onClick={() => setCreating(true)}
          >
            + Task
          </button>
        </div>
        <div className="work-org-filters" aria-label="Task status filters">
          {(['all', 'todo', 'in_progress', 'in_review', 'done'] as const).map(
            (value) => (
              <button
                type="button"
                key={value}
                data-active={filter === value ? 'true' : 'false'}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : STATUS_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <div className="work-org-list">
          {listStatus === 'loading' && items.length === 0 ? (
            <p className="pane-placeholder">Loading Tasks…</p>
          ) : null}
          {listStatus === 'unavailable' ? (
            <div className="pane-placeholder" role="status">
              <p>{TASKS_UNAVAILABLE}</p>
            </div>
          ) : null}
          {listStatus === 'error' ? (
            <div className="pane-placeholder" role="alert">
              <p>{TASKS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : null}
          {listStatus === 'ready' && visibleItems.length === 0 ? (
            <div className="pane-placeholder">
              <p>No Tasks in this view.</p>
              {filter !== 'all' ? (
                <button type="button" onClick={() => setFilter('all')}>
                  View all Tasks
                </button>
              ) : null}
            </div>
          ) : null}
          {listStatus === 'ready'
            ? visibleItems.map((entry) => (
                <button
                  type="button"
                  key={entry.work_item.id}
                  className="work-org-list-item"
                  data-active={
                    selectedWorkItemId === entry.work_item.id ? 'true' : 'false'
                  }
                  onClick={() =>
                    navigate(`/tasks/${encodeURIComponent(entry.work_item.id)}`)
                  }
                >
                  <span
                    className={`work-org-status work-org-status--${entry.work_item.status}`}
                  >
                    {STATUS_LABELS[entry.work_item.status]}
                  </span>
                  <strong>{entry.work_item.title}</strong>
                  <small>
                    {entry.work_item.assignee_id
                      ? `Assigned · ${entry.work_item.assignee_id}`
                      : 'Unassigned'}
                  </small>
                </button>
              ))
            : null}
        </div>
      </aside>

      <main className="chat-panel work-org-main">
        <TitleBar section="Tasks" />
        <section className="work-org-content" aria-label="Task detail">
          <div className="work-org-mobile-picker">
            <label>
              <span>Task</span>
              <select
                aria-label="Choose a Task"
                value={selectedWorkItemId ?? ''}
                onChange={(event) =>
                  navigate(
                    event.target.value
                      ? `/tasks/${encodeURIComponent(event.target.value)}`
                      : '/tasks',
                  )
                }
              >
                <option value="">Choose a Task</option>
                {visibleItems.map((entry) => (
                  <option key={entry.work_item.id} value={entry.work_item.id}>
                    {entry.work_item.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="work-org-primary"
              disabled={listStatus === 'unavailable' || listStatus === 'error'}
              onClick={() => setCreating(true)}
            >
              + Task
            </button>
          </div>
          {error && selectionStatus !== 'not_found' ? (
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
            <div className="work-main-empty" data-testid="tasks-unavailable">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>Tasks aren&apos;t available</h1>
              <p>{TASKS_UNAVAILABLE}</p>
            </div>
          ) : listStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>Tasks could not be loaded</h1>
              <p>{TASKS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : selectionStatus === 'loading' ? (
            <div
              className="work-main-empty"
              data-testid="tasks-selected-loading"
            >
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>Loading selected Task…</h1>
            </div>
          ) : selectionStatus === 'not_found' ? (
            <div className="work-main-empty" data-testid="tasks-not-found">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>The selected Task is unavailable.</h1>
              <p>
                This Task may have been deleted or moved out of this workspace.
              </p>
              <button type="button" onClick={() => navigate('/tasks')}>
                Back to Tasks
              </button>
            </div>
          ) : selectionStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-selected-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>Task could not be loaded</h1>
              <p>{TASKS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : creating ? (
            <CreateTaskForm
              agents={agents}
              source={location.state}
              onCancel={() => setCreating(false)}
              onCreated={(detail) => {
                replaceItem(detail);
                setCreating(false);
                navigate(`/tasks/${encodeURIComponent(detail.work_item.id)}`, {
                  replace: true,
                });
              }}
              onError={(message) =>
                setError((current) =>
                  message
                    ? { source: 'action', message }
                    : current?.source === 'action'
                      ? null
                      : current,
                )
              }
            />
          ) : selected ? (
            <TaskDetail
              detail={selected}
              agents={agents}
              comments={comments}
              onChanged={replaceItem}
              onCommentsChanged={setComments}
              onError={(message) =>
                setError((current) =>
                  message
                    ? { source: 'action', message }
                    : current?.source === 'action'
                      ? null
                      : current,
                )
              }
            />
          ) : (
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>Choose a Task</h1>
              <p>Capture work before it is formal enough to become a Work.</p>
              <button type="button" onClick={() => setCreating(true)}>
                New Task
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function CreateTaskForm({
  agents,
  source,
  onCancel,
  onCreated,
  onError,
}: {
  readonly agents: readonly Coworker[];
  readonly source: unknown;
  readonly onCancel: () => void;
  readonly onCreated: (detail: WorkItemDetailDto) => void;
  readonly onError: (message: string | null) => void;
}) {
  const state = source as {
    sourceConversationId?: unknown;
    sourceMessageId?: unknown;
    title?: unknown;
    description?: unknown;
  } | null;
  const sourceConversationId =
    typeof state?.sourceConversationId === 'string'
      ? state.sourceConversationId
      : null;
  const sourceMessageId =
    typeof state?.sourceMessageId === 'string' ? state.sourceMessageId : null;
  const [title, setTitle] = useState(
    typeof state?.title === 'string' ? state.title : '',
  );
  const [description, setDescription] = useState(
    typeof state?.description === 'string' ? state.description : '',
  );
  const [assigneeId, setAssigneeId] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    onError(null);
    try {
      const detail = await workOrganizationClient.createWorkItem({
        title: title.trim(),
        description: description.trim() || null,
        assigneeId: assigneeId.trim() || null,
        ...(sourceConversationId && sourceMessageId
          ? { sourceConversationId, sourceMessageId }
          : {}),
      });
      onCreated(detail);
    } catch {
      onError(TASKS_ACTION_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="work-org-card work-org-form"
      onSubmit={(event) => void submit(event)}
    >
      <span className="eyebrow">New Task</span>
      <h1>Capture work</h1>
      {sourceConversationId ? (
        <p className="work-org-source-note">
          Linked to the source conversation message.
        </p>
      ) : null}
      <label>
        Title
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          required
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
        />
      </label>
      <AssigneeField
        agents={agents}
        value={assigneeId}
        onChange={setAssigneeId}
      />
      <div className="work-org-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="work-org-primary"
          disabled={saving || !title.trim()}
        >
          {saving ? 'Creating…' : 'Create Task'}
        </button>
      </div>
    </form>
  );
}

function TaskDetail({
  detail,
  agents,
  comments,
  onChanged,
  onCommentsChanged,
  onError,
}: {
  readonly detail: WorkItemDetailDto;
  readonly agents: readonly Coworker[];
  readonly comments: Awaited<
    ReturnType<typeof workOrganizationClient.listComments>
  >;
  readonly onChanged: (detail: WorkItemDetailDto) => void;
  readonly onCommentsChanged: (
    comments: Awaited<ReturnType<typeof workOrganizationClient.listComments>>,
  ) => void;
  readonly onError: (message: string | null) => void;
}) {
  const navigate = useNavigate();
  const item = detail.work_item;
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [assigneeId, setAssigneeId] = useState(item.assignee_id ?? '');
  const [comment, setComment] = useState('');
  const [definitions, setDefinitions] = useState<
    readonly PublishedWorkDefinition[]
  >([]);
  const [definitionsState, setDefinitionsState] = useState<
    'loading' | 'ready' | 'unavailable' | 'error'
  >('loading');
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description ?? '');
    setAssigneeId(item.assignee_id ?? '');
  }, [item.assignee_id, item.description, item.id, item.title]);

  const loadDefinitions = useCallback(async () => {
    setDefinitionsState('loading');
    try {
      setDefinitions(
        await workOrganizationClient.listPublishedWorkDefinitions(),
      );
      setDefinitionsState('ready');
    } catch (reason) {
      setDefinitionsState(
        isFeatureUnavailable(reason) ? 'unavailable' : 'error',
      );
    }
  }, []);

  useEffect(() => {
    if (!detail.linked_work) void loadDefinitions();
  }, [detail.linked_work, loadDefinitions]);

  async function update(
    input: Parameters<typeof workOrganizationClient.updateWorkItem>[1],
  ) {
    setSaving(true);
    onError(null);
    try {
      onChanged(await workOrganizationClient.updateWorkItem(item.id, input));
    } catch {
      onError(TASKS_ACTION_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function saveFields() {
    await update({
      title: title.trim(),
      description: description.trim() || null,
      assigneeId: assigneeId.trim() || null,
    });
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      const created = await workOrganizationClient.addComment(
        item.id,
        comment.trim(),
      );
      onCommentsChanged([...comments, created]);
      setComment('');
    } catch {
      onError(TASKS_ACTION_ERROR);
    }
  }

  async function promote() {
    const definition = definitions.find(
      (entry) => entry.definitionId === selectedDefinitionId,
    );
    if (!definition) return;
    setSaving(true);
    try {
      onChanged(
        await workOrganizationClient.promoteWorkItem(item.id, {
          definitionId: definition.definitionId,
          definitionVersionId: definition.currentPublishedVersionId,
          title: title.trim() || item.title,
        }),
      );
    } catch {
      onError(TASKS_ACTION_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="work-org-detail-grid">
      <article className="work-org-card work-org-form">
        <div className="work-org-detail-header">
          <div>
            <span className="eyebrow">Task</span>
            <h1>{item.title}</h1>
          </div>
          <select
            aria-label="Task status"
            value={item.status}
            disabled={saving}
            onChange={(event) =>
              void update({ status: event.target.value as WorkItemStatus })
            }
          >
            {(Object.keys(STATUS_LABELS) as WorkItemStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
          />
        </label>
        <AssigneeField
          agents={agents}
          value={assigneeId}
          onChange={setAssigneeId}
        />
        <div className="work-org-actions">
          <button
            type="button"
            className="work-org-primary"
            disabled={saving || !title.trim()}
            onClick={() => void saveFields()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {item.source_conversation_id ? (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/conversations/${encodeURIComponent(item.source_conversation_id!)}`,
                )
              }
            >
              Back to conversation
            </button>
          ) : null}
        </div>
      </article>

      <aside className="work-org-stack">
        <article className="work-org-card">
          <span className="eyebrow">Formal execution</span>
          {detail.linked_work ? (
            <>
              <h2>{detail.linked_work.title}</h2>
              <p className="work-org-muted">
                {detail.linked_work.product_state.replace('_', ' ')}
              </p>
              {detail.linked_work.result_summary ? (
                <p>{detail.linked_work.result_summary}</p>
              ) : null}
              <button
                type="button"
                className="work-org-primary"
                onClick={() =>
                  navigate(
                    `/work/${encodeURIComponent(detail.linked_work!.work_id)}?from_task=${encodeURIComponent(item.id)}`,
                  )
                }
              >
                Open Work
              </button>
            </>
          ) : (
            <>
              <h2>Start Work</h2>
              <p className="work-org-muted">
                Select an existing published Definition to create canonical
                Work. Create or edit a Definition from New Work.
              </p>
              <PublishedDefinitionField
                definitions={definitions}
                state={definitionsState}
                value={selectedDefinitionId}
                onChange={setSelectedDefinitionId}
                onRetry={() => void loadDefinitions()}
              />
              <button
                type="button"
                className="work-org-primary"
                disabled={
                  saving ||
                  definitionsState !== 'ready' ||
                  !selectedDefinitionId
                }
                onClick={() => void promote()}
              >
                Create Work
              </button>
            </>
          )}
        </article>

        {item.status === 'in_review' ? (
          <article className="work-org-card work-org-review-card">
            <span className="eyebrow">Human review</span>
            <h2>Ready for your decision</h2>
            <p className="work-org-muted">
              Review the linked Work and conversation, then mark this Task done
              when the coordination is complete.
            </p>
            <div className="work-org-actions">
              <button
                type="button"
                className="work-org-primary"
                disabled={saving}
                onClick={() => void update({ status: 'done' })}
              >
                Mark Task done
              </button>
              {detail.linked_work ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/work/${encodeURIComponent(detail.linked_work!.work_id)}?from_task=${encodeURIComponent(item.id)}`,
                    )
                  }
                >
                  Review Work
                </button>
              ) : null}
              {item.source_conversation_id ? (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/conversations/${encodeURIComponent(item.source_conversation_id!)}`,
                    )
                  }
                >
                  Open conversation
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        <article className="work-org-card">
          <span className="eyebrow">Comments</span>
          <div className="work-org-comments">
            {comments.length === 0 ? (
              <p className="work-org-muted">No comments yet.</p>
            ) : null}
            {comments.map((entry) => (
              <div key={entry.id} className="work-org-comment">
                <strong>{entry.author_id}</strong>
                <p>{entry.body}</p>
              </div>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Add a comment. @participant mentions stay visible in the shared work record."
          />
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => void addComment()}
          >
            Comment
          </button>
        </article>
      </aside>
    </div>
  );
}

function AssigneeField({
  agents,
  value,
  onChange,
}: {
  readonly agents: readonly Coworker[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      Assignee
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Unassigned</option>
        {agents.map((agent) => (
          <option value={agent.id} key={agent.id}>
            {coworkerOptionLabel(agent)}
          </option>
        ))}
        {value && !agents.some((agent) => agent.id === value) ? (
          <option value={value}>Unavailable participant</option>
        ) : null}
      </select>
    </label>
  );
}

function PublishedDefinitionField({
  definitions,
  state,
  value,
  onChange,
  onRetry,
}: {
  readonly definitions: readonly PublishedWorkDefinition[];
  readonly state: 'loading' | 'ready' | 'unavailable' | 'error';
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onRetry: () => void;
}) {
  if (state === 'loading')
    return <p className="work-org-muted">Loading published Definitions…</p>;
  if (state === 'unavailable')
    // feature_unavailable means this workspace does not compose the
    // Product Work surface at all, so reloading can never succeed. No
    // Retry here — see docs/frontend.md "Surface availability".
    return <p className="work-org-muted">{DEFINITIONS_UNAVAILABLE}</p>;
  if (state === 'error')
    return (
      <div className="work-org-error" role="alert">
        <p>Published Definitions could not be loaded.</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  if (definitions.length === 0)
    return (
      <p className="work-org-muted">
        No published Definitions are available. Create one from New Work first.
      </p>
    );
  return (
    <label>
      Published Definition
      <select
        aria-label="Published Work Definition"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a published Definition</option>
        {definitions.map((definition) => (
          <option key={definition.definitionId} value={definition.definitionId}>
            {definition.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function coworkerOptionLabel(agent: Coworker): string {
  return [
    agent.displayName,
    agent.roleLabel ?? 'Coworker',
    agent.runtimeStatus,
  ].join(' · ');
}

export default TasksPage;
