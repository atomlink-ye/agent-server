import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  WorkItemDetailDto,
  WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import { loadCoworkers } from '../agents/agents-gateway';
import type { Coworker } from '../agents/contracts';
import { workOrganizationClient } from './client';
import './work-organization.css';

const STATUS_LABELS: Record<WorkItemStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

export interface TasksPageProps {
  readonly selectedWorkItemId?: string | null;
}

export function TasksPage({ selectedWorkItemId = null }: TasksPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [items, setItems] = useState<readonly WorkItemDetailDto[]>([]);
  const [agents, setAgents] = useState<readonly Coworker[]>([]);
  const [comments, setComments] = useState<Awaited<ReturnType<typeof workOrganizationClient.listComments>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<WorkItemStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextItems, nextAgents] = await Promise.all([
        workOrganizationClient.listWorkItems(),
        loadCoworkers().catch(() => [] as readonly Coworker[]),
      ]);
      setItems(nextItems);
      setAgents(nextAgents);
      if (selectedWorkItemId) {
        const detail = nextItems.find((entry) => entry.work_item.id === selectedWorkItemId);
        if (!detail) {
          const fetched = await workOrganizationClient.getWorkItem(selectedWorkItemId);
          setItems((current) => [fetched, ...current]);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [selectedWorkItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedWorkItemId) {
      setComments([]);
      return;
    }
    void workOrganizationClient.listComments(selectedWorkItemId).then(setComments, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [selectedWorkItemId]);

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
    ? items.find((entry) => entry.work_item.id === selectedWorkItemId) ?? null
    : null;

  const replaceItem = (detail: WorkItemDetailDto): void => {
    setItems((current) => {
      const found = current.some((entry) => entry.work_item.id === detail.work_item.id);
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
          <button type="button" className="work-org-primary" onClick={() => setCreating(true)}>
            + Task
          </button>
        </div>
        <div className="work-org-filters" aria-label="Task status filters">
          {(['all', 'todo', 'in_progress', 'in_review', 'done'] as const).map((value) => (
            <button
              type="button"
              key={value}
              data-active={filter === value ? 'true' : 'false'}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All' : STATUS_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="work-org-list">
          {loading && items.length === 0 ? <p className="pane-placeholder">Loading Tasks…</p> : null}
          {!loading && visibleItems.length === 0 ? (
            <p className="pane-placeholder">No Tasks in this view.</p>
          ) : null}
          {visibleItems.map((entry) => (
            <button
              type="button"
              key={entry.work_item.id}
              className="work-org-list-item"
              data-active={selectedWorkItemId === entry.work_item.id ? 'true' : 'false'}
              onClick={() => navigate(`/tasks/${encodeURIComponent(entry.work_item.id)}`)}
            >
              <span className={`work-org-status work-org-status--${entry.work_item.status}`}>
                {STATUS_LABELS[entry.work_item.status]}
              </span>
              <strong>{entry.work_item.title}</strong>
              <small>
                {entry.work_item.assignee_id ? `Assigned · ${entry.work_item.assignee_id}` : 'Unassigned'}
              </small>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel work-org-main">
        <TitleBar section="Tasks" />
        <section className="work-org-content" aria-label="Task detail">
          {error ? <p className="work-org-error" role="alert">{error}</p> : null}
          {creating ? (
            <CreateTaskForm
              agents={agents}
              source={location.state}
              onCancel={() => setCreating(false)}
              onCreated={(detail) => {
                replaceItem(detail);
                setCreating(false);
                navigate(`/tasks/${encodeURIComponent(detail.work_item.id)}`, { replace: true });
              }}
              onError={setError}
            />
          ) : selected ? (
            <TaskDetail
              detail={selected}
              agents={agents}
              comments={comments}
              onChanged={replaceItem}
              onCommentsChanged={setComments}
              onError={setError}
            />
          ) : (
            <div className="work-main-empty">
              <span className="work-main-icon" aria-hidden="true">☑</span>
              <h1>Choose a Task</h1>
              <p>Capture work before it is formal enough to become a Work.</p>
              <button type="button" onClick={() => setCreating(true)}>New Task</button>
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
  const sourceConversationId = typeof state?.sourceConversationId === 'string' ? state.sourceConversationId : null;
  const sourceMessageId = typeof state?.sourceMessageId === 'string' ? state.sourceMessageId : null;
  const [title, setTitle] = useState(typeof state?.title === 'string' ? state.title : '');
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
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="work-org-card work-org-form" onSubmit={(event) => void submit(event)}>
      <span className="eyebrow">New Task</span>
      <h1>Capture work</h1>
      {sourceConversationId ? <p className="work-org-source-note">Linked to the source conversation message.</p> : null}
      <label>
        Title
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} />
      </label>
      <AssigneeField agents={agents} value={assigneeId} onChange={setAssigneeId} />
      <div className="work-org-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="work-org-primary" disabled={saving || !title.trim()}>
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
  readonly comments: Awaited<ReturnType<typeof workOrganizationClient.listComments>>;
  readonly onChanged: (detail: WorkItemDetailDto) => void;
  readonly onCommentsChanged: (comments: Awaited<ReturnType<typeof workOrganizationClient.listComments>>) => void;
  readonly onError: (message: string | null) => void;
}) {
  const navigate = useNavigate();
  const item = detail.work_item;
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [assigneeId, setAssigneeId] = useState(item.assignee_id ?? '');
  const [comment, setComment] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [definitionVersionId, setDefinitionVersionId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description ?? '');
    setAssigneeId(item.assignee_id ?? '');
  }, [item.assignee_id, item.description, item.id, item.title]);

  async function update(input: Parameters<typeof workOrganizationClient.updateWorkItem>[1]) {
    setSaving(true);
    onError(null);
    try {
      onChanged(await workOrganizationClient.updateWorkItem(item.id, input));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
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
      const created = await workOrganizationClient.addComment(item.id, comment.trim());
      onCommentsChanged([...comments, created]);
      setComment('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function promote() {
    if (!definitionId.trim() || !definitionVersionId.trim()) return;
    setSaving(true);
    try {
      onChanged(
        await workOrganizationClient.promoteWorkItem(item.id, {
          definitionId: definitionId.trim(),
          definitionVersionId: definitionVersionId.trim(),
          title: title.trim() || item.title,
        }),
      );
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
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
            onChange={(event) => void update({ status: event.target.value as WorkItemStatus })}
          >
            {(Object.keys(STATUS_LABELS) as WorkItemStatus[]).map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </div>
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={6} />
        </label>
        <AssigneeField agents={agents} value={assigneeId} onChange={setAssigneeId} />
        <div className="work-org-actions">
          <button type="button" className="work-org-primary" disabled={saving || !title.trim()} onClick={() => void saveFields()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {item.source_conversation_id ? (
            <button type="button" onClick={() => navigate(`/conversations/${encodeURIComponent(item.source_conversation_id!)}`)}>
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
              <p className="work-org-muted">{detail.linked_work.product_state.replace('_', ' ')}</p>
              {detail.linked_work.result_summary ? <p>{detail.linked_work.result_summary}</p> : null}
              <button
                type="button"
                className="work-org-primary"
                onClick={() =>
                  navigate(`/work/${encodeURIComponent(detail.linked_work!.work_id)}?from_task=${encodeURIComponent(item.id)}`)
                }
              >
                Open Work
              </button>
            </>
          ) : (
            <>
              <h2>Start Work</h2>
              <p className="work-org-muted">Choose the published Work Definition identity required by the canonical Work contract.</p>
              <label>
                Definition ID
                <input value={definitionId} onChange={(event) => setDefinitionId(event.target.value)} placeholder="UUID" />
              </label>
              <label>
                Definition version ID
                <input value={definitionVersionId} onChange={(event) => setDefinitionVersionId(event.target.value)} placeholder="UUID" />
              </label>
              <button type="button" className="work-org-primary" disabled={saving || !definitionId.trim() || !definitionVersionId.trim()} onClick={() => void promote()}>
                Create Work
              </button>
            </>
          )}
        </article>

        <article className="work-org-card">
          <span className="eyebrow">Comments</span>
          <div className="work-org-comments">
            {comments.length === 0 ? <p className="work-org-muted">No comments yet.</p> : null}
            {comments.map((entry) => (
              <div key={entry.id} className="work-org-comment">
                <strong>{entry.author_id}</strong>
                <p>{entry.body}</p>
              </div>
            ))}
          </div>
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Add a comment. @participant mentions stay visible in the shared work record." />
          <button type="button" disabled={!comment.trim()} onClick={() => void addComment()}>Comment</button>
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
      <input
        list="work-item-assignees"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Agent or human participant ID"
      />
      <datalist id="work-item-assignees">
        {agents.map((agent) => (
          <option value={agent.id} key={agent.id}>{agent.displayName}</option>
        ))}
      </datalist>
    </label>
  );
}

export default TasksPage;
