import { useState } from 'react';
import { useI18n } from '../i18n';
import { deleteSaved, listSaved, type SavedReaction } from '../storage';

export function SavedMenu({ onLoad }: { onLoad: (s: SavedReaction) => void }) {
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
            <div key={s.id} className="saved-item">
              <button
                className="link"
                onClick={() => {
                  onLoad(s);
                  setOpen(false);
                }}
              >
                <strong>{s.reaction.title || '—'}</strong>
                <small>{new Date(s.savedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')}</small>
              </button>
              <button
                className="icon"
                aria-label={t.delete}
                title={t.delete}
                onClick={() => confirm(t.confirmDelete) && setList(deleteSaved(s.id))}
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
