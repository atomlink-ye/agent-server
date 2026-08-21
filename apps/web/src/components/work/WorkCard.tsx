import { useEffect, useState } from 'react';

import { isUuid, loadWorkCard, type WorkChatCard } from '../../api/chat';

export interface WorkCardProps {
  readonly workRef: string | null;
  readonly onOpen: (workId: string) => void;
}

export function WorkCard({ workRef, onOpen }: WorkCardProps) {
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'error' }
    | { readonly status: 'ready'; readonly card: WorkChatCard }
  >({ status: 'loading' });

  useEffect(() => {
    if (!isUuid(workRef)) return;
    let active = true;
    setState({ status: 'loading' });
    void loadWorkCard(workRef)
      .then((card) => {
        if (active) setState({ status: 'ready', card });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [workRef]);

  if (!isUuid(workRef)) return null;

  return (
    <aside className="work-card" aria-label="Work update">
      {state.status === 'loading' ? <p>Loading Work update…</p> : null}
      {state.status === 'error' ? (
        <div role="alert">
          <p>Work update is unavailable.</p>
          <button type="button" onClick={() => onOpen(workRef)}>
            Open Work
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <WorkCardContent card={state.card} onOpen={onOpen} />
      ) : null}
    </aside>
  );
}

function WorkCardContent({
  card,
  onOpen,
}: {
  readonly card: WorkChatCard;
  readonly onOpen: (workId: string) => void;
}) {
  const status = statusLabel(card.productState);
  const statusClass =
    card.availability === 'unavailable'
      ? 'work-status--unavailable'
      : `work-status--${card.productState}`;
  return (
    <>
      <div className="work-card-heading">
        <span className="eyebrow">Work</span>
        <span className={`work-status ${statusClass}`}>
          {status}
        </span>
      </div>
      <h3>{card.title}</h3>
      <p className="work-card-result">{resultText(card)}</p>
      <button type="button" onClick={() => onOpen(card.workId)}>
        Open Work
      </button>
    </>
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
  if (card.resultSummary && card.resultCaptureStatus === 'present') {
    return card.resultSummary;
  }
  if (card.availability === 'unavailable' || card.resultCaptureStatus === 'not_captured') {
    return 'The latest result is not available here.';
  }
  if (card.resultCaptureStatus === 'redacted') return 'The result is unavailable here.';
  if (card.resultSummary) return card.resultSummary;
  return 'No result is available yet.';
}
