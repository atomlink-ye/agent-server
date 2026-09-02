import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  completeMention,
  readMentionDraft,
  type MentionDraft,
} from './mentions';
import {
  matchParticipants,
  participantInitials,
  type Participant,
} from './participants';

type Control = HTMLInputElement | HTMLTextAreaElement;

export interface MentionTextFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly participants: readonly Participant[];
  /** Rendered as a wrapping `<label>` so the control keeps an accessible name. */
  readonly label?: string;
  /** Used instead of `label` when the surrounding layout owns the caption. */
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly multiline?: boolean;
  readonly rows?: number;
  /**
   * When true, Cmd+Enter (Mac) or Ctrl+Enter (other platforms) submits the
   * surrounding `<form>` while the mention list is closed; plain Enter keeps
   * inserting a newline. Only meaningful together with `multiline` — a
   * single-line `<input>` already submits its form on Enter natively.
   */
  readonly submitOnModEnter?: boolean;
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Extra content under the control, e.g. a character counter. */
  readonly hint?: React.ReactNode;
}

/**
 * A text control that completes `@` mentions.
 *
 * This is the equivalent of Cumora's `RichInput` + `MentionList`: typing `@`
 * opens a filtered list of the participants this workspace has actually shown
 * us, and choosing one inserts the stable `@<participant-id>` token the
 * backend's mention parser reads. It stays a plain `input`/`textarea` — the
 * value is the prose, not a document model — so every existing form, label
 * selector, and submit path keeps working and a writer who never types `@`
 * cannot tell it apart from the field it replaced.
 *
 * Keyboard: ArrowUp/ArrowDown move the highlight, Enter or Tab insert, Escape
 * dismisses without leaving the field. The list is only re-armed by editing,
 * so Escape stays dismissed while the caret sits in the same token. When the
 * list is closed, `submitOnModEnter` makes Cmd/Ctrl+Enter submit the form
 * instead of inserting a newline.
 */
export function MentionTextField({
  value,
  onChange,
  participants,
  label,
  ariaLabel,
  placeholder,
  maxLength,
  multiline = false,
  rows,
  submitOnModEnter = false,
  autoFocus = false,
  disabled = false,
  className,
  hint,
}: MentionTextFieldProps) {
  const controlRef = useRef<Control | null>(null);
  const [draft, setDraft] = useState<MentionDraft | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const listboxId = `${useId()}-mentions`;

  const suggestions = draft
    ? matchParticipants(participants, draft.query)
    : ([] as readonly Participant[]);
  const open = draft !== null && suggestions.length > 0;

  useEffect(() => {
    if (pendingCaret === null) return;
    const control = controlRef.current;
    setPendingCaret(null);
    if (!control) return;
    control.focus();
    control.setSelectionRange(pendingCaret, pendingCaret);
  }, [pendingCaret]);

  const syncDraft = useCallback(
    (text: string, caret: number | null, rearm: boolean) => {
      if (caret === null) {
        setDraft(null);
        return;
      }
      const next = readMentionDraft(text, caret);
      if (!next) {
        setDraft(null);
        return;
      }
      if (!rearm && dismissedAt === next.anchor) {
        setDraft(null);
        return;
      }
      if (rearm && dismissedAt !== null) setDismissedAt(null);
      setDraft((current) =>
        current &&
        current.anchor === next.anchor &&
        current.query === next.query
          ? current
          : next,
      );
      setHighlight(0);
    },
    [dismissedAt],
  );

  function insert(participant: Participant) {
    const control = controlRef.current;
    if (!draft || !control) return;
    const caret = control.selectionStart ?? value.length;
    const completed = completeMention(value, draft, caret, participant.id);
    setDraft(null);
    setDismissedAt(null);
    onChange(completed.text);
    setPendingCaret(completed.caret);
  }

  function handleKeyDown(event: React.KeyboardEvent<Control>) {
    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight(
          (current) => (current - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const participant = suggestions[highlight];
        if (!participant) return;
        event.preventDefault();
        insert(participant);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(draft?.anchor ?? null);
        setDraft(null);
      }
      return;
    }
    if (
      submitOnModEnter &&
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const shared = {
    ref: (node: Control | null) => {
      controlRef.current = node;
    },
    value,
    placeholder,
    maxLength,
    autoFocus,
    disabled,
    'aria-label': label ? undefined : ariaLabel,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': open ? listboxId : undefined,
    'aria-activedescendant': open
      ? `${listboxId}-${suggestions[highlight]?.id ?? ''}`
      : undefined,
    onChange: (event: React.ChangeEvent<Control>) => {
      const next = event.target.value;
      onChange(next);
      syncDraft(next, event.target.selectionStart, true);
    },
    onKeyDown: handleKeyDown,
    onKeyUp: (event: React.KeyboardEvent<Control>) => {
      if (
        event.key.startsWith('Arrow') ||
        event.key === 'Home' ||
        event.key === 'End'
      )
        syncDraft(
          event.currentTarget.value,
          event.currentTarget.selectionStart,
          false,
        );
    },
    onClick: (event: React.MouseEvent<Control>) => {
      syncDraft(
        event.currentTarget.value,
        event.currentTarget.selectionStart,
        false,
      );
    },
    onBlur: () => setDraft(null),
  };

  const control = multiline ? (
    <textarea {...shared} rows={rows} />
  ) : (
    <input {...shared} type="text" />
  );

  const body = (
    <span className="work-org-mention-field">
      {control}
      {open ? (
        <ul
          className="work-org-mention-suggestions"
          data-testid="mention-suggestions"
          id={listboxId}
          role="listbox"
          aria-label="提及成员"
        >
          {suggestions.map((participant, index) => (
            <li key={participant.id} role="presentation">
              <button
                type="button"
                className="work-org-mention-option"
                data-active={index === highlight ? 'true' : 'false'}
                id={`${listboxId}-${participant.id}`}
                role="option"
                aria-selected={index === highlight}
                tabIndex={-1}
                // A mousedown default would blur the field before the click
                // lands, closing the list out from under the pointer.
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(participant);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <span
                  aria-hidden="true"
                  className={`work-org-avatar${
                    participant.kind === 'agent'
                      ? ' work-org-avatar--agent'
                      : ''
                  }`}
                >
                  {participantInitials(participant.name)}
                </span>
                <span className="work-org-mention-option-text">
                  <strong>{participant.name}</strong>
                  <small>{participant.detail ?? participant.id}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint}
    </span>
  );

  if (!label) return <span className={className}>{body}</span>;
  return (
    <label className={className}>
      {label}
      {body}
    </label>
  );
}

export default MentionTextField;
