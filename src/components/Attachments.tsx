// "Characterization & spectra" card: upload Bruker experiment folders and any
// other files (MNova, PDF, images…), list / preview / link them to compounds,
// and write the SI characterization text for each product.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteAttachment, fileUrl, formatSize, kindFromName, listAttachments, MIME, previewUrl, updateAttachment, uploadAttachment, uploadPreview,
  type Attachment,
} from '../attachments/api';
import { findExperiments, siPrefix, type NmrMeta, type PickedFile } from '../attachments/bruker';
import { thumbnailPng } from '../attachments/plot';
import { brukerFromZip } from '../attachments/spectrumFromZip';
import { zipFiles } from '../attachments/zip';
import { updateComponent, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { AttachmentViewer } from './AttachmentViewer';
import { NmrMetaLine } from './NmrMetaLine';

interface Props {
  rxn: Reaction;
  setRxn: (r: Reaction) => void;
  /** Saved reaction on the server; attachments need one. */
  reactionId?: string;
  remote: boolean;
  onSave: () => void;
  onNotify: (msg: string) => void;
}

interface Upload {
  name: string;
  progress: number;
  error?: string;
}

const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

/** Files from <input webkitdirectory> or a plain multi-file input. */
const fromInput = (list: FileList): PickedFile[] =>
  [...list].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })).filter((f) => !IGNORED.test(f.path));

/** Files (recursively) from a drag-and-drop, folders included. */
async function fromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const readAll = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = dir.createReader();
      const acc: FileSystemEntry[] = [];
      const next = () => reader.readEntries((batch) => (batch.length ? (acc.push(...batch), next()) : resolve(acc)), reject);
      next();
    });
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of dt.files) out.push({ path: f.name, file: f });
  return out.filter((f) => !IGNORED.test(f.path));
}

