import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkItemDetailDto } from '@atomlink-ye/agent-server/product-contract';

import { workOrganizationClient } from './client';
import { formatWorkTime, productStateLabel } from './format';
import MentionedText from './MentionedText';
import MentionTextField from './MentionTextField';
import ParticipantChip from './ParticipantChip';
import { participantLabel, type Participant } from './participants';
import {
  claimBlockedReason,
  isClaimable,
  readMentionIds,
} from './work-item-extensions';
import {
  CommentCount,
  MentionRow,
  ParticipantAvatar,
  StatusBadge,
} from './WorkItemMeta';

const PEEK_LOAD_ERROR = 'Unable to load this card’s details. Please try again.';
const CLAIM_UNSUPPORTED =
  'Task claiming is not enabled in this deployment yet.';
const CLAIM_FAILED =
  'Unable to claim this Task. Someone else may have claimed it first. Refresh and try again.';

type Comments = Awaited<ReturnType<typeof workOrganizationClient.listComments>>;
type PeekStatus = 'loading' | 'ready' | 'error';

/**
 * The card detail panel Cumora opens beside the canvas.
 *
 * It stays a peek rather than a route: the reader keeps the Board in view, so
 * the panel only carries what a card cannot hold — the full description, the
 * comment thread, and the claim. Anything deeper is still the Task page, one
 * click away.
 */
export function BoardCardPeek({
  workItemId,
  participants,
  claimSupported,
  onClaimed,
  onClaimUnsupported,
  onClose,
}: {
  readonly workItemId: string;
  readonly participants: readonly Participant[];
  /** False once this deployment has answered "no claim endpoint here". */
  readonly claimSupported: boolean;
  readonly onClaimed: (workItemId: string) => void;
  readonly onClaimUnsupported: () => void;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<WorkItemDetailDto | null>(null);
  const [comments, setComments] = useState<Comments>([]);
  const [status, setStatus] = useState<PeekStatus>('loading');
  const [comment, setComment] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [nextDetail, nextComments] = await Promise.all([
        workOrganizationClient.getWorkItem(workItemId),
        workOrganizationClient.listComments(workItemId).catch(() => null),
      ]);
      setDetail(nextDetail);
      // Comments are a separate read; losing them must not cost the reader the
      // card itself, so an unreadable thread degrades to an empty list.
      setComments(nextComments ?? []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [workItemId]);

  useEffect(() => {
    setComment('');
    setNotice(null);
    void load();
  }, [load]);

  async function claim() {
    if (!detail || claiming) return;
    setClaiming(true);
    setNotice(null);
    try {
      const result = await workOrganizationClient.claimWorkItem(workItemId);
      if (!result.supported) {
        setNotice(CLAIM_UNSUPPORTED);
        onClaimUnsupported();
        return;
      }
      if (result.workItem) setDetail({ ...detail, work_item: result.workItem });
      onClaimed(workItemId);
      await load();
    } catch {
      setNotice(CLAIM_FAILED);
    } finally {
      setClaiming(false);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      const created = await workOrganizationClient.addComment(
        workItemId,
        comment.trim(),
      );
      setComments((current) => [...current, created]);
      setComment('');
    } catch {
      setNotice('Unable to post your comment. Please try again.');
    }
  }

  return (
    <aside
      className="work-board-peek"
      aria-label="Card details"
      data-testid="work-board-peek"
    >
      <header className="work-board-peek-head">
        <span className="eyebrow">Card details</span>
        <button type="button" aria-label="Close card details" onClick={onClose}>
          ×
        </button>
      </header>
      {status === 'loading' ? (
        <p className="work-org-muted">Loading card details…</p>
      ) : status === 'error' ? (
        <div className="work-org-error" role="alert">
          <p>{PEEK_LOAD_ERROR}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : detail ? (
        <>
          <div className="work-board-peek-meta">
            <StatusBadge status={detail.work_item.status} />
            <ParticipantChip
              participants={participants}
              id={detail.work_item.assignee_id}
            />
            <small className="work-org-muted">
              {formatWorkTime(detail.work_item.updated_at)}
            </small>
          </div>
          <h2>
            <MentionedText
              text={detail.work_item.title}
              participants={participants}
            />
          </h2>
          <p className="work-org-muted">
            Created by{' '}
            {participantLabel(participants, detail.work_item.created_by)}
          </p>
          {detail.work_item.description ? (
            <p className="work-board-peek-description">
              <MentionedText
                text={detail.work_item.description}
                participants={participants}
              />
            </p>
          ) : (
            <p className="work-org-muted">
              This card does not have a description yet.
            </p>
          )}
          <MentionRow
            ids={readMentionIds(detail.work_item)}
            participants={participants}
            limit={6}
          />
          {detail.linked_work ? (
            <p className="work-org-chip">
              Work · {productStateLabel(detail.linked_work.product_state)}
            </p>
          ) : null}
          {notice ? (
            <p className="work-org-muted" role="status">
              {notice}
            </p>
          ) : null}
          <div className="work-org-actions">
            {claimSupported ? (
              <ClaimButton
                detail={detail}
                participants={participants}
                claiming={claiming}
                onClaim={() => void claim()}
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                navigate(`/tasks/${encodeURIComponent(workItemId)}`)
              }
            >
              Open Task
            </button>
          </div>
          <section
            className="work-board-peek-comments"
            aria-label="Card comments"
          >
            <div className="work-board-peek-comments-head">
              <span className="eyebrow">Comments</span>
              <CommentCount count={comments.length} />
            </div>
            {comments.length === 0 ? (
              <p className="work-org-muted">No comments yet.</p>
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
              </div>
            ))}
            <MentionTextField
              ariaLabel="Add a comment"
              value={comment}
              onChange={setComment}
              participants={participants}
              multiline
              rows={3}
              placeholder="Write a comment. Your @mentions will be saved in the shared work record."
            />
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={() => void addComment()}
            >
              Comment
            </button>
          </section>
        </>
      ) : null}
    </aside>
  );
}

/**
 * The claim control.
 *
 * A claim that cannot succeed is shown as the reason it cannot, not as a
 * button that fails: the backend owns the atomic claim, and guessing on the
 * client would only produce a race the reader gets blamed for.
 */
function ClaimButton({
  detail,
  participants,
  claiming,
  onClaim,
}: {
  readonly detail: WorkItemDetailDto;
  readonly participants: readonly Participant[];
  readonly claiming: boolean;
  readonly onClaim: () => void;
}) {
  const now = Date.now();
  if (!isClaimable(detail.work_item, now))
    return (
      <span className="work-org-muted" data-testid="work-board-claim-blocked">
        {claimBlockedReason(detail.work_item, now, participants)}
      </span>
    );
  return (
    <button
      type="button"
      className="work-org-primary"
      data-testid="work-board-claim"
      disabled={claiming}
      onClick={onClaim}
    >
      {claiming ? 'Claiming…' : 'Claim Task'}
    </button>
  );
}

export default BoardCardPeek;
