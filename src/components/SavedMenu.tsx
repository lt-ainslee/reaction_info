import { useState } from 'react';
import { useI18n } from '../i18n';
import { deleteSaved, listSaved, type SavedReaction } from '../storage';

interface Props {
  currentId?: string;
  onLoad: (s: SavedReaction) => void;
  onDeleted: (id: string) => void;
}

export function SavedMenu({ currentId, onLoad, onDeleted }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedReaction[]>([]);

  const toggle = () => {
    if (!open) setList(listSaved());
    setOpen(!open);
  };

  return (
    <div className="saved">
      <button className="ghost" onClick={toggle} aria-expanded={open}>{t.saved} ▾</button>
      {open && (
        <div className="saved-list">
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
        </div>
      )}
    </div>
  );
}
