// "Characterization & spectra" card: a node graph (desktop) or indented list
// (mobile) of a reaction's attachments — product → sample → raw Bruker data →
// MNova / PDF / peak lists — plus the SI characterization text for each product.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createNode, deleteAttachment, formatSize, getGraph, linkNodes, previewUrl, savePositions, unlinkNodes, updateAttachment,
  type Attachment, type Link,
} from '../attachments/api';
import { siPrefix, prettyNucleus, type NmrMeta, type PickedFile } from '../attachments/bruker';
import { compoundOf, completeness, displayName, indexGraph, nodeTypeOf, relationFor, subtree, treeRows } from '../attachments/graph';
import { packNodes, saveBlob } from '../attachments/pack';
import { addPeakList, uploadPicked, type Progress } from '../attachments/uploader';
import { updateComponent, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { PRODUCT } from './attachmentGraphIds';
import { AttachmentViewer } from './AttachmentViewer';
import { NmrMetaLine } from './NmrMetaLine';
import { NodeInspector, nucleusLabel, type NodeActions } from './NodeInspector';

const AttachmentGraph = lazy(() => import('./AttachmentGraph'));

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

type View = 'graph' | 'list';
const VIEW_KEY = 'attachments-view';

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
  // Entries must be taken synchronously, before the drop event finishes.
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const files = [...dt.files];
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const f of files) out.push({ path: f.name, file: f });
  return out.filter((f) => !IGNORED.test(f.path));
}

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'graph' || v === 'list') return v;
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches ? 'graph' : 'list';
}

