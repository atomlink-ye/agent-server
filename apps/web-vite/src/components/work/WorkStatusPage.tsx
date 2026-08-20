import { useEffect, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { isUuid, loadWorkCard, type WorkChatCard } from '../../api/chat';

type ReturnState = { readonly returnConversationId?: unknown };

export function WorkStatusPage() {
  const { workId } = useParams<{ workId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'error' }
    | { readonly status: 'ready'; readonly card: WorkChatCard }
  >({ status: 'loading' });
  const returnConversationId =
    (location.state as ReturnState | null)?.returnConversationId;
  const canRespond =
    typeof returnConversationId === 'string' && returnConversationId.length > 0;

  useEffect(() => {
    if (!isUuid(workId)) {
      setState({ status: 'error' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void loadWorkCard(workId)
      .then((card) => {
        if (active) setState({ status: 'ready', card });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [workId]);

  return (
    <main className="work-status-page">
      <div className="work-status-content">
        <span className="eyebrow">Work</span>
        {state.status === 'loading' ? <p role="status">Loading Work update…</p> : null}
        {state.status === 'error' ? (
          <div role="alert">
            <h1>Work update is unavailable</h1>
            <p>We could not load this Work right now.</p>
          </div>
        ) : null}
        {state.status === 'ready' ? <StatusDetails card={state.card} /> : null}
        <div className="work-status-actions">
          {canRespond ? (
            <button
              type="button"
              onClick={() =>
                navigate('/', { state: { returnConversationId } })
              }
            >
              Respond in chat
            </button>
          ) : null}
          <button type="button" onClick={() => navigate('/', { replace: true })}>
            Return to Conversations
          </button>
        </div>
      </div>
    </main>
  );
}

function StatusDetails({ card }: { readonly card: WorkChatCard }) {
  const statusClass =
    card.availability === 'unavailable'
      ? 'work-status--unavailable'
      : `work-status--${card.productState}`;
  return (
    <section className="work-status-details" aria-label="Work status">
      <h1>{card.title}</h1>
      <p className={`work-status ${statusClass}`}>
        {statusLabel(card.productState)}
      </p>
      <p>{resultText(card)}</p>
    </section>
  );
}

function statusLabel(state: WorkChatCard['productState']): string {
  if (state === null) return 'Status unavailable';
  switch (state) {
    case 'running':
      return 'Running';
    case 'needs_you':
      return 'Needs your attention';
    case 'complete':
      return 'Complete';
    case 'problem':
      return 'Problem';
  }
}

function resultText(card: WorkChatCard): string {
  if (card.resultSummary && card.resultCaptureStatus === 'present') return card.resultSummary;
  if (card.availability === 'unavailable' || card.resultCaptureStatus === 'not_captured') {
    return 'The latest result is not available here.';
  }
  if (card.resultCaptureStatus === 'redacted') return 'The result is unavailable here.';
  return card.resultSummary ?? 'No result is available yet.';
}
