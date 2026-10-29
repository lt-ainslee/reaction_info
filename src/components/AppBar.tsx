// Top bar: storage location, saved reactions, inventory, abbreviations, new reaction, language.
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import type { useSavedDoc } from '../storage/useSavedDoc';
import { SavedMenu } from './SavedMenu';

interface Props {
  storage: 'local' | 'remote' | null;
  doc: ReturnType<typeof useSavedDoc>;
  /** Ask before replacing unsaved changes; true to go on. */
  confirmDiscard: (what: string) => boolean;
  /** A different reaction is now open (close the side panel). */
  onSwitched: () => void;
  onNotify: (msg: string) => void;
  onOpenInventory: () => void;
  onOpenAbbrs: () => void;
  newReaction: () => Reaction;
}

export function AppBar({ storage, doc, confirmDiscard, onSwitched, onNotify, onOpenInventory, onOpenAbbrs, newReaction }: Props) {
  const { t, lang, setLang } = useI18n();
  const remote = storage === 'remote';
  const savedId = doc.openId;
  return (
    <header className="appbar no-print">
      <div className="appbar-inner">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M12 6h8M14 6v7l-6 11a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="brand-name">{t.appTitle}</span>
          <span className="brand-sub">{t.appSubtitle}</span>
        </div>
        <div className="top-actions">
          {storage && (
            <span className={'storage-chip ' + storage} title={remote ? t.storageTipRemote : t.storageTipLocal}>
              {remote ? t.storageRemote : t.storageLocal}
            </span>
          )}
          <SavedMenu
            onNotify={onNotify}
            currentId={savedId}
            onOpen={async (id) => {
              if (id !== savedId && !confirmDiscard(t.load)) return false;
              try {
                const ok = await doc.open(id);
                if (!ok) onNotify(t.notFound);
                onSwitched();
                return ok;
              } catch {
                onNotify(t.loadFailed);
                return false;
              }
            }}
            onOpenFile={(r) => {
              if (!confirmDiscard(t.openFromFile)) return;
              doc.detach(r);
              onSwitched();
              onNotify(t.openedFile.replace('{name}', r.title || '—'));
            }}
            onDeleted={doc.removed}
          />
          <button className="ghost" onClick={onOpenInventory}>{t.inv.open}</button>
          <button className="ghost" onClick={onOpenAbbrs}>{t.abbr.title}</button>
          <button
            className="ghost"
            onClick={() => {
              if (!confirmDiscard(t.newReaction)) return;
              doc.detach(newReaction());
              onSwitched();
            }}
          >
            {t.newReaction}
          </button>
          <div className="lang" role="group" aria-label="Language">
            <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
      </div>
    </header>
  );
}
