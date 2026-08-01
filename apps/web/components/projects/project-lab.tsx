'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AssistantMarkdown } from '@/components/chat/assistant-markdown';

type Aggregate = {
  root_task_id: string;
  status: string;
  tasks: Array<{
    task_id: string;
    parent_task_id: string | null;
    status: string;
    latest_run_status: string | null;
  }>;
  team_run: { status: string; phase: string } | null;
  members: Array<{ name: string; role: string; status: string }>;
  work_items: Array<{
    subject: string;
    status: string;
    owner_name: string;
    completion_summary: string | null;
    truncated: boolean;
  }>;
  report: { text: string; truncated: boolean } | null;
  activities: Array<{ task_id: string; tool: string; status: string }>;
  proposal: {
    learning_proposal_id: string;
    status: string;
    source: { team_run_id: string; task_id: string; run_id: string };
    target: { path: string; base_content_sha256: string };
    proposed_content: string;
    evidence_refs: string[];
    accepted_memory_version_id: string | null;
  } | null;
  memory_receipt: {
    path: string;
    version: number;
    memory_version_id: string;
    content_sha256: string;
    content: string;
  } | null;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
const terminalStatuses = new Set([
  'succeeded',
  'completed',
  'failed',
  'cancelled',
]);

export function ProjectLab() {
  const [rootTaskId, setRootTaskId] = useState<string>();
  const [aggregate, setAggregate] = useState<Aggregate>();
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState(false);
  const [mutation, setMutation] = useState<'launch' | 'review' | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editProposalId, setEditProposalId] = useState<string>();
  const [reviewMessage, setReviewMessage] = useState<string>();
  const [urlTaskState, setUrlTaskState] = useState<
    'unknown' | 'none' | 'loading'
  >('unknown');
  const requestRef = useRef<{
    generation: number;
    controller: AbortController;
  } | null>(null);
  const rootTaskRef = useRef<string | undefined>(undefined);
  const pollTimerRef = useRef<number | undefined>(undefined);

  rootTaskRef.current = rootTaskId;

  const readTaskFromUrl = useCallback(() => {
    const task = new URLSearchParams(window.location.search).get('task');
    if (task) setRootTaskId(task);
    return task;
  }, []);

  const fetchAggregate = useCallback(async (taskId: string, quiet = false) => {
    const previous = requestRef.current;
    previous?.controller.abort();
    const request = {
      generation: (previous?.generation ?? 0) + 1,
      controller: new AbortController(),
    };
    requestRef.current = request;
    if (!quiet) setLoadState('loading');
    try {
      const response = await fetch(
        `/api/projects/self-learning/runs/${encodeURIComponent(taskId)}`,
        { cache: 'no-store', signal: request.controller.signal },
      );
      if (!response.ok) throw new Error('aggregate');
      const next = (await response.json()) as Aggregate;
      if (
        requestRef.current?.generation !== request.generation ||
        rootTaskRef.current !== taskId
      )
        return null;
      setAggregate(next);
      setLoadState('ready');
      setError(false);
      return next;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError')
        return null;
      if (
        requestRef.current?.generation !== request.generation ||
        rootTaskRef.current !== taskId
      )
        return null;
      if (!quiet) setLoadState('error');
      setError(true);
      return null;
    }
  }, []);

  useEffect(() => {
    const task = readTaskFromUrl();
    setUrlTaskState(task ? 'loading' : 'none');
    if (task) {
      rootTaskRef.current = task;
      setRootTaskId(task);
      void fetchAggregate(task);
    }
  }, [fetchAggregate, readTaskFromUrl]);

  useEffect(() => {
    if (
      !rootTaskId ||
      !aggregate ||
      terminalStatuses.has(aggregate.status) ||
      mutation
    )
      return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await fetchAggregate(rootTaskId, true);
      if (!cancelled) pollTimerRef.current = window.setTimeout(poll, 2500);
    };
    pollTimerRef.current = window.setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [aggregate, fetchAggregate, mutation, rootTaskId]);

  async function launch() {
    if (mutation) return;
    requestRef.current?.controller.abort();
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    setMutation('launch');
    setError(false);
    setReviewMessage(undefined);
    try {
      const response = await fetch('/api/projects/self-learning/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('launch');
      const data = (await response.json()) as { root_task_id: string };
      const task = data.root_task_id;
      window.history.replaceState(
        {},
        '',
        `/projects?task=${encodeURIComponent(task)}`,
      );
      rootTaskRef.current = task;
      setRootTaskId(task);
      setUrlTaskState('loading');
      await fetchAggregate(task);
    } catch {
      setError(true);
      setLoadState('error');
    } finally {
      setMutation(null);
    }
  }

  async function review(action: 'accept' | 'reject' | 'edit_and_accept') {
    if (!rootTaskId || !aggregate?.proposal || mutation) return;
    if (action === 'edit_and_accept' && proposalContentError(editContent))
      return;
    requestRef.current?.controller.abort();
    if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    setMutation('review');
    setReviewMessage(undefined);
    try {
      const body =
        action === 'edit_and_accept'
          ? { action, content: editContent }
          : { action };
      const response = await fetch(
        `/api/projects/self-learning/runs/${encodeURIComponent(rootTaskId)}/proposals/${encodeURIComponent(aggregate.proposal.learning_proposal_id)}/review`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error('review');
      setReviewMessage(
        action === 'reject' ? 'Proposal rejected.' : 'Proposal accepted.',
      );
      await fetchAggregate(rootTaskId, true);
    } catch {
      setReviewMessage('That review could not be saved. Try again.');
    } finally {
      setMutation(null);
    }
  }

  const isRunning = Boolean(
    aggregate && !terminalStatuses.has(aggregate.status),
  );
  const progress = useMemo(() => {
    if (!aggregate?.tasks.length) return 0;
    const done = aggregate.tasks.filter((task) =>
      terminalStatuses.has(task.status),
    ).length;
    return Math.round((done / aggregate.tasks.length) * 100);
  }, [aggregate]);
  const hasInitialTask = urlTaskState !== 'none';
  const canLaunch = !hasInitialTask && !rootTaskId && !mutation;

  return (
    <main className="project-page">
      <div className="project-frame">
        <header className="project-header">
          <div className="project-brand">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            <div>
              <p className="eyebrow">Agent Server · Project Lab</p>
              <h1>Self-learning research</h1>
            </div>
          </div>
          <div className="project-header-actions">
            <span className="synthetic-badge">Synthetic demo only</span>
            {rootTaskId ? (
              <button
                className="quiet-button"
                type="button"
                onClick={() => void fetchAggregate(rootTaskId)}
                disabled={loadState === 'loading' || Boolean(mutation)}
              >
                Refresh
              </button>
            ) : null}
          </div>
        </header>

        {!aggregate && hasInitialTask ? (
          <ProjectLoadingState
            error={error}
            onRetry={() =>
              rootTaskId ? void fetchAggregate(rootTaskId) : undefined
            }
          />
        ) : !aggregate ? (
          <section
            className="project-welcome"
            aria-labelledby="project-welcome-title"
          >
            <div className="welcome-copy">
              <p className="section-kicker">One fixed team · observer view</p>
              <h2 id="project-welcome-title">
                Launch a fixed research run and observe what it learns.
              </h2>
              <p>
                This synthetic team will investigate, compare its findings, and
                prepare a small learning proposal for your review. The team and
                its run are server-configured; there is no project setup here.
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => void launch()}
                disabled={!canLaunch}
              >
                {mutation === 'launch'
                  ? 'Starting the team…'
                  : 'Launch research team'}{' '}
                <span aria-hidden="true">↗</span>
              </button>
              {error ? (
                <InlineError
                  onRetry={() =>
                    rootTaskId ? void fetchAggregate(rootTaskId) : void launch()
                  }
                />
              ) : null}
            </div>
            <div className="welcome-note" aria-label="About this demo">
              <span className="note-line" />
              <p>
                This view follows one server-configured team. Refreshing the
                page keeps the run in view.
              </p>
            </div>
          </section>
        ) : (
          <ProjectInspector
            aggregate={aggregate}
            progress={progress}
            isRunning={isRunning}
            editContent={editContent}
            setEditContent={setEditContent}
            editProposalId={editProposalId}
            initializeEditContent={(proposalId, content) => {
              if (editProposalId === proposalId) return;
              setEditProposalId(proposalId);
              setEditContent(content);
            }}
            mutation={mutation}
            reviewMessage={reviewMessage}
            onReview={review}
          />
        )}
        {error && aggregate ? (
          <InlineError
            onRetry={() => void fetchAggregate(aggregate.root_task_id)}
          />
        ) : null}
      </div>
    </main>
  );
}

function ProjectInspector({
  aggregate,
  progress,
  isRunning,
  editContent,
  setEditContent,
  editProposalId,
  initializeEditContent,
  mutation,
  reviewMessage,
  onReview,
}: {
  aggregate: Aggregate;
  progress: number;
  isRunning: boolean;
  editContent: string;
  setEditContent: (value: string) => void;
  editProposalId?: string;
  initializeEditContent: (proposalId: string, content: string) => void;
  mutation: 'launch' | 'review' | null;
  reviewMessage?: string;
  onReview: (action: 'accept' | 'reject' | 'edit_and_accept') => void;
}) {
  const proposal = aggregate.proposal;
  const proposalPending = proposal?.status === 'pending';
  return (
    <div className="project-inspector">
      <section className="run-overview" aria-labelledby="run-title">
        <div>
          <p className="section-kicker">Active research run</p>
          <h2 id="run-title">A focused look at what the team is learning</h2>
          <p className="run-subtitle">
            The team is working through a fixed research loop. You can watch
            progress, then decide whether to save its proposed learning.
          </p>
        </div>
        <div className="run-status-block">
          <span
            className={`status-pill ${isRunning ? 'is-running' : aggregate.status === 'failed' ? 'is-failed' : 'is-complete'}`}
          >
            {labelStatus(aggregate.status)}
          </span>
          <strong>{progress}%</strong>
          <span
            className="progress-track"
            role="progressbar"
            aria-label="Research run progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </span>
          <small>
            {aggregate.team_run?.phase
              ? labelPhase(aggregate.team_run.phase)
              : 'Run summary'}
          </small>
        </div>
      </section>

      <section className="lab-section" aria-labelledby="team-title">
        <SectionHeading
          kicker="The fixed team"
          title="People and roles"
          id="team-title"
        />
        <div className="member-grid">
          {aggregate.members.map((member) => (
            <MemberCard
              key={`${member.name}-${member.role}`}
              member={member}
              runStatus={aggregate.status}
            />
          ))}
        </div>
      </section>

      <section className="lab-section" aria-labelledby="work-title">
        <SectionHeading
          kicker="Work items"
          title="What is moving the run forward"
          id="work-title"
        />
        <div className="work-list">
          {aggregate.work_items.length ? (
            aggregate.work_items.map((item, index) => (
              <WorkItem key={`${item.subject}-${index}`} item={item} />
            ))
          ) : (
            <p className="muted-copy">
              Work items will appear as the team begins.
            </p>
          )}
        </div>
      </section>

      <section
        className="lab-section activity-section"
        aria-labelledby="activity-title"
      >
        <SectionHeading
          kicker="Safe activity"
          title="A compact timeline"
          id="activity-title"
        />
        <ActivityTimeline activities={aggregate.activities} />
      </section>

      <section
        className="lab-section report-section"
        aria-labelledby="report-title"
      >
        <SectionHeading
          kicker="Team report"
          title="Six-part research report"
          id="report-title"
        />
        {aggregate.report ? (
          <div className="report-card">
            <AssistantMarkdown text={aggregate.report.text} />
            {aggregate.report.truncated ? (
              <p className="truncation-note">Report shortened for this view.</p>
            ) : null}
          </div>
        ) : (
          <EmptyProgress text="The report will appear when the team has enough to say." />
        )}
      </section>

      <section
        className="lab-section proposal-section"
        aria-labelledby="proposal-title"
      >
        <SectionHeading
          kicker="Learning proposal"
          title="Decide what to remember"
          id="proposal-title"
        />
        {proposalPending && proposal ? (
          <div className="proposal-card">
            <div className="proposal-copy">
              <span className="proposal-mark">✦</span>
              <div>
                <p className="proposal-label">Pending your review</p>
                <p className="proposal-description">
                  The team suggests saving this concise learning for future
                  research.
                </p>
              </div>
            </div>
            <pre className="proposal-content">{proposal.proposed_content}</pre>
            <div className="proposal-meta">
              <div>
                <span className="proposal-meta-label">Memory target</span>
                <code>{proposal.target.path}</code>
              </div>
              <div>
                <span className="proposal-meta-label">
                  Evidence references ({proposal.evidence_refs.length})
                </span>
                {proposal.evidence_refs.length ? (
                  <ul className="evidence-list">
                    {proposal.evidence_refs.map((reference) => (
                      <li key={reference}>{reference}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="proposal-meta-empty">None attached</span>
                )}
              </div>
            </div>
            <div className="proposal-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => onReview('accept')}
                disabled={Boolean(mutation)}
              >
                Accept proposal
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onReview('reject')}
                disabled={Boolean(mutation)}
              >
                Reject
              </button>
            </div>
            <details className="edit-disclosure">
              <summary
                onClick={() =>
                  initializeEditContent(
                    proposal.learning_proposal_id,
                    proposal.proposed_content,
                  )
                }
              >
                Edit and accept instead
              </summary>
              <label htmlFor="proposal-edit">Saved learning</label>
              <textarea
                id="proposal-edit"
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                rows={6}
              />
              {editProposalId === proposal.learning_proposal_id &&
              proposalContentError(editContent) ? (
                <p className="edit-validation" role="alert">
                  {proposalContentError(editContent)}
                </p>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                onClick={() => onReview('edit_and_accept')}
                disabled={
                  Boolean(mutation) ||
                  editProposalId !== proposal.learning_proposal_id ||
                  Boolean(proposalContentError(editContent))
                }
              >
                Accept edited learning
              </button>
            </details>
            {reviewMessage ? (
              <p className="review-message" role="status">
                {reviewMessage}
              </p>
            ) : null}
          </div>
        ) : aggregate.memory_receipt ? (
          <MemoryReceipt receipt={aggregate.memory_receipt} />
        ) : (
          <EmptyProgress text="No learning proposal is waiting for review." />
        )}
      </section>
    </div>
  );
}

function SectionHeading({
  kicker,
  title,
  id,
}: {
  kicker: string;
  title: string;
  id: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-kicker">{kicker}</p>
        <h3 id={id}>{title}</h3>
      </div>
      <span className="heading-rule" aria-hidden="true" />
    </div>
  );
}
function MemberCard({
  member,
  runStatus,
}: {
  member: Aggregate['members'][number];
  runStatus: string;
}) {
  const displayStatus =
    ['succeeded', 'completed'].includes(runStatus.toLowerCase()) &&
    !['failed', 'cancelled'].includes(member.status.toLowerCase())
      ? 'completed'
      : member.status;
  return (
    <article className="member-card">
      <div className="member-avatar" aria-hidden="true">
        {member.name.slice(0, 1).toUpperCase()}
      </div>
      <div>
        <h4>{member.name}</h4>
        <p>{member.role}</p>
      </div>
      <span className={`mini-status ${displayStatus.toLowerCase()}`}>
        {labelStatus(displayStatus)}
      </span>
    </article>
  );
}
function WorkItem({ item }: { item: Aggregate['work_items'][number] }) {
  const status = item.status.toLowerCase();
  const failed = ['failed', 'cancelled'].includes(status);
  return (
    <article className="work-item">
      <span
        className={`work-icon ${status} ${failed ? 'is-danger' : ''}`}
        aria-hidden="true"
      >
        {['succeeded', 'completed'].includes(status) ? '✓' : failed ? '!' : '·'}
      </span>
      <div>
        <h4>{item.subject}</h4>
        <p>{item.completion_summary || 'In progress'}</p>
      </div>
      <span className={`work-status ${failed ? 'is-danger' : ''}`}>
        {labelWorkItemStatus(item.status)}
      </span>
      <span className="work-owner">{item.owner_name}</span>
    </article>
  );
}
function ActivityTimeline({
  activities,
}: {
  activities: Aggregate['activities'];
}) {
  return activities.length ? (
    <ol className="timeline">
      {activities.map((activity, index) => (
        <li key={`${activity.task_id}-${activity.tool}-${index}`}>
          <span className="timeline-dot" />
          <div>
            <strong>{safeToolLabel(activity.tool)}</strong>
            <span>{labelStatus(activity.status)}</span>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted-copy">Safe activity will appear as the team works.</p>
  );
}
function MemoryReceipt({
  receipt,
}: {
  receipt: NonNullable<Aggregate['memory_receipt']>;
}) {
  return (
    <div className="memory-receipt" aria-label="Accepted memory receipt">
      <span className="receipt-check">✓</span>
      <div className="memory-receipt-content">
        <p className="proposal-label">Saved learning</p>
        <dl className="memory-receipt-meta">
          <div>
            <dt>Memory path</dt>
            <dd>
              <code>{receipt.path}</code>
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              <code>{receipt.version}</code>
            </dd>
          </div>
          <div>
            <dt>Accepted version ID</dt>
            <dd>
              <code>{receipt.memory_version_id}</code>
            </dd>
          </div>
          <div>
            <dt>Content SHA</dt>
            <dd>
              <code>{receipt.content_sha256}</code>
            </dd>
          </div>
        </dl>
        <p className="memory-content-label">Content</p>
        <p className="memory-content">{receipt.content}</p>
      </div>
    </div>
  );
}
function EmptyProgress({ text }: { text: string }) {
  return (
    <div className="empty-progress">
      <span aria-hidden="true">◌</span>
      <p>{text}</p>
    </div>
  );
}
function ProjectLoadingState({
  error,
  onRetry,
}: {
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="project-loading-wrap">
      <div className="project-loading" role="status" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <p className="section-kicker">Restoring research run</p>
          <p>Checking the saved progress for this synthetic team…</p>
        </div>
      </div>
      {error ? <InlineError onRetry={onRetry} /> : null}
    </div>
  );
}
function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="project-error" role="alert">
      <span>We couldn’t load this run.</span>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
function labelStatus(status: string) {
  const value = status.toLowerCase();
  if (['succeeded', 'completed'].includes(value)) return 'Complete';
  if (['failed', 'cancelled'].includes(value)) return 'Needs attention';
  if (['queued'].includes(value)) return 'Queued';
  return 'Working';
}
function labelWorkItemStatus(status: string) {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function proposalContentError(content: string) {
  const bytes = new TextEncoder().encode(content).length;
  if (!content.trim()) return 'Add saved learning before accepting the edit.';
  if (bytes > 8192) return 'Keep saved learning under 8,192 bytes.';
  return '';
}
function labelPhase(phase: string) {
  return phase
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function safeToolLabel(tool: string) {
  const normalized = tool.toLowerCase();
  if (normalized.includes('search')) return 'Research search';
  if (normalized.includes('read')) return 'Source review';
  if (normalized.includes('write')) return 'Drafting';
  return 'Team activity';
}
