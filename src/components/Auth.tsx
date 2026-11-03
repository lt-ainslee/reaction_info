// Sign-in: with the server, nothing is shown until someone is signed in (the
// first account of a new site is created here and becomes the admin). When a
// session ends while working, a sign-in window opens over the page so the
// open reaction is kept. Without the server (local storage) there are no
// accounts and the app opens directly.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { repoReady } from '../storage';
import { currentAccount, fetchMe, setUp, signIn, signUp, type Account, type SignedOut } from '../storage/auth';
import { AUTH_REQUIRED, HttpError } from '../storage/http';

type State = { kind: 'loading' } | { kind: 'open' } | { kind: 'signedOut'; info: SignedOut } | { kind: 'error' };

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** Signed in before, and the session ended while working. */
  const [expired, setExpired] = useState<{ prev: string | null; info: SignedOut } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if ((await repoReady) === 'local') return setState({ kind: 'open' });
      const me = await fetchMe();
      if (cancelled) return;
      setState('user' in me ? { kind: 'open' } : { kind: 'signedOut', info: me });
    })().catch(() => !cancelled && setState({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onAuth = async () => {
      // Who was signed in, to reload if someone else signs in.
      const prev = currentAccount()?.id ?? null;
      const me = await fetchMe().catch(() => null);
      if (!me || 'user' in me) return;
      setExpired((e) => e ?? { prev, info: me });
    };
    window.addEventListener(AUTH_REQUIRED, onAuth);
    return () => window.removeEventListener(AUTH_REQUIRED, onAuth);
  }, []);

  if (state.kind === 'loading') return <div className="auth-page"><p className="muted">{t.loading}</p></div>;
  if (state.kind === 'error') return <div className="auth-page"><p className="warn">{t.loadFailed}</p></div>;
  if (state.kind === 'signedOut') {
    return (
      <div className="auth-page">
        <SignInForm info={state.info} onDone={() => setState({ kind: 'open' })} />
      </div>
    );
  }
  return (
    <>
      {children}
      {expired && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <SignInForm
            info={expired.info}
            notice={t.acct.sessionExpired}
            onDone={(user) => {
              // Someone else: nothing of the previous account may stay on the page.
              if (expired.prev && user.id !== expired.prev) location.reload();
              setExpired(null);
            }}
          />
        </div>
      )}
    </>
  );
}

function SignInForm({ info, notice, onDone }: { info: SignedOut; notice?: string; onDone: (user: Account) => void }) {
  const { t, lang, setLang } = useI18n();
  const A = t.acct;
  const [mode, setMode] = useState<'in' | 'up' | 'setup'>(info.needsSetup ? 'setup' : 'in');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const creating = mode !== 'in';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (creating && password !== password2) return setErr(A.errors.mismatch);
    setBusy(true);
    try {
      const user =
        mode === 'in' ? await signIn(username, password) : mode === 'up' ? await signUp(username, password, name) : await setUp(username, password, name);
      onDone(user);
    } catch (x) {
      setErr((x instanceof HttpError && A.errors[x.message]) || A.errors.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-brand">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M12 6h8M14 6v7l-6 11a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <strong>{t.appTitle}</strong>
          <div className="muted small">{mode === 'setup' ? A.setup : mode === 'up' ? A.signUp : A.signIn}</div>
        </div>
        <span className="grow" />
        <div className="lang" role="group" aria-label="Language">
          <button type="button" className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </div>
      </div>
      {notice && <p className="auth-notice">{notice}</p>}
      <p className="hint">{mode === 'setup' ? A.setupHint : A.welcome}</p>
      <label className="field">
        <span>{A.username}</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
        {creating && <small className="hint">{A.usernameHint}</small>}
      </label>
      {creating && (
        <label className="field">
          <span>{A.name}</span>
          <input value={name} placeholder={A.namePh} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>{A.password}</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} required />
      </label>
      {creating && (
        <label className="field">
          <span>{A.password2}</span>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
        </label>
      )}
      {err && <p className="warn small" role="alert">{err}</p>}
      <button type="submit" disabled={busy || !username || !password}>{mode === 'setup' ? A.setup : mode === 'up' ? A.signUp : A.signIn}</button>
      {mode !== 'setup' && (
        <div className="auth-switch">
          {mode === 'in' && info.signup === 'closed' ? (
            <span className="muted small">{A.signupClosed}</span>
          ) : (
            <button type="button" className="link small" onClick={() => { setErr(null); setMode(mode === 'in' ? 'up' : 'in'); }}>
              {mode === 'in' ? A.toSignUp : A.toSignIn}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
