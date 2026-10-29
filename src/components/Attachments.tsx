// "Characterization & spectra" card: a node graph (desktop) or indented list
// (mobile). Left to right: every compound of the current run → its reagent lot
// (identity spectra shared by all reactions using the bottle) or, for products,
// the samples of this run → raw Bruker data → MNova / PDF / peak lists. Plus
// the SI characterization text for each product.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createNode, deleteAttachment, formatSize, getGraph, linkNodes, previewUrl, savePositions, unlinkNodes, updateAttachment,
  type Attachment, type Link,
} from '../attachments/api';
import { siPrefix, prettyNucleus, type NmrMeta, type PickedFile } from '../attachments/bruker';
import { compoundOf, completeness, displayName, indexGraph, nodeTypeOf, relationFor, subtree, wouldCycle, type Index } from '../attachments/graph';
import { packNodes, saveBlob } from '../attachments/pack';
import { addPeakList, uploadPicked, type Progress } from '../attachments/uploader';
import { lotLabel, lotOwner, type ReagentLot, type Verification } from '../chem/lots';
import { activeRun, runsOf } from '../chem/runs';
import { updateComponent, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { lotRepo } from '../storage/lots';
import type { VNode } from './AttachmentGraph';
import { AttachmentViewer } from './AttachmentViewer';
import { NmrMetaLine } from './NmrMetaLine';
import { NodeInspector, nucleusLabel, type NodeActions } from './NodeInspector';
import { CompoundInspector, LotInspector } from './VirtualInspector';

const AttachmentGraph = lazy(() => import('./AttachmentGraph'));

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
const CMP = 'cmp:';
const LOT = 'lot:';

/** Where an upload goes: owner (reaction or lot), optional upstream node and compound. */
interface Target {
  owner: string;
  parentId?: string;
  compoundId?: string;
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

export function Attachments({ rxn, setRxn, reactionId, remote, onSave, onNotify, focusNode, onFocused, onReagentInfo, onOpenReaction }: Props) {
  const { t } = useI18n();
  const [graphs, setGraphs] = useState<Record<string, { nodes: Attachment[]; links: Link[] }> | null>(null);
  const [library, setLibrary] = useState<Map<string, ReagentLot>>(new Map());
  const [error, setError] = useState(false);
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
  // Lots used in this run (their spectra are shown and can be added here).
  const lotIds = useMemo(() => [...new Set(rxn.components.map((c) => c.lot?.lotId).filter((x): x is string => !!x))], [rxn.components]);
  const lotKey = lotIds.join(',');
  const owners = useMemo(() => (reactionId ? [reactionId, ...lotIds.map(lotOwner)] : []), [reactionId, lotKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const [all, lots] = await Promise.all([
        Promise.all(owners.map(async (o) => [o, await getGraph(o)] as const)),
        lotIds.length ? lotRepo.list() : Promise.resolve([] as ReagentLot[]),
      ]);
      setGraphs(Object.fromEntries(all));
      setLibrary(new Map(lots.map((l) => [l.id, l])));
    } catch {
      setError(true);
    }
  }, [reactionId, remote, owners]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setGraphs(null);
    setSelectedId(null);
  }, [reactionId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const allNodes = useMemo(() => Object.values(graphs ?? {}).flatMap((g) => g.nodes), [graphs]);
  const allLinks = useMemo(() => Object.values(graphs ?? {}).flatMap((g) => g.links), [graphs]);
  const ixAll = useMemo(() => indexGraph(allNodes, allLinks), [allNodes, allLinks]);
  const isRoot = (ix: Index, id: string) => !(ix.parents.get(id) ?? []).length;

  // "Current run only": hide this reaction's top-level nodes recorded for another run (and what hangs below them).
  const nodes = useMemo(() => {
    if (!onlyRun || !multiRun) return allNodes;
    const roots = allNodes.filter((n) => isRoot(ixAll, n.id) && !(n.reactionId === reactionId && n.meta.runId && n.meta.runId !== run.id));
    const keep = new Set<string>();
    const stack = roots.map((n) => n.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (keep.has(id)) continue;
      keep.add(id);
      stack.push(...(ixAll.children.get(id) ?? []));
    }
    return allNodes.filter((n) => keep.has(n.id));
  }, [allNodes, ixAll, onlyRun, multiRun, reactionId, run.id]);
  const links = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return allLinks.filter((l) => ids.has(l.from) && ids.has(l.to));
  }, [nodes, allLinks]);
  const ix = useMemo(() => indexGraph(nodes, links), [nodes, links]);
  const ownNodes = (owner: string) => allNodes.filter((n) => n.reactionId === owner);
  const hiddenCount = allNodes.length - nodes.length;

  /** Compound and lot nodes of the current run. */
  const virtual = useMemo<VNode[]>(() => {
    const roots = nodes.filter((n) => isRoot(ix, n.id));
    const out: VNode[] = [];
    const lotsDone = new Set<string>();
    for (const c of rxn.components) {
      const mine = roots.filter((n) => n.reactionId === reactionId && n.compoundId === c.id).map((n) => n.id);
      const lotId = c.lot?.lotId;
      if (c.role === 'solvent' && !mine.length && !lotId) continue;
      out.push({
        id: CMP + c.id,
        kind: 'compound',
        strip: t.roles[c.role],
        title: c.name,
        sub: [c.formula, c.lot && lotLabel(c.lot, t.lots.made)].filter(Boolean).join(' · '),
        cls: 't-c-' + c.role,
        targets: [...mine, ...(lotId ? [LOT + lotId] : [])],
      });
      if (lotId && !lotsDone.has(lotId)) {
        lotsDone.add(lotId);
        const lib = library.get(lotId);
        const info = { ...c.lot, ...(lib ?? {}) };
        const files = lib?.attachments ?? 0;
        out.push({
          id: LOT + lotId,
          kind: 'lot',
          strip: t.att.lotNode,
          title: lotLabel(info, t.lots.made) || t.lots.unnamed,
          sub: [t.lots.verifications[info.verification ?? 'unverified'], files ? t.lots.files.replace('{n}', String(files)) : ''].filter(Boolean).join(' · '),
          cls: 't-lot',
          status: info.verification ?? 'unverified',
          targets: roots.filter((n) => n.reactionId === lotOwner(lotId)).map((n) => n.id),
        });
      }
    }
    return out;
  }, [rxn.components, nodes, ix, reactionId, library, t]);

  // Reveal a node asked for from outside (e.g. "identity spectra" in the side panel).
  useEffect(() => {
    if (!focusNode) return;
    setSelectedId(focusNode);
    if (view !== 'graph') setView('graph');
    setCenterToken((x) => x + 1);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onFocused?.();
  }, [focusNode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const patchGraph = (owner: string, f: (g: { nodes: Attachment[]; links: Link[] }) => { nodes: Attachment[]; links: Link[] }) =>
    setGraphs((gs) => (gs && gs[owner] ? { ...gs, [owner]: f(gs[owner]) } : gs));
  const replaceNode = (next: Attachment) => patchGraph(next.reactionId, (g) => ({ ...g, nodes: g.nodes.map((x) => (x.id === next.id ? next : x)) }));

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
      const saved = await lotRepo.save({ ...lib, verification, verificationNote });
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
        const n = await addPeakList(parent.reactionId, parent.id, t.att.peakListLabel.replace('{nuc}', nuc).trim());
        await refresh();
        setSelectedId(n.id);
      }),
    pack: async (n) => {
      setPacking(true);
      try {
        const ids = subtree(ixAll, n.id);
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

  /** SI prefixes from 1D NMR experiments of this reaction belonging to the product (or to no compound). */
  const nmrFor = (productId: string) =>
    nodes
      .filter((a) => a.reactionId === reactionId && a.kind === 'nmr' && nodeTypeOf(a) === 'source')
      .filter((a) => {
        const cid = compoundOf(ix, a.id);
        return cid === productId || !cid;
      })
      .map((a) => siPrefix(a.meta as unknown as NmrMeta))
      .filter((x): x is string => !!x);

  const canUpload = remote && !!reactionId;
  const has = !!graphs && (allNodes.length > 0 || virtual.some((v) => v.kind === 'lot'));
  const nameOf = (id: string) => {
    const n = ixAll.byId.get(id);
    return n ? displayName(n) : id;
  };
  const filesUnder = (ids: string[]) => ids.reduce((sum, id) => sum + subtree(ix, id).filter((x) => ix.byId.get(x)?.hasFile).length, 0);

  // List view: compounds, their lots and nodes, indented like the graph.
  const rows = useMemo(() => {
    type R = { kind: 'v'; v: VNode; depth: number } | { kind: 'n'; node: Attachment; depth: number; alsoFrom: string[] };
    const out: R[] = [];
    const placed = new Set<string>();
    const visit = (id: string, depth: number) => {
      const n = ix.byId.get(id);
      if (!n || placed.has(id)) return;
      placed.add(id);
      out.push({ kind: 'n', node: n, depth, alsoFrom: (ix.parents.get(id) ?? []).slice(1) });
      for (const c of ix.children.get(id) ?? []) if ((ix.parents.get(c) ?? [])[0] === id) visit(c, depth + 1);
    };
    const vById = new Map(virtual.map((v) => [v.id, v]));
    for (const v of virtual.filter((x) => x.kind === 'compound')) {
      out.push({ kind: 'v', v, depth: 0 });
      for (const to of v.targets) {
        const lot = vById.get(to);
        if (lot) {
          out.push({ kind: 'v', v: lot, depth: 1 });
          for (const r of lot.targets) visit(r, 2);
        } else visit(to, 1);
      }
    }
    for (const n of nodes) if (isRoot(ix, n.id)) visit(n.id, 0);
    return out;
  }, [virtual, ix, nodes]);

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
              <label className="check small" title={hiddenCount ? `${hiddenCount}` : undefined}>
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
            <div className="att-tree">
              {rows.map((r) => {
                if (r.kind === 'v') {
                  const v = r.v;
                  return (
                    <div
                      key={v.id}
                      className={'att-row att-vrow ' + v.cls + (v.id === selectedId ? ' selected' : '')}
                      style={{ paddingLeft: `${r.depth * 22 + 8}px` }}
                      onClick={() => setSelectedId(v.id === selectedId ? null : v.id)}
                    >
                      {r.depth > 0 && <span className="att-branch" aria-hidden>└</span>}
                      <span className="att-type-dot" aria-hidden />
                      <div className="att-row-main">
                        <div className="att-row-title">
                          <span className="att-row-type">{v.strip}</span>
                          <span>{v.title}</span>
                        </div>
                        {v.sub && <div className="att-row-sub muted small">{v.sub}</div>}
                      </div>
                    </div>
                  );
                }
                const { node: a, depth, alsoFrom } = r;
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
          <aside className="inspector-wrap no-print">{inspector()}</aside>
        </div>
      )}
      {graphs && !has && canUpload && <div className="att-empty">{t.att.empty}</div>}

      {products.length > 0 && (
        <div className="charac">
          <h3>{t.att.characterization}</h3>
          {products.map((p) => {
            const prefixes = [...new Set(nmrFor(p.id))];
            const comp = has ? completeness(ix, nodes.filter((n) => n.reactionId === reactionId), p.id) : null;
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

