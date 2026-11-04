import type { Dispatch, SetStateAction } from 'react';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import type { SavedReaction } from '../storage';
import type { useSavedDoc } from '../storage/useSavedDoc';

interface Options {
  rxn: Reaction;
  setRxn: Dispatch<SetStateAction<Reaction>>;
  doc: ReturnType<typeof useSavedDoc>;
  remote: boolean;
  notify: (msg: string) => void;
}

/** Save; "save as" asks for a new name and keeps the original. */
export function useSaveReaction({ rxn, setRxn, doc, remote, notify }: Options) {
  const { t, lang } = useI18n();

  return async (asNew: boolean) => {
    // Without a code of its own, the reaction code is its title (see reactionCode).
    let r = rxn;
    if (asNew) {
      const name = prompt(t.saveAsPrompt, rxn.title ? `${rxn.title} ${t.copySuffix}` : '');
      if (name === null) return;
      r = { ...r, title: name.trim() };
      setRxn(r);
    }
    try {
      const res = await doc.save(r, {
        asNew,
        copyTitle: (title) => `${title || t.report.untitled} ${t.copySuffix}`,
        resolveConflict: (cur: SavedReaction) =>
          confirm(t.conflictAsk.replace('{time}', new Date(cur.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')))
            ? 'overwrite'
            : 'copy',
      });
      const name = res.saved?.title || '—';
      const msg = remote ? (asNew ? t.savedAsMsgRemote : t.savedMsgRemote) : asNew ? t.savedAsMsg : t.savedMsg;
      if (res.outcome === 'updated') notify((remote ? t.savedMsgRemote : t.savedMsg).replace('{name}', name));
      else if (res.outcome === 'created') notify(msg.replace('{name}', name));
      else if (res.outcome === 'copied') notify(t.savedCopyMsg.replace('{name}', name));
    } catch {
      notify(t.saveFailed);
    }
  };
}
