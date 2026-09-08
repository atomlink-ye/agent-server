import { useEffect, useState } from 'react';

import {
  loadAccount,
  setDisplayName,
} from '../../features/account/account-gateway';

/**
 * The caller's own display name, shown next to the title bar. There is no
 * account settings page yet (see AGENTS.md/WORKFLOW.md for that boundary),
 * so this is the only place a person can move off the default "Guest XXXX"
 * name: click the name to open an inline text input, submit to rename.
 */
export function AccountName() {
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadAccount().then(
      (account) => {
        if (active) setName(account.displayName);
      },
      () => {
        // Leave the name unset; the badge simply stays hidden until it can
        // be loaded on a later render (e.g. after the reload below).
      },
    );
    return () => {
      active = false;
    };
  }, []);

  function startEditing(): void {
    setDraft(name ?? '');
    setError(null);
    setEditing(true);
  }

  async function submit(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await setDisplayName(trimmed);
      setName(saved);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (name === null && !editing) return null;

  if (editing) {
    return (
      <form
        className="account-name-form"
        aria-label="Change your display name"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          className="account-name-input"
          value={draft}
          autoFocus
          maxLength={80}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
          }}
          aria-label="Your display name"
        />
        <button
          className="account-name-save"
          type="submit"
          disabled={busy || !draft.trim()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          className="account-name-cancel"
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          Cancel
        </button>
        {error ? (
          <span className="account-name-error" role="alert">
            {error}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <button
      className="account-name-badge"
      type="button"
      onClick={startEditing}
      title="Change your display name"
    >
      {name}
    </button>
  );
}

export default AccountName;
