import { useRef, useState } from 'react';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { deleteSaved, listSaved, reactionFromFile, type SavedReaction } from '../storage';

interface Props {
  currentId?: string;
  onLoad: (s: SavedReaction) => void;
  onDeleted: (id: string) => void;
  onOpenFile: (r: Reaction) => void;
}

export function SavedMenu({ currentId, onLoad, onDeleted, onOpenFile }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedReaction[]>([]);
  const [fileError, setFileError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    if (!open) setList(listSaved());
    setOpen(!open);
  };

  return (
    <div className="saved">
      <button className="ghost" onClick={toggle} aria-expanded={open}>{t.saved} ▾</button>
      {open && (
        <div className="saved-list">
          <p className="hint saved-where">{t.savedWhere}</p>
          {list.length === 0 && <p className="muted">{t.noSaved}</p>}
          {list.map((s) => (
            <div key={s.id} className={'saved-item' + (s.id === currentId ? ' current' : '')}>
              <button
                className="link"
                onClick={() => {
                  onLoad(s);
                  setOpen(false);
                }}
              >
                <strong>
                  {s.reaction.title || '—'}
                  {s.id === currentId && <em className="muted"> · {t.editing}</em>}
                </strong>
                <small>{new Date(s.savedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')}</small>
              </button>
              <button
                className="icon"
                aria-label={t.delete}
                title={t.delete}
                onClick={() => {
                  if (!confirm(t.confirmDelete)) return;
                  setList(deleteSaved(s.id));
                  onDeleted(s.id);
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
