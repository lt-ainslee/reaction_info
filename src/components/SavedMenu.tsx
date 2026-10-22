import { useRef, useState } from 'react';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { reactionFromFile, repo, type SavedSummary } from '../storage';

interface Props {
  currentId?: string;
  /** Resolves to true when the reaction was opened. */
  onOpen: (id: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
  onOpenFile: (r: Reaction) => void;
}

export function SavedMenu({ currentId, onOpen, onDeleted, onOpenFile }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [fileError, setFileError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setError(false);
    repo.list().then(setList, () => setError(true));
  };

  const toggle = () => {
    if (!open) {
      setList(null);
      refresh();
    }
    setOpen(!open);
  };

  return (
    <div className="saved">
      <button className="ghost" onClick={toggle} aria-expanded={open}>{t.saved} ▾</button>
      {open && (
        <div className="saved-list">
          <p className="hint saved-where">{repo.kind === 'local' ? t.savedWhere : t.savedWhereRemote}</p>
          {error && <p className="warn small">{t.loadFailed}</p>}
          {!error && list === null && <p className="muted small">{t.loading}</p>}
          {list?.length === 0 && <p className="muted">{t.noSaved}</p>}
          {list?.map((s) => (
            <div key={s.id} className={'saved-item' + (s.id === currentId ? ' current' : '')}>
              <button
                className="link"
                onClick={async () => {
                  if (await onOpen(s.id)) setOpen(false);
                  else refresh();
                }}
              >
                <strong>
                  {s.title || '—'}
                  {s.id === currentId && <em className="muted"> · {t.editing}</em>}
                </strong>
                <small>
                  {new Date(s.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')}
                  {s.owner && ` · ${s.owner}`}
                </small>
              </button>
              <button
                className="icon"
                aria-label={t.delete}
                title={t.delete}
                onClick={async () => {
                  if (!confirm(t.confirmDelete)) return;
                  try {
                    await repo.remove(s.id);
                    onDeleted(s.id);
                    refresh();
                  } catch {
                    setError(true);
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="saved-footer">
            <button className="ghost small" onClick={() => fileRef.current?.click()}>📂 {t.openFromFile}</button>
            {fileError && <span className="warn small">{t.badFile}</span>}
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const r = reactionFromFile(await f.text());
                setFileError(!r);
                if (r) {
                  onOpenFile(r);
                  setOpen(false);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
