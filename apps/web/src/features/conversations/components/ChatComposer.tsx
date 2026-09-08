import { ISend } from '../../../components/icons';
import { useT } from '../../../i18n';

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
  const t = useT();
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
              {t('common.retry')}
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
          {t('composer.field.label')}
        </label>
        <textarea
          id="message"
          value={draft}
          disabled={disabled || sending}
          placeholder={t('composer.field.placeholder')}
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
          <button
            className="send-button"
            type="submit"
            aria-label={sending ? t('composer.sending') : t('composer.send')}
            disabled={sendDisabled}
          >
            <ISend aria-hidden="true" />
          </button>
        </div>
      </form>
      <p className="composer-hint">{t('composer.hint')}</p>
    </>
  );
}
