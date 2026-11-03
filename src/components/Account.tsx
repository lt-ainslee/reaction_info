// The account menu in the top bar, the account settings (name, password,
// default sharing of new records) and, for admins, the list of accounts.
// Also the small sharing widgets used by reactions, lots and abbreviations.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { VISIBILITIES, type Access, type Visibility } from '../storage/access';
import {
  changePassword, createAccount, listAccounts, patchAccount, setSignup, signOut, updateProfile, useAccount, type Account, type AccountRow,
} from '../storage/auth';
import { HttpError } from '../storage/http';

/** Choose who sees a record. */
export function VisibilitySelect({ value, onChange, disabled, compact }: { value: Visibility; onChange: (v: Visibility) => void; disabled?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <select
      className={'vis-select vis-' + value + (compact ? ' compact' : '')}
      value={value}
      disabled={disabled}
      title={t.vis.tips[value]}
      aria-label={t.vis.label}
      onChange={(e) => onChange(e.target.value as Visibility)}
    >
      {VISIBILITIES.map((v) => (
        <option key={v} value={v} title={t.vis.tips[v]}>{t.vis[v]}</option>
      ))}
    </select>
  );
}

/** Who owns a record and who sees it, as a small label. */
export function AccessBadge({ access }: { access?: Access }) {
  const { t } = useI18n();
  if (!access) return null;
  const who = access.mine ? t.vis.mine : access.ownerName ?? t.vis.group;
  return (
    <span className={'vis-badge vis-' + access.visibility} title={`${t.vis.tips[access.visibility]}${access.ownerName ? ' · ' + t.vis.owner.replace('{name}', access.ownerName) : ''}`}>
      {access.mine ? t.vis[access.visibility] : `${who} · ${t.vis[access.visibility]}`}
    </span>
  );
}

const errText = (t: ReturnType<typeof useI18n>['t'], e: unknown) => (e instanceof HttpError && t.acct.errors[e.message]) || t.acct.errors.failed;

export function AccountMenu({ onNotify }: { onNotify: (msg: string) => void }) {
  const { t } = useI18n();
  const me = useAccount();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'account' | 'admin' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!me) return null;
  return (
    <div className="saved acct" ref={ref}>
      <button className="ghost acct-btn" onClick={() => setOpen(!open)} aria-expanded={open} title={me.username}>
        <span className="acct-avatar" aria-hidden>{(me.name || me.username).slice(0, 1).toUpperCase()}</span>
        <span className="acct-name">{me.name}</span> ▾
      </button>
      {open && (
        <div className="saved-list acct-list">
          <p className="hint saved-where">
            {me.username} · {t.acct.roles[me.role]}
          </p>
          <button className="ghost small" onClick={() => { setDialog('account'); setOpen(false); }}>{t.acct.account}</button>
          {me.role === 'admin' && <button className="ghost small" onClick={() => { setDialog('admin'); setOpen(false); }}>{t.acct.admin}</button>}
          <button className="ghost small" onClick={() => void signOut()}>{t.acct.signOut}</button>
        </div>
      )}
      {dialog === 'account' && <AccountDialog me={me} onClose={() => setDialog(null)} onNotify={onNotify} />}
      {dialog === 'admin' && <AdminDialog me={me} onClose={() => setDialog(null)} onNotify={onNotify} />}
    </div>
  );
}

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  // On <body>: the top bar this is opened from would confine a fixed backdrop.
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal acct-modal' + (wide ? ' wide' : '')}>
        <header>
          <h3>{title}</h3>
          <span className="grow" />
          <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <div className="acct-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function AccountDialog({ me, onClose, onNotify }: { me: Account; onClose: () => void; onNotify: (msg: string) => void }) {
  const { t } = useI18n();
  const A = t.acct;
  const [name, setName] = useState(me.name);
  const [prefs, setPrefs] = useState(me.prefs);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  const saveProfile = async () => {
    setErr(null);
    try {
      await updateProfile({ name, prefs });
      onNotify(A.saved);
    } catch (e) {
      setErr(errText(t, e));
    }
  };
  const savePassword = async () => {
    setPwErr(null);
    if (pw !== pw2) return setPwErr(A.errors.mismatch);
    try {
      await changePassword(cur, pw);
      setCur('');
      setPw('');
      setPw2('');
      onNotify(A.passwordChanged);
    } catch (e) {
      setPwErr(errText(t, e));
    }
  };

  return (
    <Dialog title={A.account} onClose={onClose}>
      <section>
        <h4>{A.profile}</h4>
        <label className="field">
          <span>{A.username}</span>
          <input value={me.username} disabled />
        </label>
        <label className="field">
          <span>{A.name}</span>
          <input value={name} placeholder={A.namePh} onChange={(e) => setName(e.target.value)} />
        </label>
        <h4>{A.defaults}</h4>
        <p className="hint">{A.defaultsHint}</p>
        <div className="acct-prefs">
          {(['reactions', 'lots', 'abbrs'] as const).map((k) => (
            <label key={k} className="field">
              <span>{A[k]}</span>
              <VisibilitySelect value={prefs[k]} onChange={(v) => setPrefs({ ...prefs, [k]: v })} />
            </label>
          ))}
        </div>
        {err && <p className="warn small">{err}</p>}
        <button className="small" onClick={saveProfile}>{A.save}</button>
      </section>
      <section>
        <h4>{A.changePassword}</h4>
        <label className="field">
          <span>{A.currentPassword}</span>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>{A.newPassword}</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>{A.password2}</span>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </label>
        {pwErr && <p className="warn small">{pwErr}</p>}
        <button className="small" disabled={!cur || !pw} onClick={savePassword}>{A.changePassword}</button>
      </section>
    </Dialog>
  );
}

