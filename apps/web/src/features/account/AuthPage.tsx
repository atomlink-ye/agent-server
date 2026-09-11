import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login, register } from './account-gateway';
import { useT } from '../../i18n';

export default function AuthPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      const next = new URLSearchParams(location.search).get('next');
      navigate(next?.startsWith('/') ? next : '/', { replace: true });
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mark" aria-hidden="true">
          ✦
        </div>
        <h1>
          {mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}
        </h1>
        <p>{t('auth.subtitle')}</p>
        <label>
          {t('auth.username')}
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          {t('auth.password')}
          <input
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <div role="alert" className="auth-error">
            {error}
          </div>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy
            ? t('auth.working')
            : mode === 'login'
              ? t('auth.login')
              : t('auth.register')}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? t('auth.switchRegister') : t('auth.switchLogin')}
        </button>
      </form>
    </main>
  );
}