export function Attachments({ rxn, setRxn, reactionId, remote, onSave, onNotify }: Props) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<Attachment[] | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [error, setError] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setViewState] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tidyToken, setTidyToken] = useState(0);
  const [packing, setPacking] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const products = rxn.components.filter((c) => c.role === 'product');
  const defaultCompound = products.length === 1 ? products[0].id : undefined;

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const refresh = useCallback(async () => {
    if (!reactionId || !remote) return;
    setError(false);
    try {
      const g = await getGraph(reactionId);
      setNodes(g.nodes);
      setLinks(g.links);
    } catch {
      setError(true);
    }
  }, [reactionId, remote]);

  useEffect(() => {
    setNodes(null);
    setLinks([]);
    setSelectedId(null);
    refresh();
  }, [refresh]);

  const ix = useMemo(() => indexGraph(nodes ?? [], links), [nodes, links]);
  const selected = selectedId ? ix.byId.get(selectedId) : undefined;

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

  const upload = async (picked: PickedFile[], parentId?: string) => {
    if (!reactionId || !picked.length) return;
    try {
      const { count, autoLinked } = await uploadPicked(picked, {
        reactionId,
        nodes: nodes ?? [],
        compoundId: defaultCompound,
        parentId,
        progress,
      });
      if (count) onNotify(t.att.uploaded.replace('{n}', String(count)));
      if (autoLinked.length) onNotify(t.att.autoLinked.replace('{list}', autoLinked.join(', ')));
    } catch (e) {
      onNotify(`${t.att.uploadFailed}: ${String((e as Error).message ?? e)}`);
    }
    refresh();
  };

  const replaceNode = (next: Attachment) => setNodes((l) => l?.map((x) => (x.id === next.id ? next : x)) ?? null);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if ((e as Error).message === 'cycle') onNotify(t.att.cycle);
      else setError(true);
      refresh();
    }
  };

  const connect = (from: string, to: string) =>
    guard(async () => {
      if (from.startsWith(PRODUCT)) {
        replaceNode(await updateAttachment(to, { compoundId: from.slice(PRODUCT.length) }));
        return;
      }
      const a = ix.byId.get(from);
      const b = ix.byId.get(to);
      if (!a || !b || !reactionId) return;
      const link = await linkNodes(reactionId, { from, to, relation: relationFor(nodeTypeOf(a), nodeTypeOf(b)) });
      setLinks((ls) => [...ls.filter((l) => !(l.from === from && l.to === to)), link]);
    });

  const disconnect = (from: string, to: string) =>
    guard(async () => {
      if (from.startsWith(PRODUCT)) {
        replaceNode(await updateAttachment(to, { compoundId: null }));
        return;
      }
      if (!reactionId) return;
      await unlinkNodes(reactionId, from, to);
      setLinks((ls) => ls.filter((l) => !(l.from === from && l.to === to)));
    });

  const move = (positions: Record<string, [number, number]>) => {
    if (!reactionId) return;
    setNodes((l) => l?.map((n) => (positions[n.id] ? { ...n, pos: positions[n.id] } : n)) ?? null);
    savePositions(reactionId, positions).catch(() => setError(true));
  };

  const newSample = () => {
    const name = prompt(t.att.newSamplePrompt)?.trim();
    if (!name || !reactionId) return;
    guard(async () => {
      const n = await createNode(reactionId, { nodeType: 'sample', label: name, compoundId: defaultCompound });
      setNodes((l) => [...(l ?? []), n]);
      setSelectedId(n.id);
    });
  };

  const insertCharac = (productId: string, text: string) => {
    const c = rxn.components.find((x) => x.id === productId);
    if (!c) return;
    const cur = c.characterization ?? '';
    const sep = cur && !cur.endsWith('\n') ? '\n' : '';
    setRxn(updateComponent(rxn, productId, { characterization: cur + sep + text }));
  };

  const actions: NodeActions = {
    open: (n) => n.hasFile && setViewing(n),
    patch: (n, p) => guard(async () => replaceNode(await updateAttachment(n.id, p))),
    remove: (n) => {
      if (!confirm(t.att.deleteNode.replace('{name}', displayName(n)))) return;
      guard(async () => {
        await deleteAttachment(n.id);
        setNodes((l) => l?.filter((x) => x.id !== n.id) ?? null);
        setLinks((ls) => ls.filter((l) => l.from !== n.id && l.to !== n.id));
        if (selectedId === n.id) setSelectedId(null);
      });
    },
    addFiles: (parent, files) => upload(fromInput(files), parent.id),
    addPeakList: (parent) =>
      guard(async () => {
        if (!reactionId) return;
        const nuc = nucleusLabel(parent);
        const n = await addPeakList(reactionId, parent.id, t.att.peakListLabel.replace('{nuc}', nuc).trim());
        await refresh();
        setSelectedId(n.id);
      }),
    pack: async (n) => {
      setPacking(true);
      try {
        const ids = subtree(ix, n.id);
        const blob = await packNodes(ids.map((id) => ix.byId.get(id)!).filter(Boolean));
        saveBlob(blob, `${displayName(n).replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_')}.zip`);
      } catch (e) {
        onNotify(String((e as Error).message ?? e));
      } finally {
        setPacking(false);
      }
    },
    insertCharac: (n, text) => {
      const cid = compoundOf(ix, n.id);
      if (!cid) return;
      // A bare peak list gets the header of the spectrum it came from.
      const nmr = (ix.parents.get(n.id) ?? []).map((id) => ix.byId.get(id)).find((p) => p?.kind === 'nmr');
      const prefix = nmr && !/NMR/i.test(text) ? siPrefix(nmr.meta as unknown as NmrMeta) : undefined;
      insertCharac(cid, prefix ? prefix + text.replace(/^δ\s*/, '') : text);
    },
    select: setSelectedId,
  };

  /** SI prefixes from 1D NMR experiments belonging to this product (or to no product). */
  const nmrFor = (productId: string) =>
    (nodes ?? [])
      .filter((a) => a.kind === 'nmr' && nodeTypeOf(a) === 'source')
      .filter((a) => {
        const cid = compoundOf(ix, a.id);
        return cid === productId || !cid;
      })
      .map((a) => siPrefix(a.meta as unknown as NmrMeta))
      .filter((x): x is string => !!x);

  const canUpload = remote && !!reactionId;
  const has = !!nodes && nodes.length > 0;
  const rows = useMemo(() => (nodes ? treeRows(ix, nodes) : []), [ix, nodes]);
  const nameOf = (id: string) => {
    const n = ix.byId.get(id);
    return n ? displayName(n) : id;
  };

  return (
    <section
      className={'card attachments' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        if (!canUpload || ![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={async (e) => {
        if (!canUpload || ![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDragging(false);
        upload(await fromDrop(e.dataTransfer));
      }}
    >
      <div className="card-head">
        <h2>{t.att.title}</h2>
        {canUpload && (
          <div className="toolbar no-print">
            {has && (
              <div className="seg" role="group">
                <button className={view === 'graph' ? 'on' : ''} onClick={() => setView('graph')}>{t.att.viewGraph}</button>
                <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t.att.viewList}</button>
              </div>
            )}
            {has && view === 'graph' && <button className="ghost" onClick={() => setTidyToken((x) => x + 1)}>{t.att.tidy}</button>}
            <button className="ghost" onClick={newSample}>+ {t.att.newSample}</button>
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
      {canUpload && <p className="hint att-hint">{has && view === 'graph' ? t.att.graphHint : t.att.hint}</p>}
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

      {has && (
        <div className={'att-board view-' + view}>
          {view === 'graph' ? (
            <Suspense fallback={<div className="graph-wrap graph-loading">…</div>}>
              <AttachmentGraph
                reactionId={reactionId!}
                nodes={nodes!}
                links={links}
                ix={ix}
                products={products}
                selectedId={selectedId}
                tidyToken={tidyToken}
                onSelect={setSelectedId}
                onOpen={actions.open}
                onConnect={connect}
                onDisconnect={disconnect}
                onMove={move}
                onDrop={async (id, dt) => upload(await fromDrop(dt), id ?? undefined)}
              />
            </Suspense>
          ) : (
            <div className="att-tree">
              {rows.map(({ node: a, depth, alsoFrom }) => {
                const type = nodeTypeOf(a);
                return (
                  <div
                    key={a.id}
                    className={'att-row t-' + type + (a.id === selectedId ? ' selected' : '')}
                    style={{ paddingLeft: `${depth * 22 + 8}px` }}
                    onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
                  >
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
                          <button className="link" onClick={(e) => (e.stopPropagation(), setViewing(a))}>{displayName(a)}</button>
                        ) : (
                          <span>{displayName(a)}</span>
                        )}
                      </div>
                      <div className="att-row-sub muted small">
                        {a.kind === 'nmr' && <NmrMetaLine att={a} />}
                        {a.hasFile && <span>{formatSize(a.size)}</span>}
                        {type === 'peaklist' && <span>{String(a.meta.text ?? '').slice(0, 80)}</span>}
                        {a.note && <span>{a.note}</span>}
                        {alsoFrom.length > 0 && <span>{t.att.alsoFrom.replace('{list}', alsoFrom.map(nameOf).join(', '))}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <aside className="inspector-wrap no-print">
            {selected ? (
              <NodeInspector
                node={selected}
                ix={ix}
                products={products}
                compoundId={compoundOf(ix, selected.id)}
                packing={packing}
                actions={actions}
              />
            ) : (
              <p className="muted small insp-empty">{t.att.selectHint}</p>
            )}
          </aside>
        </div>
      )}
      {nodes && nodes.length === 0 && canUpload && <div className="att-empty">{t.att.empty}</div>}

      {products.length > 0 && (
        <div className="charac">
          <h3>{t.att.characterization}</h3>
          {products.map((p) => {
            const prefixes = [...new Set(nmrFor(p.id))];
            const comp = has ? completeness(ix, nodes!, p.id) : null;
            return (
              <label key={p.id} className="field">
                <span>
                  {p.name}
                  {comp && (comp.nuclei.length > 0 || comp.ms) && (
                    <span className="charac-have no-print">
                      {t.att.complete}: {comp.nuclei.map((n) => prettyNucleus(n) ?? n).join(' · ')}
                      {comp.ms && `${comp.nuclei.length ? ' · ' : ''}MS`}
                      {comp.twoD && ' · 2D'}
                      {!comp.ms && <em> — {t.att.missing}: MS</em>}
                    </span>
                  )}
                </span>
                <textarea
                  rows={3}
                  value={p.characterization ?? ''}
                  placeholder={t.att.characterizationPh}
                  onChange={(e) => setRxn(updateComponent(rxn, p.id, { characterization: e.target.value }))}
                />
                {prefixes.length > 0 && (
                  <span className="charac-chips no-print">
                    {prefixes.map((prefix) => (
                      <button key={prefix} type="button" className="ghost small" onClick={() => insertCharac(p.id, prefix)}>
                        + {prefix.trim()}
                      </button>
                    ))}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {viewing && <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
