import { useRef, useState } from 'react';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { pendingLocalUploads, reactionFromFile, repo, uploadLocalReactions, type SavedSummary } from '../storage';
import { saveBlob } from '../export';
import { exportAll, restore } from '../storage/backup';

interface Props {
  currentId?: string;
  /** Resolves to true when the reaction was opened. */
  onOpen: (id: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
  onOpenFile: (r: Reaction) => void;
  onNotify: (msg: string) => void;
}

export function SavedMenu({ currentId, onOpen, onDeleted, onOpenFile, onNotify }: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [fileError, setFileError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const doExport = async () => {
    try {
      const { blob, reactions, lots, abbrs } = await exportAll((a, b) => setBackupMsg(t.backup.exporting.replace('{a}', String(a)).replace('{b}', String(b))));
      saveBlob(blob, `reaction-info-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setBackupMsg(null);
      onNotify(t.backup.exported.replace('{n}', String(reactions)).replace('{m}', String(lots)).replace('{k}', String(abbrs)));
    } catch {
      setBackupMsg(t.loadFailed);
    }
  };

  const [pendingUpload, setPendingUpload] = useState(0);
  const [uploading, setUploading] = useState(false);

  const refresh = () => {
    setError(false);
    repo.list().then(setList, () => setError(true));
    if (repo.kind === 'remote') pendingLocalUploads().then((ids) => setPendingUpload(ids.length), () => setPendingUpload(0));
  };

  const upload = async () => {
    setUploading(true);
    try {
      const { uploaded, existing } = await uploadLocalReactions();
      onNotify(t.uploadDone.replace('{n}', String(uploaded + existing)));
      refresh();
    } catch {
      setError(true);
    } finally {
      setUploading(false);
    }
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
          {pendingUpload > 0 && (
            <div className="upload-offer">
              <span>{t.uploadOffer.replace('{n}', String(pendingUpload))}</span>
              <button className="small" onClick={upload} disabled={uploading}>{uploading ? t.uploading : t.uploadBtn}</button>
            </div>
          )}
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
                  {s.meta?.code && <span className="saved-code">{s.meta.code}</span>}
                  {s.title || '—'}
                  {s.id === currentId && <em className="muted"> · {t.editing}</em>}
                </strong>
                <small>
                  {s.meta && s.meta.runs > 1 && <>{t.runs.count.replace('{n}', String(s.meta.runs))} · </>}
                  {s.meta?.bestYield !== undefined && <>{t.runs.best.replace('{y}', String(s.meta.bestYield))} · </>}
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
            <button className="ghost small" onClick={doExport}>{t.backup.exportAll}</button>
            <button className="ghost small" onClick={() => backupRef.current?.click()}>{t.backup.restore}</button>
            {backupMsg && <span className="muted small">{backupMsg}</span>}
            <input
              ref={backupRef}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const res = await restore(await f.text());
                  if (!res) return setBackupMsg(t.backup.invalid);
                  setBackupMsg(null);
                  onNotify(t.backup.restored.replace('{n}', String(res.reactions)).replace('{m}', String(res.lots)).replace('{k}', String(res.abbrs)));
                  refresh();
                } catch {
                  setBackupMsg(t.loadFailed);
                }
              }}
            />
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
