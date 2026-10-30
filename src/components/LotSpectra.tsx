// Identity spectra of one bottle, edited from the inventory: upload Bruker
// folders / MNova / PDF / images onto the lot ("lot:<id>"), view, download
// and delete them. The same files show up in the "Characterization &
// spectra" card of every reaction that uses the lot.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { deleteAttachment, fileUrl, formatSize, getGraph, previewUrl, type Attachment, type Graph } from '../attachments/api';
import type { PickedFile } from '../attachments/bruker';
import { displayName, indexGraph, nodeTypeOf, treeRows } from '../attachments/graph';
import { fromDrop, fromInput } from '../attachments/picked';
import type { Progress } from '../attachments/uploader';
import { lotOwner, type Verification } from '../chem/lots';
import { useI18n } from '../i18n';
import { refreshInventory } from '../storage/inventory';
import { NmrMetaLine } from './NmrMetaLine';

const AttachmentViewer = lazy(() => import('./AttachmentViewer').then((m) => ({ default: m.AttachmentViewer })));

interface Props {
  lotId: string;
  /** Attachments need the server. */
  remote: boolean;
  /** The lot is already in the library (attachments need it to exist). */
  saved: boolean;
  /** Save the lot first (a new one); false when it can't be saved yet. */
  ensureSaved: () => Promise<boolean>;
  verification?: Verification;
  /** Scroll into view when opened (from the table's identity column). */
  focus?: boolean;
  onNotify: (msg: string) => void;
}

interface Upload {
  name: string;
  progress: number;
  error?: string;
}

export function LotSpectra({ lotId, remote, saved, ensureSaved, verification, focus, onNotify }: Props) {
  const { t } = useI18n();
  const I = t.inv;
  const owner = lotOwner(lotId);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLElement>(null);

  const load = useCallback(
    () =>
      getGraph(owner).then(
        (g) => {
          setGraph(g);
          setError(false);
        },
        () => setError(true),
      ),
    [owner],
  );

  useEffect(() => {
    if (remote && saved) void load();
  }, [remote, saved, load]);

  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  const progress: Progress = {
    start: (name) => {
      setUploads((u) => [...u, { name, progress: 0 }]);
      return {
        progress: (p) => setUploads((u) => u.map((x) => (x.name === name ? { ...x, progress: p } : x))),
        fail: (msg) => setUploads((u) => u.map((x) => (x.name === name ? { ...x, error: msg } : x))),
        done: () => setUploads((u) => u.filter((x) => x.name !== name)),
      };
    },
  };

  const upload = async (picked: PickedFile[]) => {
    if (!picked.length || !(await ensureSaved())) return;
    try {
      const { uploadPicked } = await import('../attachments/uploader');
      const { count } = await uploadPicked(picked, { reactionId: owner, nodes: graph?.nodes ?? [], progress });
      if (count) onNotify(t.att.uploaded.replace('{n}', String(count)));
    } catch (e) {
      onNotify(`${t.att.uploadFailed}: ${String((e as Error).message ?? e)}`);
    }
    await load();
    // The table shows the number of files per bottle.
    void refreshInventory();
  };

  const remove = async (a: Attachment) => {
    if (!confirm(t.att.confirmDelete.replace('{name}', displayName(a)))) return;
    try {
      await deleteAttachment(a.id);
    } catch {
      setError(true);
    }
    await load();
    void refreshInventory();
  };

  const fileInput = (folder: boolean) => (
    <input
      ref={folder ? folderRef : filesRef}
      type="file"
      hidden
      multiple
      {...(folder ? { webkitdirectory: '' } : {})}
      onChange={(e) => {
        if (e.target.files) void upload(fromInput(e.target.files));
        e.target.value = '';
      }}
    />
  );

  const nodes = graph?.nodes ?? [];
  const rows = treeRows(indexGraph(nodes, graph?.links ?? []), nodes);
  const files = nodes.filter((n) => n.hasFile).length;

  return (
    <section
      ref={ref}
      className={'lot-spectra inv-wide' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (!remote || ![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={async (e) => {
        if (!remote || ![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(false);
        void upload(await fromDrop(e.dataTransfer));
      }}
    >
      <div className="lot-spectra-head">
        <h5>
          {t.lots.spectra}
          {files > 0 && <span className="muted"> · {t.lots.files.replace('{n}', String(files))}</span>}
        </h5>
        {remote && (
          <div className="row">
            <button className="ghost small" onClick={() => folderRef.current?.click()}>{t.att.uploadFolder}</button>
            <button className="ghost small" onClick={() => filesRef.current?.click()}>{t.att.uploadFiles}</button>
            {fileInput(true)}
            {fileInput(false)}
          </div>
        )}
      </div>

      {!remote ? (
        <p className="hint">{I.spectraNeedServer}</p>
      ) : (
        <>
          <p className="hint">{saved ? I.spectraHint : I.spectraSaveFirst}</p>
          {error && <p className="warn small">{t.loadFailed}</p>}
          {uploads.length > 0 && (
            <ul className="att-uploads">
              {uploads.map((u) => (
                <li key={u.name}>
                  <span>{u.name}</span>
                  {u.error ? <span className="warn small">{t.att.uploadFailed}: {u.error}</span> : <progress max={1} value={u.progress} />}
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 ? (
            <div className="att-tree">
              {rows.map(({ node: a, depth }) => {
                const type = nodeTypeOf(a);
                return (
                  <div key={a.id} className={'att-row t-' + type} style={{ paddingLeft: `${depth * 18 + 6}px` }}>
                    {depth > 0 && <span className="att-branch" aria-hidden>└</span>}
                    {a.hasPreview ? (
                      <img className="att-row-thumb" src={previewUrl(a.id)} alt="" loading="lazy" />
                    ) : (
                      <span className={'att-type-dot t-' + type} aria-hidden />
                    )}
                    <div className="att-row-main">
                      <div className="att-row-title">
                        <span className="att-row-type">{t.att.nodeTypes[type]}</span>
                        {a.hasFile ? (
                          <button className="link" onClick={() => setViewing(a)}>{displayName(a)}</button>
                        ) : (
                          <span>{displayName(a)}</span>
                        )}
                      </div>
                      <div className="att-row-sub muted small">
                        {a.kind === 'nmr' && <NmrMetaLine att={a} />}
                        {a.hasFile && <span>{formatSize(a.size)}</span>}
                        {a.note && <span>{a.note}</span>}
                      </div>
                    </div>
                    {a.hasFile && (
                      <a className="icon" href={fileUrl(a.id, true)} title={t.att.download} aria-label={t.att.download}>↓</a>
                    )}
                    <button className="icon" onClick={() => remove(a)} title={I.delete} aria-label={I.delete}>×</button>
                  </div>
                );
              })}
            </div>
          ) : (
            saved && graph && !uploads.length && <div className="att-empty">{I.spectraEmpty}</div>
          )}
          {files > 0 && (verification ?? 'unverified') === 'unverified' && <p className="hint">{I.spectraVerify}</p>}
        </>
      )}

      {viewing && (
        <Suspense fallback={null}>
          <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </section>
  );
}
