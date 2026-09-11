import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n';

import {
  loadAuthIdentity,
  logout,
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
  const t = useT();
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadAuthIdentity().then(
      (identity) => {
        if (active) {
          setUsername(identity.username);
          setName(identity.displayName);
        }
      },
      () =>
        loadAccount().then(
          (account) => {
            if (active) setName(account.displayName);
          },
          () => {
            // Leave the name unset; the badge simply stays hidden until it can
            // be loaded on a later render (e.g. after the reload below).
          },
        ),
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
    } catch {
      setError(t('account.saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (name === null && username === null && !editing) return null;

  if (editing) {
    return (
      <form
        className="account-name-form"
        aria-label={t('account.changeName')}
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
          aria-label={t('account.displayName')}
        />
        <button
          className="account-name-save"
          type="submit"
          disabled={busy || !draft.trim()}
        >
          {busy ? t('authoring.saving') : t('tasks.save')}
        </button>
        <button
          className="account-name-cancel"
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          {t('boards.cancel')}
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
    <span className="account-name-wrap">
      <button
        className="account-name-badge"
        type="button"
        onClick={startEditing}
        title={t('account.changeName')}
      >
        {name ?? username}
      </button>
      <button
        className="account-logout"
        type="button"
        onClick={() => {
          void logout().finally(() => navigate('/login', { replace: true }));
        }}
        aria-label={t('auth.logout')}
        title={t('auth.logout')}
      >
        ↪
      </button>
    </span>
  );
}

export default AccountName;
