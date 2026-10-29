// "Characterization & spectra" card: a node graph (desktop) or indented list
// (mobile). Left to right: every compound of the current run → its reagent lot
// (identity spectra shared by all reactions using the bottle) or, for products,
// the samples of this run → raw Bruker data → MNova / PDF / peak lists. Plus
// the SI characterization text for each product.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createNode, deleteAttachment, linkNodes, savePositions, unlinkNodes, updateAttachment, type Attachment } from '../attachments/api';
import { siPrefix, type NmrMeta, type PickedFile } from '../attachments/bruker';
import { compoundOf, displayName, nodeTypeOf, relationFor, subtree, wouldCycle } from '../attachments/graph';
import { fromDrop, fromInput } from '../attachments/picked';
// Uploading (folders are zipped) and packing load on first use.
import type { Progress } from '../attachments/uploader';
import { saveBlob } from '../export';
import { lotOwner, type Verification } from '../chem/lots';
import { activeRun, runsOf } from '../chem/runs';
import { updateComponent, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { saveToInventory } from '../storage/inventory';
import type { VNode } from './AttachmentGraph';
import { AttachmentList } from './AttachmentList';
import { Characterization } from './Characterization';
import { NodeInspector, nucleusLabel, type NodeActions } from './NodeInspector';
import { CMP, LOT, useAttachmentGraph } from './useAttachmentGraph';
import { CompoundInspector, LotInspector } from './VirtualInspector';

const AttachmentGraph = lazy(() => import('./AttachmentGraph'));
const AttachmentViewer = lazy(() => import('./AttachmentViewer').then((m) => ({ default: m.AttachmentViewer })));

interface Props {
  rxn: Reaction;
  setRxn: Dispatch<SetStateAction<Reaction>>;
  /** Saved reaction on the server; attachments need one. */
  reactionId?: string;
  remote: boolean;
  onSave: () => void;
  onNotify: (msg: string) => void;
  /** Node to select and reveal ("lot:<id>", "cmp:<id>" or an attachment id). */
  focusNode?: string | null;
  onFocused?: () => void;
  /** Open the reagent side panel of a component. */
  onReagentInfo?: (componentId: string) => void;
  onOpenReaction?: (id: string) => void;
}

interface Upload {
  name: string;
  progress: number;
  error?: string;
}

type View = 'graph' | 'list';
const VIEW_KEY = 'attachments-view';

/** Where an upload goes: owner (reaction or lot), optional upstream node and compound. */
interface Target {
  owner: string;
  parentId?: string;
  compoundId?: string;
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

/** Keyed by the reaction id (see App): each reaction starts with empty state. */
export function Attachments({ rxn, setRxn, reactionId, remote, onSave, onNotify, focusNode, onFocused, onReagentInfo, onOpenReaction }: Props) {
  const { t } = useI18n();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setViewState] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tidyToken, setTidyToken] = useState(0);
  const [centerToken, setCenterToken] = useState(0);
  const [packing, setPacking] = useState(false);
  const [onlyRun, setOnlyRun] = useState(true);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const target = useRef<Target | null>(null);

  const run = activeRun(rxn);
  const multiRun = runsOf(rxn).length > 1;
  const products = rxn.components.filter((c) => c.role === 'product');
  const defaultCompound = products.length === 1 ? products[0].id : undefined;
  const g = useAttachmentGraph(rxn, reactionId, remote, onlyRun, multiRun);
  const { library, setLibrary, setError, refresh, allNodes, ixAll, nodes, links, ix, virtual, patchGraph, replaceNode } = g;
  const ownNodes = (owner: string) => allNodes.filter((n) => n.reactionId === owner);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // Reveal a node asked for from outside (e.g. "identity spectra" in the side panel):
  // select it while rendering, then scroll to the card and report it handled.
  const [focusSeen, setFocusSeen] = useState<string | null>(null);
  if ((focusNode ?? null) !== focusSeen) {
    setFocusSeen(focusNode ?? null);
    if (focusNode) {
      setSelectedId(focusNode);
      setViewState('graph');
      setCenterToken((x) => x + 1);
    }
  }
  useEffect(() => {
    if (!focusNode) return;
    try {
      localStorage.setItem(VIEW_KEY, 'graph');
    } catch {
      /* ignore */
    }
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onFocused?.();
  }, [focusNode]); // eslint-disable-line react-hooks/exhaustive-deps -- once per request

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

  const defaultTarget = (): Target | null => (reactionId ? { owner: reactionId, compoundId: defaultCompound } : null);

  /** Upload target for a node id (attachment, compound or lot). */
  const targetFor = (id: string | null): Target | null => {
    if (!reactionId) return null;
    if (!id) return defaultTarget();
    if (id.startsWith(CMP)) return { owner: reactionId, compoundId: id.slice(CMP.length) };
    if (id.startsWith(LOT)) {
      const lotId = id.slice(LOT.length);
      if (!library.has(lotId)) {
        onNotify(t.lots.noLotForUpload);
        return null;
      }
      return { owner: lotOwner(lotId) };
    }
    const n = ixAll.byId.get(id);
    return n ? { owner: n.reactionId, parentId: n.id } : defaultTarget();
  };

  const upload = async (picked: PickedFile[], to: Target | null) => {
    if (!to || !picked.length) return;
    try {
      const { uploadPicked } = await import('../attachments/uploader');
      const { count, autoLinked } = await uploadPicked(picked, {
        reactionId: to.owner,
        runId: to.owner === reactionId ? run.id : undefined,
        nodes: ownNodes(to.owner),
        compoundId: to.parentId ? undefined : to.compoundId,
        parentId: to.parentId,
        progress,
      });
      if (count) onNotify(t.att.uploaded.replace('{n}', String(count)));
      if (autoLinked.length) onNotify(t.att.autoLinked.replace('{list}', autoLinked.join(', ')));
    } catch (e) {
      onNotify(`${t.att.uploadFailed}: ${String((e as Error).message ?? e)}`);
    }
    refresh();
  };

  /** Open the file / folder picker for a target. */
  const pick = (to: Target | null, folder: boolean) => {
    if (!to) return;
    target.current = to;
    (folder ? folderRef : filesRef).current?.click();
  };


  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if ((e as Error).message === 'cycle') onNotify(t.att.cycle);
      else setError(true);
      refresh();
    }
  };

  const canConnect = useCallback(
    (from: string, to: string) => {
      const b = ixAll.byId.get(to);
      if (!b) return false;
      if (from.startsWith(CMP)) return b.reactionId === reactionId;
      if (from.startsWith(LOT)) return false;
      const a = ixAll.byId.get(from);
      return !!a && a.reactionId === b.reactionId && !wouldCycle(ixAll, from, to);
    },
    [ixAll, reactionId],
  );

  const connect = (from: string, to: string) =>
    guard(async () => {
      const a = ixAll.byId.get(from);
      const b = ixAll.byId.get(to);
      if (!b) return;
      if (from.startsWith(CMP)) {
        replaceNode(await updateAttachment(to, { compoundId: from.slice(CMP.length) }));
        return;
      }
      if (!a) return;
      if (a.reactionId !== b.reactionId) return onNotify(t.att.crossOwner);
      const link = await linkNodes(a.reactionId, { from, to, relation: relationFor(nodeTypeOf(a), nodeTypeOf(b)) });
      patchGraph(a.reactionId, (g) => ({ ...g, links: [...g.links.filter((l) => !(l.from === from && l.to === to)), link] }));
    });

  const disconnect = (from: string, to: string) =>
    guard(async () => {
      if (from.startsWith(LOT) || to.startsWith(LOT)) return; // follows the reagent info, not the canvas
      const b = ixAll.byId.get(to);
      if (!b) return;
      if (from.startsWith(CMP)) {
        if (b.compoundId === from.slice(CMP.length)) replaceNode(await updateAttachment(to, { compoundId: null }));
        return;
      }
      await unlinkNodes(b.reactionId, from, to);
      patchGraph(b.reactionId, (g) => ({ ...g, links: g.links.filter((l) => !(l.from === from && l.to === to)) }));
    });

  const move = (positions: Record<string, [number, number]>) => {
    const byOwner = new Map<string, Record<string, [number, number]>>();
    for (const [id, p] of Object.entries(positions)) {
      const n = ixAll.byId.get(id);
      if (!n) continue;
      byOwner.set(n.reactionId, { ...(byOwner.get(n.reactionId) ?? {}), [id]: p });
    }
    for (const [owner, pos] of byOwner) {
      patchGraph(owner, (g) => ({ ...g, nodes: g.nodes.map((n) => (pos[n.id] ? { ...n, pos: pos[n.id] } : n)) }));
      savePositions(owner, pos).catch(() => setError(true));
    }
  };

  const newSample = () => {
    const name = prompt(t.att.newSamplePrompt)?.trim();
    if (!name || !reactionId) return;
    guard(async () => {
      const n = await createNode(reactionId, { nodeType: 'sample', label: name, compoundId: defaultCompound, meta: { runId: run.id } });
      patchGraph(reactionId, (g) => ({ ...g, nodes: [...g.nodes, n] }));
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

  /** Identity check of a lot, edited on its node: library + this run's snapshots. */
  const setVerification = (lotId: string, verification: Verification | undefined, verificationNote: string | undefined) => {
    const lib = library.get(lotId);
    if (!lib) return;
    guard(async () => {
      // Through the inventory so its window shows the new identity check too.
      const saved = await saveToInventory({ ...lib, verification, verificationNote });
      setLibrary((m) => new Map(m).set(lotId, { ...saved, attachments: lib.attachments }));
      setRxn((r) => ({
        ...r,
        components: r.components.map((c) => (c.lot?.lotId === lotId ? { ...c, lot: { ...c.lot, verification, verificationNote } } : c)),
      }));
    });
  };

  const actions: NodeActions = {
    open: (n) => n.hasFile && setViewing(n),
    patch: (n, p) => guard(async () => replaceNode(await updateAttachment(n.id, p))),
    remove: (n) => {
      if (!confirm(t.att.deleteNode.replace('{name}', displayName(n)))) return;
      guard(async () => {
        await deleteAttachment(n.id);
        patchGraph(n.reactionId, (g) => ({
          nodes: g.nodes.filter((x) => x.id !== n.id),
          links: g.links.filter((l) => l.from !== n.id && l.to !== n.id),
        }));
        if (selectedId === n.id) setSelectedId(null);
      });
    },
    addFiles: (parent, files) => upload(fromInput(files), { owner: parent.reactionId, parentId: parent.id }),
    addPeakList: (parent) =>
      guard(async () => {
        const nuc = nucleusLabel(parent);
        const { addPeakList } = await import('../attachments/uploader');
        const n = await addPeakList(parent.reactionId, parent.id, t.att.peakListLabel.replace('{nuc}', nuc).trim());
        await refresh();
        setSelectedId(n.id);
      }),
    pack: async (n) => {
      setPacking(true);
      try {
        const ids = subtree(ixAll, n.id);
        const { packNodes } = await import('../attachments/pack');
        const blob = await packNodes(ids.map((id) => ixAll.byId.get(id)!).filter(Boolean));
        saveBlob(blob, `${displayName(n).replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|]/g, '_')}.zip`);
      } catch (e) {
        onNotify(String((e as Error).message ?? e));
      } finally {
        setPacking(false);
      }
    },
    insertCharac: (n, text) => {
      const cid = compoundOf(ixAll, n.id);
      if (!cid) return;
      // A bare peak list gets the header of the spectrum it came from.
      const nmr = (ixAll.parents.get(n.id) ?? []).map((id) => ixAll.byId.get(id)).find((p) => p?.kind === 'nmr');
      const prefix = nmr && !/NMR/i.test(text) ? siPrefix(nmr.meta as unknown as NmrMeta) : undefined;
      insertCharac(cid, prefix ? prefix + text.replace(/^δ\s*/, '') : text);
    },
    select: setSelectedId,
  };

  const canUpload = remote && !!reactionId;
  const has = g.loaded && (allNodes.length > 0 || virtual.some((v) => v.kind === 'lot'));
  const filesUnder = (ids: string[]) => ids.reduce((sum, id) => sum + subtree(ix, id).filter((x) => ix.byId.get(x)?.hasFile).length, 0);

  const selectedAtt = selectedId ? ixAll.byId.get(selectedId) : undefined;
  const selectedV = selectedId ? virtual.find((v) => v.id === selectedId) : undefined;
  const compOfV = (v: VNode) =>
    v.kind === 'compound'
      ? rxn.components.find((c) => CMP + c.id === v.id)
      : rxn.components.find((c) => c.lot?.lotId && LOT + c.lot.lotId === v.id);

  const inspector = () => {
    if (selectedAtt) {
      const own = selectedAtt.reactionId === reactionId;
      return (
        <NodeInspector
          key={`${selectedAtt.id}:${String(selectedAtt.meta.text ?? '')}`}
          node={selectedAtt}
          ix={ixAll}
          products={own ? rxn.components : []}
          compoundId={compoundOf(ixAll, selectedAtt.id)}
          packing={packing}
          actions={actions}
        />
      );
    }
    if (selectedV) {
      const c = compOfV(selectedV);
      if (!c) return null;
      if (selectedV.kind === 'compound')
        return (
          <CompoundInspector
            c={c}
            files={filesUnder(selectedV.targets.filter((x) => !x.startsWith(LOT)))}
            onUpload={(folder) => pick({ owner: reactionId!, compoundId: c.id }, folder)}
            onReagentInfo={() => onReagentInfo?.(c.id)}
          />
        );
      const lotId = selectedV.id.slice(LOT.length);
      const lib = library.get(lotId);
      return (
        <LotInspector
          snapshot={c.lot ?? {}}
          lot={lib}
          compoundName={c.name}
          files={filesUnder(selectedV.targets)}
          onUpload={(folder) => pick(targetFor(selectedV.id), folder)}
          onVerification={(v, note) => setVerification(lotId, v, note)}
          onReagentInfo={() => onReagentInfo?.(c.id)}
          onOpenSource={c.lot?.source === 'made' && c.lot.sourceReactionId ? () => onOpenReaction?.(c.lot!.sourceReactionId!) : undefined}
        />
      );
    }
    return <p className="muted small insp-empty">{t.att.selectHint}</p>;
  };

  const fileInput = (folder: boolean) => (
    <input
      ref={folder ? folderRef : filesRef}
      type="file"
      hidden
      multiple
      {...(folder ? { webkitdirectory: '' } : {})}
      onChange={(e) => {
        if (e.target.files) upload(fromInput(e.target.files), target.current ?? defaultTarget());
        target.current = null;
        e.target.value = '';
      }}
    />
  );

  return (
    <section
      ref={cardRef}
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
        upload(await fromDrop(e.dataTransfer), defaultTarget());
      }}
    >
      <div className="card-head">
        <h2>{t.att.title}</h2>
        {canUpload && (
          <div className="toolbar no-print">
            {has && multiRun && (
              <label className="check small" title={g.hiddenCount ? `${g.hiddenCount}` : undefined}>
                <input type="checkbox" checked={onlyRun} onChange={(e) => setOnlyRun(e.target.checked)} />
                {t.att.onlyRun}
              </label>
            )}
            {has && (
              <div className="seg" role="group">
                <button className={view === 'graph' ? 'on' : ''} onClick={() => setView('graph')}>{t.att.viewGraph}</button>
                <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t.att.viewList}</button>
              </div>
            )}
            {has && view === 'graph' && <button className="ghost" onClick={() => setTidyToken((x) => x + 1)}>{t.att.tidy}</button>}
            <button className="ghost" onClick={newSample}>+ {t.att.newSample}</button>
            <button onClick={() => pick(defaultTarget(), true)}>{t.att.uploadFolder}</button>
            <button className="ghost" onClick={() => pick(defaultTarget(), false)}>{t.att.uploadFiles}</button>
            {fileInput(true)}
            {fileInput(false)}
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
      {g.error && <p className="warn small">{t.loadFailed}</p>}

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
                nodes={nodes}
                links={links}
                ix={ix}
                virtual={virtual}
                posKey={`graph-vpos-${reactionId}`}
                selectedId={selectedId}
                tidyToken={tidyToken}
                centerToken={centerToken}
                canConnect={canConnect}
                onSelect={setSelectedId}
                onOpen={actions.open}
                onConnect={connect}
                onDisconnect={disconnect}
                onMove={move}
                onDrop={async (id, dt) => {
                  const files = await fromDrop(dt);
                  upload(files, targetFor(id));
                }}
              />
            </Suspense>
          ) : (
            <AttachmentList virtual={virtual} nodes={nodes} ix={ix} selectedId={selectedId} onSelect={setSelectedId} onView={setViewing} />
          )}
          <aside className="inspector-wrap no-print">{inspector()}</aside>
        </div>
      )}
      {g.loaded && !has && canUpload && <div className="att-empty">{t.att.empty}</div>}

      {products.length > 0 && (
        <Characterization
          products={products}
          nodes={nodes}
          ix={ix}
          reactionId={reactionId}
          hasNodes={has}
          onChange={(id, text) => setRxn(updateComponent(rxn, id, { characterization: text }))}
          onInsert={insertCharac}
        />
      )}

      {viewing && (
        <Suspense fallback={null}>
          <AttachmentViewer att={viewing} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </section>
  );
}