export function Attachments({ rxn, setRxn, reactionId, remote, onSave, onNotify }: Props) {
  const { t, lang } = useI18n();
  const [list, setList] = useState<Attachment[] | null>(null);
  const [error, setError] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const products = rxn.components.filter((c) => c.role === 'product');
  const defaultCompound = products.length === 1 ? products[0].id : undefined;

  const refresh = useCallback(() => {
    if (!reactionId || !remote) return;
    setError(false);
    listAttachments(reactionId).then(setList, () => setError(true));
  }, [reactionId, remote]);

  useEffect(() => {
    setList(null);
    refresh();
  }, [refresh]);

  const track = (name: string) => {
    setUploads((u) => [...u, { name, progress: 0 }]);
    return {
      progress: (p: number) => setUploads((u) => u.map((x) => (x.name === name ? { ...x, progress: p } : x))),
      fail: (msg: string) => setUploads((u) => u.map((x) => (x.name === name ? { ...x, error: msg } : x))),
      done: () => setUploads((u) => u.filter((x) => x.name !== name)),
    };
  };

  const upload = async (picked: PickedFile[]) => {
    if (!reactionId || !picked.length) return;
    const experiments = findExperiments(picked);
    const inExperiment = new Set(experiments.flatMap((e) => e.files));
    let count = 0;

    for (const ex of experiments) {
      const parts = ex.root.split('/').filter(Boolean);
      // Keep "<sample>/<expno>/…" inside the zip, the layout TopSpin and MNova expect.
      const strip = parts.length > 2 ? parts.slice(0, -2).join('/') + '/' : '';
      const base = [ex.sample, ex.expno].filter(Boolean).join('_') || 'nmr';
      const tr = track(base);
      try {
        const zip = await zipFiles(ex.files, strip);
        let meta: NmrMeta | undefined;
        let spectrum;
        try {
          ({ meta, spectrum } = brukerFromZip(zip));
        } catch {
          /* keep the upload even if parameters can't be read */
        }
        const nuc = meta?.nucleus?.replace('/', '-');
        const att = await uploadAttachment(
          reactionId,
          new Blob([zip as BlobPart], { type: 'application/zip' }),
          { filename: `${base}${nuc ? `_${nuc}` : ''}.zip`, kind: 'nmr', compoundId: defaultCompound, meta: meta ? { ...meta } : {} },
          tr.progress,
        );
        if (spectrum) await uploadPreview(att.id, await thumbnailPng(spectrum)).catch(() => undefined);
        tr.done();
        count++;
      } catch (e) {
        tr.fail(String((e as Error).message ?? e));
      }
    }

    for (const f of picked.filter((p) => !inExperiment.has(p))) {
      const name = f.path.split('/').pop()!;
      const tr = track(name);
      try {
        const ext = name.toLowerCase().split('.').pop() ?? '';
        const blob = f.file.type ? f.file : new Blob([f.file], { type: MIME[ext] ?? 'application/octet-stream' });
        await uploadAttachment(reactionId, blob, { filename: name, kind: kindFromName(name), compoundId: defaultCompound }, tr.progress);
        tr.done();
        count++;
      } catch (e) {
        tr.fail(String((e as Error).message ?? e));
      }
    }
    if (count) onNotify(t.att.uploaded.replace('{n}', String(count)));
    refresh();
  };

  const patch = async (a: Attachment, p: Parameters<typeof updateAttachment>[1]) => {
    try {
      const next = await updateAttachment(a.id, p);
      setList((l) => l?.map((x) => (x.id === a.id ? next : x)) ?? null);
    } catch {
      setError(true);
    }
  };

  const remove = async (a: Attachment) => {
    if (!confirm(t.att.confirmDelete.replace('{name}', a.filename))) return;
    try {
      await deleteAttachment(a.id);
      setList((l) => l?.filter((x) => x.id !== a.id) ?? null);
    } catch {
      setError(true);
    }
  };

  const insertPrefix = (productId: string, prefix: string) => {
    const c = rxn.components.find((x) => x.id === productId)!;
    const cur = c.characterization ?? '';
    const sep = cur && !cur.endsWith('\n') ? '\n' : '';
    setRxn(updateComponent(rxn, productId, { characterization: cur + sep + prefix }));
  };

  const nmrFor = (productId: string) =>
    (list ?? []).filter((a) => a.kind === 'nmr' && (a.compoundId === productId || !a.compoundId)).map((a) => siPrefix(a.meta as unknown as NmrMeta)).filter((x): x is string => !!x);

  const canUpload = remote && !!reactionId;

  return (
    <section
      className={'card attachments' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={async (e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(false);
        upload(await fromDrop(e.dataTransfer));
      }}
    >
      <div className="card-head">
        <h2>{t.att.title}</h2>
        {canUpload && (
          <div className="toolbar no-print">
            <button onClick={() => folderRef.current?.click()}>{t.att.uploadFolder}</button>
            <button className="ghost" onClick={() => filesRef.current?.click()}>{t.att.uploadFiles}</button>
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              // @ts-expect-error non-standard but supported by all current browsers
              webkitdirectory=""
              onChange={(e) => {
                if (e.target.files) upload(fromInput(e.target.files));
                e.target.value = '';
              }}
            />
            <input
              ref={filesRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                if (e.target.files) upload(fromInput(e.target.files));
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {!remote && <p className="muted small">{t.att.needServer}</p>}
      {remote && !reactionId && (
        <p className="muted small">
          {t.att.needSaved} <button className="link" onClick={onSave}>{t.save}</button>
        </p>
      )}
      {canUpload && <p className="hint att-hint">{t.att.hint}</p>}
      {error && <p className="warn small">{t.loadFailed}</p>}

      {uploads.length > 0 && (
        <ul className="att-uploads">
          {uploads.map((u) => (
            <li key={u.name}>
              <span>{u.name}</span>
              {u.error ? (
                <span className="warn small">{t.att.uploadFailed}: {u.error}</span>
              ) : (
                <progress max={1} value={u.progress} />
              )}
            </li>
          ))}
        </ul>
      )}

      {list && list.length > 0 && (
        <div className="att-list">
          {list.map((a) => (
            <div key={a.id} className="att-item">
              <button className="att-thumb" onClick={() => setViewing(a)} title={t.att.view}>
                {a.hasPreview ? (
                  <img src={previewUrl(a.id)} alt="" loading="lazy" />
                ) : a.kind === 'image' ? (
                  <img src={fileUrl(a.id)} alt="" loading="lazy" />
                ) : (
                  <span className={'att-icon k-' + a.kind}>{t.att.kinds[a.kind]}</span>
                )}
              </button>
              <div className="att-main">
                <button className="link att-name" onClick={() => setViewing(a)}>{a.filename}</button>
                <div className="att-meta">
                  <span className={'att-kind k-' + a.kind}>{t.att.kinds[a.kind]}</span>
                  {a.kind === 'nmr' && <NmrMetaLine att={a} />}
                  {typeof a.meta.title === 'string' && <span className="muted">“{a.meta.title}”</span>}
                  <span className="muted">
                    {formatSize(a.size)} · {new Date(a.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en')}
                  </span>
                </div>
                <div className="att-edit">
                  <select value={a.compoundId ?? ''} onChange={(e) => patch(a, { compoundId: e.target.value || null })} aria-label={t.att.compound}>
                    <option value="">{t.att.noCompound}</option>
                    {rxn.components.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    className="grow"
                    defaultValue={a.note}
                    placeholder={t.att.notePh}
                    onBlur={(e) => e.target.value !== a.note && patch(a, { note: e.target.value })}
                  />
                </div>
              </div>
              <div className="att-actions">
                <a className="button-like ghost small" href={fileUrl(a.id, true)} download>{t.att.download}</a>
                <button className="icon" onClick={() => remove(a)} aria-label={t.delete} title={t.delete}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list && list.length === 0 && canUpload && <div className="att-empty">{t.att.empty}</div>}

      {products.length > 0 && (
        <div className="charac">
          <h3>{t.att.characterization}</h3>
          {products.map((p) => (
            <label key={p.id} className="field">
              <span>{p.name}</span>
              <textarea
                rows={3}
                value={p.characterization ?? ''}
                placeholder={t.att.characterizationPh}
                onChange={(e) => setRxn(updateComponent(rxn, p.id, { characterization: e.target.value }))}
              />
              {nmrFor(p.id).length > 0 && (
                <span className="charac-chips no-print">
                  {[...new Set(nmrFor(p.id))].map((prefix) => (
                    <button key={prefix} className="ghost small" onClick={() => insertPrefix(p.id, prefix)}>
                      + {prefix.trim()}
                    </button>
                  ))}
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {viewing && <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
