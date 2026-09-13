import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type {
  WorkItemDetailDto,
  WorkItemStatus,
} from '@atomlink-ye/agent-server/product-contract';
import { WORK_ITEM_NOT_FOUND_CODE } from '@atomlink-ye/agent-server/product-contract';

import TitleBar from '../../app/shell/TitleBar';
import { NotFoundContent } from '../../app/router/NotFoundPage';
import { isValidDetailId } from '../../app/router/detail-id';
import { loadCoworkers } from '../agents/agents-gateway';
import type { Coworker } from '../agents/contracts';
import {
  isFeatureUnavailable,
  isResourceNotFound,
} from '../../api/feature-availability';
import { workOrganizationClient } from './client';
import type { PublishedWorkDefinition } from './client';
import {
  coworkerRoleFallback,
  descriptionPreview,
  formatWorkTime,
  productStateLabel,
  runtimeStatusLabel,
  statusLabel,
  WORK_ITEM_STATUSES,
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
import { useT } from '../../i18n';

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
  const t = useT();
  const navigate = useNavigate();
  const invalidWorkItemId =
    selectedWorkItemId !== null && !isValidDetailId('task', selectedWorkItemId);
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
    setSelectionStatus(
      selectedWorkItemId && !invalidWorkItemId ? 'loading' : 'idle',
    );
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
      if (selectedWorkItemId && !invalidWorkItemId) {
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
  }, [invalidWorkItemId, selectedWorkItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadComments = useCallback(async () => {
    const request = ++commentsRequest.current;
    if (!selectedWorkItemId || invalidWorkItemId) {
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
        message: t('tasks.commentsLoadError'),
        retry: () => void loadComments(),
      });
    }
  }, [invalidWorkItemId, selectedWorkItemId, t]);

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
      <aside
        className="sidebar work-org-pane"
        aria-label={t('tasks.navigation')}
        data-typography-surface
      >
        <div className="pane-heading work-org-heading">
          <div>
            <span className="eyebrow">{t('tasks.eyebrow')}</span>
            <h1>{t('tasks.title')}</h1>
          </div>
          <button
            type="button"
            className="work-org-primary"
            disabled={listStatus === 'unavailable' || listStatus === 'error'}
            onClick={() => setCreating(true)}
          >
            {t('tasks.new')}
          </button>
        </div>
        <div className="work-org-filters" aria-label={t('tasks.filter.label')}>
          {(['all', 'todo', 'in_progress', 'in_review', 'done'] as const).map(
            (value) => (
              <button
                type="button"
                key={value}
                data-active={filter === value ? 'true' : 'false'}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? t('tasks.filter.all') : statusLabel(value)}
              </button>
            ),
          )}
        </div>
        <div className="work-org-list scroll-region">
          {listStatus === 'loading' && items.length === 0 ? (
            <p className="pane-placeholder">{t('tasks.loading')}</p>
          ) : null}
          {listStatus === 'unavailable' ? (
            <div className="pane-placeholder" role="status">
              <p>{t('tasks.unavailable')}</p>
            </div>
          ) : null}
          {listStatus === 'error' ? (
            <div className="pane-placeholder" role="alert">
              <p>{t('tasks.loadError')}</p>
              <button type="button" onClick={() => void load()}>
                {t('common.tryAgain')}
              </button>
            </div>
          ) : null}
          {listStatus === 'ready' && visibleItems.length === 0 ? (
            <div className="pane-placeholder">
              <p>{t('tasks.empty')}</p>
              {filter !== 'all' ? (
                <button type="button" onClick={() => setFilter('all')}>
                  {t('tasks.viewAll')}
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

      <main className="chat-panel work-org-main" data-typography-surface>
        <TitleBar section={t('tasks.title')} />
        <section
          className="work-org-content scroll-region"
          aria-label={t('tasks.details')}
        >
          <div className="work-org-mobile-picker">
            <label>
              <span>{t('tasks.taskEyebrow')}</span>
              <select
                aria-label={t('tasks.select')}
                value={selectedWorkItemId ?? ''}
                onChange={(event) =>
                  navigate(
                    event.target.value
                      ? `/tasks/${encodeURIComponent(event.target.value)}`
                      : '/tasks',
                  )
                }
              >
                <option value="">{t('tasks.select')}</option>
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
              {t('tasks.new')}
            </button>
          </div>
          {error && !invalidWorkItemId && selectionStatus !== 'not_found' ? (
            <div className="work-org-error" role="alert">
              <p>{error.message}</p>
              {error.retry ? (
                <button type="button" onClick={error.retry}>
                  {t('common.tryAgain')}
                </button>
              ) : null}
            </div>
          ) : null}
          {invalidWorkItemId ? (
            <NotFoundContent
              title={t('tasks.invalidLink')}
              to="/tasks"
              linkLabel={t('tasks.back')}
              eyebrow={t('tasks.linkEyebrow')}
              mark="!"
              variant="detail"
            >
              {t('tasks.checkLink')}
            </NotFoundContent>
          ) : listStatus === 'unavailable' ? (
            <div className="work-main-empty" data-testid="tasks-unavailable">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>{t('tasks.unavailableTitle')}</h1>
              <p>{t('tasks.unavailable')}</p>
            </div>
          ) : listStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>{t('tasks.loadTitle')}</h1>
              <p>{t('tasks.loadError')}</p>
              <button type="button" onClick={() => void load()}>
                {t('common.tryAgain')}
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
              <h1>{t('tasks.loadingSelected')}</h1>
            </div>
          ) : selectionStatus === 'not_found' ? (
            <div data-testid="tasks-not-found">
              <NotFoundContent
                title={t('tasks.unavailableSelectedTitle')}
                to="/tasks"
                linkLabel={t('tasks.back')}
                eyebrow={t('tasks.unavailableEyebrow')}
              >
                {t('tasks.missingBody')}
              </NotFoundContent>
            </div>
          ) : selectionStatus === 'error' ? (
            <div className="work-main-empty" data-testid="tasks-selected-error">
              <span className="work-main-icon" aria-hidden="true">
                ☑
              </span>
              <h1>{t('tasks.loadTitle')}</h1>
              <p>{t('tasks.loadError')}</p>
              <Link to="/tasks">{t('tasks.back')}</Link>
              <button type="button" onClick={() => void load()}>
                {t('common.tryAgain')}
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
              <h1>{t('tasks.selectTitle')}</h1>
              <p>{t('tasks.capturePrompt')}</p>
              <button type="button" onClick={() => setCreating(true)}>
                {t('tasks.newShort')}
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
  const t = useT();
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
      <strong>
        <MentionedText text={item.title} participants={participants} />
      </strong>
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
            {t('workOrg.linkedWork')} ·{' '}
            {productStateLabel(detail.linked_work.product_state)}
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
  const t = useT();
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
      onError(t('tasks.actionError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="work-org-card work-org-form"
      onSubmit={(event) => void submit(event)}
    >
      <span className="eyebrow">{t('tasks.newEyebrow')}</span>
      <h1>{t('tasks.captureTitle')}</h1>
      {sourceConversationId ? (
        <p className="work-org-source-note">{t('tasks.linkedSource')}</p>
      ) : null}
      <MentionTextField
        label={t('tasks.titleLabel')}
        value={title}
        onChange={setTitle}
        participants={participants}
        maxLength={200}
        autoFocus
      />
      <MentionTextField
        label={t('tasks.descriptionLabel')}
        value={description}
        onChange={setDescription}
        participants={participants}
        multiline
        rows={5}
        hint={
          <small className="work-org-muted">{t('tasks.mentionHint')}</small>
        }
      />
      <AssigneeField
        agents={agents}
        value={assigneeId}
        onChange={setAssigneeId}
      />
      <div className="work-org-actions">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="work-org-primary"
          disabled={saving || !title.trim()}
        >
          {saving ? t('tasks.creating') : t('tasks.create')}
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
  const t = useT();
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
      onError(t('tasks.actionError'));
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
      onError(t('tasks.actionError'));
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
      onError(t('tasks.actionError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="work-org-detail-grid">
      <article className="work-org-card work-org-form">
        <div className="work-org-detail-header">
          <div>
            <span className="eyebrow">{t('tasks.taskEyebrow')}</span>
            <h1>
              <MentionedText text={item.title} participants={participants} />
            </h1>
            <div className="work-org-detail-meta">
              <ParticipantChip
                participants={participants}
                id={item.assignee_id}
              />
              <span className="work-org-muted">
                {t('tasks.createdBy', {
                  name: participantLabel(participants, item.created_by),
                  time: formatWorkTime(item.created_at),
                })}
              </span>
              <MentionRow
                ids={readMentionIds(item)}
                participants={participants}
                limit={5}
              />
            </div>
          </div>
          <select
            aria-label={t('tasks.statusLabel')}
            value={item.status}
            disabled={saving}
            onChange={(event) =>
              void update({ status: event.target.value as WorkItemStatus })
            }
          >
            {WORK_ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </div>
        <MentionTextField
          label={t('tasks.titleLabel')}
          value={title}
          onChange={setTitle}
          participants={participants}
          maxLength={200}
        />
        <MentionTextField
          label={t('tasks.descriptionLabel')}
          value={description}
          onChange={setDescription}
          participants={participants}
          multiline
          rows={6}
          hint={
            <small className="work-org-muted">{t('tasks.mentionHint')}</small>
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
            {saving ? t('tasks.saving') : t('tasks.save')}
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
              {t('tasks.backToConversation')}
            </button>
          ) : null}
        </div>
      </article>

      <aside className="work-org-stack">
        <article className="work-org-card">
          <span className="eyebrow">{t('tasks.formalExecution')}</span>
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
                {t('tasks.openWork')}
              </button>
            </>
          ) : (
            <>
              <h2>{t('tasks.startWork')}</h2>
              <p className="work-org-muted">
                {t('tasks.startWorkDescription')}
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
                {t('tasks.createWork')}
              </button>
            </>
          )}
        </article>

        {item.status === 'in_review' ? (
          <article className="work-org-card work-org-review-card">
            <span className="eyebrow">{t('tasks.humanReview')}</span>
            <h2>{t('tasks.decisionNeeded')}</h2>
            <p className="work-org-muted">{t('tasks.reviewDescription')}</p>
            <div className="work-org-actions">
              <button
                type="button"
                className="work-org-primary"
                disabled={saving}
                onClick={() => void update({ status: 'done' })}
              >
                {t('tasks.markComplete')}
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
                  {t('tasks.reviewWork')}
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
                  {t('tasks.openConversation')}
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        <article className="work-org-card">
          <span className="eyebrow">{t('tasks.comments')}</span>
          <div className="work-org-comments">
            {comments.length === 0 ? (
              <p className="work-org-muted">{t('tasks.noComments')}</p>
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
            ariaLabel={t('tasks.addComment')}
            value={comment}
            onChange={setComment}
            participants={participants}
            multiline
            rows={3}
            placeholder={t('tasks.commentPlaceholder')}
          />
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => void addComment()}
          >
            {t('tasks.comment')}
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
  const t = useT();
  return (
    <label>
      {t('tasks.assignee')}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('tasks.unassigned')}</option>
        {agents.map((agent) => (
          <option value={agent.id} key={agent.id}>
            {coworkerOptionLabel(agent, t)}
          </option>
        ))}
        {value && !agents.some((agent) => agent.id === value) ? (
          <option value={value}>{t('tasks.unavailableMember')}</option>
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
  const t = useT();
  if (state === 'loading')
    return <p className="work-org-muted">{t('tasks.loadingDefinitions')}</p>;
  if (state === 'unavailable')
    // feature_unavailable means this workspace does not compose the
    // Product Work surface at all, so reloading can never succeed. No
    // Retry here — see docs/frontend.md "Surface availability".
    return (
      <p className="work-org-muted">{t('tasks.definitionsUnavailable')}</p>
    );
  if (state === 'error')
    return (
      <div className="work-org-error" role="alert">
        <p>{t('tasks.definitionsLoadError')}</p>
        <button type="button" onClick={onRetry}>
          {t('common.tryAgain')}
        </button>
      </div>
    );
  if (definitions.length === 0)
    return <p className="work-org-muted">{t('tasks.noDefinitions')}</p>;
  return (
    <label>
      {t('tasks.publishedDefinitions')}
      <select
        aria-label={t('tasks.publishedWorkDefinition')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t('tasks.selectDefinition')}</option>
        {definitions.map((definition) => (
          <option key={definition.definitionId} value={definition.definitionId}>
            {definition.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function coworkerOptionLabel(
  agent: Coworker,
  t: ReturnType<typeof useT>,
): string {
  return [
    agent.displayName,
    agent.roleLabel ?? coworkerRoleFallback(),
    runtimeStatusLabel(agent.runtimeStatus),
  ].join(' · ');
}

export default TasksPage;