function AdminDialog({ me, onClose, onNotify }: { me: Account; onClose: () => void; onNotify: (msg: string) => void }) {
  const { t, lang } = useI18n();
  const A = t.acct;
  const [data, setData] = useState<{ users: AccountRow[]; signup: 'open' | 'closed' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nu, setNu] = useState({ username: '', name: '', password: '', role: 'member' as 'admin' | 'member' });

  const load = () => listAccounts().then(setData, (e) => setErr(errText(t, e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  const act = async (f: () => Promise<unknown>, done?: string) => {
    setErr(null);
    try {
      await f();
      if (done) onNotify(done);
      await load();
    } catch (e) {
      setErr(errText(t, e));
    }
  };
  const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en') : A.never);

  return (
    <Dialog title={A.admin} onClose={onClose} wide>
      {err && <p className="warn small">{err}</p>}
      {!data && !err && <p className="muted small">{t.loading}</p>}
      {data && (
        <>
          <label className="acct-check">
            <input type="checkbox" checked={data.signup === 'open'} onChange={(e) => act(() => setSignup(e.target.checked ? 'open' : 'closed'))} />
            {A.signupOpen}
          </label>
          <table className="acct-table">
            <thead>
              <tr>
                <th>{A.username}</th>
                <th>{A.name}</th>
                <th />
                <th>{A.lastLogin}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className={u.disabled ? 'acct-off' : ''}>
                  <td>
                    {u.username}
                    {u.id === me.id && <span className="muted"> ({A.you})</span>}
                  </td>
                  <td>{u.name}</td>
                  <td className="muted small">
                    {A.roles[u.role]}
                    {u.disabled && ` · ${A.disabled}`} · {A.nReactions.replace('{n}', String(u.reactions))}
                  </td>
                  <td className="muted small">{when(u.lastLogin)}</td>
                  <td className="acct-actions">
                    <button className="ghost small" onClick={() => act(() => patchAccount(u.id, { role: u.role === 'admin' ? 'member' : 'admin' }))}>
                      {u.role === 'admin' ? A.makeMember : A.makeAdmin}
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        const pw = prompt(A.resetPrompt.replace('{name}', u.name || u.username));
                        if (pw) void act(() => patchAccount(u.id, { password: pw }), A.resetDone.replace('{name}', u.name || u.username));
                      }}
                    >
                      {A.resetPassword}
                    </button>
                    {u.id !== me.id && (
                      <button className="ghost small" onClick={() => act(() => patchAccount(u.id, { disabled: !u.disabled }))}>
                        {u.disabled ? A.enable : A.disable}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!adding ? (
            <button className="small" onClick={() => setAdding(true)}>{A.addUser}</button>
          ) : (
            <div className="acct-add">
              <input placeholder={A.username} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} autoCapitalize="none" />
              <input placeholder={A.name} value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
              <input placeholder={A.password} type="text" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
              <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as 'admin' | 'member' })}>
                <option value="member">{A.roles.member}</option>
                <option value="admin">{A.roles.admin}</option>
              </select>
              <button
                className="small"
                disabled={!nu.username || !nu.password}
                onClick={() =>
                  act(async () => {
                    await createAccount(nu);
                    setNu({ username: '', name: '', password: '', role: 'member' });
                    setAdding(false);
                  })
                }
              >
                {t.add}
              </button>
              <p className="hint">{A.usernameHint}</p>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
