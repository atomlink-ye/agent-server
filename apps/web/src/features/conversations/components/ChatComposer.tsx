import { IClip, ISend } from '../../../components/icons';

export interface ChatComposerProps {
  readonly draft: string;
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly sendError: string | null;
  readonly canRetry: boolean;
  readonly onDraftChange: (draft: string) => void;
  readonly onSend: (body: string) => void;
  readonly onRetry: () => void;
}

export function ChatComposer({
  draft,
  sending,
  disabled,
  sendError,
  canRetry,
  onDraftChange,
  onSend,
  onRetry,
}: ChatComposerProps) {
  const sendDisabled = disabled || sending || draft.trim().length === 0;

  const submit = (): void => {
    if (sendDisabled) return;
    onSend(draft);
  };

  return (
    <>
      {sendError ? (
        <div className="composer-error" role="alert" aria-live="assertive">
          <span>{sendError}</span>
          {canRetry ? (
            <button type="button" disabled={sending} onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="message">
          Message
        </label>
        <textarea
          id="message"
          value={draft}
          disabled={disabled || sending}
          placeholder="Write a message..."
          rows={1}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-actions">
          <div className="disabled-conversation-action">
            <button
              className="composer-tool"
              type="button"
              aria-label="Attach a file"
              aria-describedby="conversation-attachments-reason"
              disabled
            >
              <IClip aria-hidden="true" />
            </button>
            <span id="conversation-attachments-reason" role="tooltip">
              File attachments aren’t available in conversations yet.
            </span>
          </div>
          <button
            className="send-button"
            type="submit"
            aria-label={sending ? 'Sending message' : 'Send message'}
            disabled={sendDisabled}
          >
            <ISend aria-hidden="true" />
          </button>
        </div>
      </form>
      <p className="composer-hint">
        Press Enter to send · Shift + Enter for a new line
      </p>
    </>
  );
}
