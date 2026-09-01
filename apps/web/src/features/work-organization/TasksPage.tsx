import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  WorkItemDetailDto,
  WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';
import { WORK_ITEM_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import { loadCoworkers } from '../agents/agents-gateway';
import type { Coworker } from '../agents/contracts';
import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
import { workOrganizationClient } from './client';
import type { PublishedWorkDefinition } from './client';
import {
  COWORKER_ROLE_FALLBACK,
  descriptionPreview,
  formatWorkTime,
  productStateLabel,
  runtimeStatusLabel,
  STATUS_LABELS,
} from './format';
import MentionedText from './MentionedText';
import MentionTextField from './MentionTextField';
import ParticipantChip from './ParticipantChip';
import {
  buildParticipantDirectory,
  participantLabel,
  type Participant,
} from './participants';
import {
  CommentCount,
  MentionRow,
  ParticipantAvatar,
  StatusBadge,
} from './WorkItemMeta';
import { readCommentCount, readMentionIds } from './work-item-extensions';
import './work-organization.css';

const TASKS_LOAD_ERROR = '任务加载失败，请检查网络连接后重试。';
const TASKS_UNAVAILABLE = '当前工作区暂未开启任务管理。';
const TASKS_ACTION_ERROR = '这次任务改动没能保存，请重试。';
const DEFINITIONS_UNAVAILABLE = '当前工作区暂未开启 Work 执行。';

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
            if (isResourceNotFound(reason, WORK_ITEM_NOT_FOUND_CODE)) {
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
        message: '这个任务的评论加载失败，请重试。',
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

  // The mention/assignee directory is the Coworker roster plus every principal
  // this view has actually seen — there is no human-roster endpoint to ask.
  const participants = useMemo(
    () =>
      buildParticipantDirectory({
        agents,
        principalIds: [
          ...items.flatMap((entry) => [
            entry.work_item.created_by,
            entry.work_item.assignee_id,
          ]),
          ...comments.map((entry) => entry.author_id),
        ],
      }),
    [agents, comments, items],
  );

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
      <aside className="sidebar work-org-pane" aria-label="任务导航">
        <div className="pane-heading work-org-heading">
          <div>
            <span className="eyebrow">AI 同事工作区</span>
            <h1>任务</h1>
          </div>
          <button
            type="button"
            className="work-org-primary"
            disabled={listStatus === 'unavailable' || listStatus === 'error'}
            onClick={() => setCreating(true)}
          >
            + 新建任务
          </button>
        </div>
        <div className="work-org-filters" aria-label="任务状态筛选">
          {(['all', 'todo', 'in_progress', 'in_review', 'done'] as const).map(
            (value) => (
              <button
                type="button"
                key={value}
                data-active={filter === value ? 'true' : 'false'}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? '全部' : STATUS_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <div className="work-org-list">
          {listStatus === 'loading' && items.length === 0 ? (
            <p className="pane-placeholder">正在加载任务…</p>
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
                重试
              </button>
            </div>
          ) : null}
          {listStatus === 'ready' && visibleItems.length === 0 ? (
            <div className="pane-placeholder">
              <p>当前视图里没有任务。</p>
              {filter !== 'all' ? (
                <button type="button" onClick={() => setFilter('all')}>
                  查看全部任务
                </button>
              ) : null}
            </div>
          ) : null}
          {listStatus === 'ready'
            ? visibleItems.map((entry) => (
                <TaskListItem
                  key={entry.work_item.id}
                  detail={entry}
                  participants={participants}
                  active={selectedWorkItemId === entry.work_item.id}
                  onOpen={() =>
                    navigate(`/tasks/${encodeURIComponent(entry.work_item.id)}`)
                  }
                />
              ))
            : null}
        </div>
      </aside>

      <main className="chat-panel work-org-main">
        <TitleBar section="任务" />
        <section className="work-org-content" aria-label="任务详情">
          <div className="work-org-mobile-picker">
            <label>
              <span>任务</span>
              <select
                aria-label="选择任务"
                value={selectedWorkItemId ?? ''}
                onChange={(event) =>
                  navigate(
                    event.target.value
                      ? `/tasks/${encodeURIComponent(event.target.value)}`
                      : '/tasks',
                  )
                }
              >
                <option value="">选择任务</option>
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
              + 新建任务
            </button>
          </div>
          {error && selectionStatus !== 'not_found' ? (
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
            <div className="work-main-empty" data-testid="tasks-unavailable">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>任务功能未开启</h1>
              <p>{TASKS_UNAVAILABLE}</p>
            </div>
          ) : listStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>任务加载失败</h1>
              <p>{TASKS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void load()}>
                重试
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
              <h1>正在加载所选任务…</h1>
            </div>
          ) : selectionStatus === 'not_found' ? (
            <div className="work-main-empty" data-testid="tasks-not-found">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>所选任务已不可用。</h1>
              <p>这个任务可能已被删除，或已移出当前工作区。</p>
              <button type="button" onClick={() => navigate('/tasks')}>
                返回任务列表
              </button>
            </div>
          ) : selectionStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-selected-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>任务加载失败</h1>
              <p>{TASKS_LOAD_ERROR}</p>
              <button type="button" onClick={() => void load()}>
                重试
              </button>
            </div>
          ) : creating ? (
            <CreateTaskForm
              agents={agents}
              participants={participants}
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
              participants={participants}
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
              <h1>选择一个任务</h1>
              <p>在工作正式变成 Work 之前，先把它记录下来。</p>
              <button type="button" onClick={() => setCreating(true)}>
                新建任务
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * One row of the Task list.
 *
 * Cumora's list row carries the same signals its Board card does — status,
 * title, a description preview, who holds it, mentions, comment count — so a
 * reader can triage without opening anything. The row stays a single button so
 * the whole surface remains one click, and every extra signal degrades to
 * absent rather than to a guess.
 */
function TaskListItem({
  detail,
  participants,
  active,
  onOpen,
}: {
  readonly detail: WorkItemDetailDto;
  readonly participants: readonly Participant[];
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const item = detail.work_item;
  const preview = descriptionPreview(item.description, 120);
  return (
    <button
      type="button"
      className="work-org-list-item work-org-list-item--rich"
      data-active={active ? 'true' : 'false'}
      data-testid="task-list-item"
      onClick={onOpen}
    >
      <span className="work-org-list-item-top">
        <StatusBadge status={item.status} />
        <small className="work-org-muted">
          {formatWorkTime(item.updated_at)}
        </small>
      </span>
      <strong>{item.title}</strong>
      {preview ? (
        <small className="work-org-list-item-preview">
          <MentionedText text={preview} participants={participants} />
        </small>
      ) : null}
      <MentionRow ids={readMentionIds(item)} participants={participants} />
      <span className="work-org-list-item-footer">
        <ParticipantChip participants={participants} id={item.assignee_id} />
        <CommentCount count={readCommentCount(item)} />
        {detail.linked_work ? (
          <span className="work-org-chip">
            Work · {productStateLabel(detail.linked_work.product_state)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function CreateTaskForm({
  agents,
  participants,
  source,
  onCancel,
  onCreated,
  onError,
}: {
  readonly agents: readonly Coworker[];
  readonly participants: readonly Participant[];
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
      <span className="eyebrow">新建任务</span>
      <h1>记录工作</h1>
      {sourceConversationId ? (
        <p className="work-org-source-note">已关联来源会话中的那条消息。</p>
      ) : null}
      <MentionTextField
        label="标题"
        value={title}
        onChange={setTitle}
        participants={participants}
        maxLength={200}
        autoFocus
      />
      <MentionTextField
        label="描述"
        value={description}
        onChange={setDescription}
        participants={participants}
        multiline
        rows={5}
        hint={
          <small className="work-org-muted">
            输入 @ 可以提及 AI 同事或团队成员。
          </small>
        }
      />
      <AssigneeField
        agents={agents}
        value={assigneeId}
        onChange={setAssigneeId}
      />
      <div className="work-org-actions">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button
          type="submit"
          className="work-org-primary"
          disabled={saving || !title.trim()}
        >
          {saving ? '正在创建…' : '创建任务'}
        </button>
      </div>
    </form>
  );
}

function TaskDetail({
  detail,
  agents,
  participants,
  comments,
  onChanged,
  onCommentsChanged,
  onError,
}: {
  readonly detail: WorkItemDetailDto;
  readonly agents: readonly Coworker[];
  readonly participants: readonly Participant[];
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
            <span className="eyebrow">任务</span>
            <h1>{item.title}</h1>
            <div className="work-org-detail-meta">
              <ParticipantChip
                participants={participants}
                id={item.assignee_id}
              />
              <span className="work-org-muted">
                由 {participantLabel(participants, item.created_by)} 创建 ·{' '}
                {formatWorkTime(item.created_at)}
              </span>
              <MentionRow
                ids={readMentionIds(item)}
                participants={participants}
                limit={5}
              />
            </div>
          </div>
          <select
            aria-label="任务状态"
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
        <MentionTextField
          label="标题"
          value={title}
          onChange={setTitle}
          participants={participants}
          maxLength={200}
        />
        <MentionTextField
          label="描述"
          value={description}
          onChange={setDescription}
          participants={participants}
          multiline
          rows={6}
          hint={
            <small className="work-org-muted">
              输入 @ 可以提及 AI 同事或团队成员。
            </small>
          }
        />
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
            {saving ? '正在保存…' : '保存'}
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
              返回会话
            </button>
          ) : null}
        </div>
      </article>

      <aside className="work-org-stack">
        <article className="work-org-card">
          <span className="eyebrow">正式执行</span>
          {detail.linked_work ? (
            <>
              <h2>{detail.linked_work.title}</h2>
              <p className="work-org-muted">
                {productStateLabel(detail.linked_work.product_state)}
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
                打开 Work
              </button>
            </>
          ) : (
            <>
              <h2>启动 Work</h2>
              <p className="work-org-muted">
                选择一个已发布的 Definition 来创建规范的 Work。需要新建或修改
                Definition，请到「新建 Work」。
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
                创建 Work
              </button>
            </>
          )}
        </article>

        {item.status === 'in_review' ? (
          <article className="work-org-card work-org-review-card">
            <span className="eyebrow">人工评审</span>
            <h2>等你来决定</h2>
            <p className="work-org-muted">
              先看看关联的 Work 和会话，协作完成后把这个任务标记为已完成。
            </p>
            <div className="work-org-actions">
              <button
                type="button"
                className="work-org-primary"
                disabled={saving}
                onClick={() => void update({ status: 'done' })}
              >
                标记任务完成
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
                  评审 Work
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
                  打开会话
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        <article className="work-org-card">
          <span className="eyebrow">评论</span>
          <div className="work-org-comments">
            {comments.length === 0 ? (
              <p className="work-org-muted">还没有评论。</p>
            ) : null}
            {comments.map((entry) => (
              <div key={entry.id} className="work-org-comment">
                <div className="work-org-comment-head">
                  <ParticipantAvatar
                    participants={participants}
                    id={entry.author_id}
                  />
                  <strong>
                    {participantLabel(participants, entry.author_id)}
                  </strong>
                  <small className="work-org-muted">
                    {formatWorkTime(entry.created_at)}
                  </small>
                </div>
                <p>
                  <MentionedText
                    text={entry.body}
                    participants={participants}
                  />
                </p>
                <MentionRow
                  ids={readMentionIds(entry)}
                  participants={participants}
                />
              </div>
            ))}
          </div>
          <MentionTextField
            ariaLabel="添加评论"
            value={comment}
            onChange={setComment}
            participants={participants}
            multiline
            rows={3}
            placeholder="写下评论。用 @ 提及的成员会留在共享的工作记录里。"
          />
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => void addComment()}
          >
            评论
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
      负责人
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">未分配</option>
        {agents.map((agent) => (
          <option value={agent.id} key={agent.id}>
            {coworkerOptionLabel(agent)}
          </option>
        ))}
        {value && !agents.some((agent) => agent.id === value) ? (
          <option value={value}>已不可用的成员</option>
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
    return <p className="work-org-muted">正在加载已发布的 Definition…</p>;
  if (state === 'unavailable')
    // feature_unavailable means this workspace does not compose the
    // Product Work surface at all, so reloading can never succeed. No
    // Retry here — see docs/frontend.md "Surface availability".
    return <p className="work-org-muted">{DEFINITIONS_UNAVAILABLE}</p>;
  if (state === 'error')
    return (
      <div className="work-org-error" role="alert">
        <p>已发布的 Definition 加载失败。</p>
        <button type="button" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  if (definitions.length === 0)
    return (
      <p className="work-org-muted">
        还没有已发布的 Definition，请先到「新建 Work」里创建一个。
      </p>
    );
  return (
    <label>
      已发布的 Definition
      <select
        aria-label="Published Work Definition"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">选择一个已发布的 Definition</option>
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
    agent.roleLabel ?? COWORKER_ROLE_FALLBACK,
    runtimeStatusLabel(agent.runtimeStatus),
  ].join(' · ');
}

export default TasksPage;
