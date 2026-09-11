import {
  isUuid,
  type WorkChatCard,
} from '../../conversations/conversations-gateway';
import { useT, type Translate } from '../../../i18n';
import { useWorkCard } from '../queries/use-work-card';
import './work-card.css';
import { WorkTitle } from './work-title';
import { productStatePresentation } from './work-presentation';

export interface WorkCardProps {
  readonly workRef: string | null;
  readonly onOpen: (workId: string) => void;
}

/**
 * The live handle on a Work inside a conversation: what it is, where it stands
 * now, and a way in. It is deliberately not a place to read the Work's output.
 * A result summary is a whole report — rendering it here turned the card into a
 * wall of raw markdown that dwarfed the conversation — so the card shows a
 * short preview and the full text stays on the Work page, or in the Agent's
 * own message when the Agent chooses to say it.
 */
export function WorkCard({ workRef, onOpen }: WorkCardProps) {
  const t = useT();
  const state = useWorkCard(workRef);

  if (!isUuid(workRef)) return null;

  // aria-live="off" is deliberate. The card sits inside the transcript, which is
  // an aria-live="polite" region, so every three-second refresh was announced as
  // if the conversation had a new message. The Work page is where someone
  // following state belongs; a tile that repeats itself is not an update.
  return (
    <aside
      className="work-card"
      data-state={
        state.status === 'ready' ? state.card.productState : state.status
      }
      aria-label={t('workCard.label')}
      aria-live="off"
    >
      {state.status === 'loading' ? (
        <p className="work-card-main work-loading-feedback">
          {t('workCard.loading')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        // Not role="alert": a refresh that failed is transient, and an
        // assertive interruption for it talks over whatever is being read.
        <div className="work-card-main">
          <p>{t('workCard.unavailable')}</p>
        </div>
      ) : null}
      {state.status === 'ready' ? <WorkCardContent card={state.card} /> : null}
      {state.status === 'loading' ? null : (
        <button
          type="button"
          className="work-card-open"
          onClick={() =>
            onOpen(state.status === 'ready' ? state.card.workId : workRef)
          }
        >
          {t('workCard.open')}
        </button>
      )}
    </aside>
  );
}

function WorkCardContent({ card }: { readonly card: WorkChatCard }) {
  const t = useT();
  const status = statusLabel(t, card.productState);
  const statusClass =
    card.availability === 'unavailable'
      ? 'work-status--unavailable'
      : `work-status--${card.productState}`;
  return (
    <div className="work-card-main">
      <div className="work-card-heading">
        <span className="eyebrow">{t('workCard.eyebrow')}</span>
        <span className={`work-status ${statusClass}`}>
          <span aria-hidden="true">
            {card.productState === 'problem'
              ? '! '
              : card.productState === 'needs_you'
                ? '? '
                : ''}
          </span>
          {status}
        </span>
      </div>
      <h3>
        <WorkTitle title={card.title} />
      </h3>
      <p className="work-card-result">{resultText(t, card)}</p>
    </div>
  );
}

// The same Work is named the same way wherever it appears: the Work list, the
// Work page, and this tile all read their label from productStatePresentation.
// A null state is the one case the server could not read at all; every other
// stage, including a Work that has not started, has a name of its own.
function statusLabel(
  t: Translate,
  state: WorkChatCard['productState'],
): string {
  if (state === null) return t('workCard.statusUnavailable');
  return productStatePresentation(state).label;
}

function resultText(t: Translate, card: WorkChatCard): string {
  if (card.resultSummary && card.resultCaptureStatus === 'present') {
    return condense(card.resultSummary);
  }
  if (
    card.availability === 'unavailable' ||
    card.resultCaptureStatus === 'not_captured'
  ) {
    return t('workCard.result.unavailableHere');
  }
  if (card.resultCaptureStatus === 'redacted')
    return t('workCard.result.redacted');
  if (card.resultSummary) return condense(card.resultSummary);
  // Before a result exists the honest secondary line is what the state means,
  // not a claim about a result.
  if (card.productState !== null)
    return productStatePresentation(card.productState).description;
  return t('workCard.result.none');
}

const summaryCharacterLimit = 180;

/**
 * A Work's result is authored as markdown, so the card was showing the syntax
 * itself — headings, fences, table pipes — as one unbroken paragraph. Flatten
 * it to a short readable preview: this is a glance, not the document.
 * The character limit bounds the preview; CSS wraps all of that bounded text.
 */
function condense(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > summaryCharacterLimit
    ? `${flat.slice(0, summaryCharacterLimit).trimEnd()}…`
    : flat;
}
