// Upload picked files into the node graph:
// - every folder with `acqus` becomes one zipped Bruker experiment (source node),
//   grouped under a sample node named after its sample folder (reused if it exists);
// - other files are linked to an explicit upstream node, else to the experiment or
//   sample their name / folder points to, else left as top-level nodes.
import {
  createNode, kindFromName, MIME, uploadAttachment, uploadPreview, type Attachment, type Kind, type NodeType,
} from './api';
import { findExperiments, type NmrMeta, type PickedFile } from './bruker';
import { displayName, guessParent, nodeTypeOf, relationFor } from './graph';
import { thumbnailPng } from './plot';
import { brukerFromZip } from './spectrumFromZip';
import { zipFiles } from './zip';

export interface Progress {
  start(name: string): { progress(p: number): void; fail(msg: string): void; done(): void };
}

export interface UploadContext {
  /** Owner: a reaction id, or "lot:<id>" for a reagent lot. */
  reactionId: string;
  /** Run the upload belongs to; top-level nodes record it (meta.runId). */
  runId?: string;
  /** Current graph nodes (to reuse sample nodes and guess parents). */
  nodes: Attachment[];
  /** Product to attach new top-level nodes to. */
  compoundId?: string;
  /** Upload everything downstream of this node (dropped onto it in the graph). */
  parentId?: string;
  progress: Progress;
}

const NODE_FOR_KIND: Partial<Record<Kind, NodeType>> = { mnova: 'processed', pdf: 'export', image: 'export', jcamp: 'export' };

export async function uploadPicked(picked: PickedFile[], ctx: UploadContext): Promise<{ count: number; autoLinked: string[] }> {
  const { reactionId } = ctx;
  const nodes = [...ctx.nodes];
  const experiments = findExperiments(picked);
  const inExperiment = new Set(experiments.flatMap((e) => e.files));
  const autoLinked: string[] = [];
  let count = 0;
  const parent = ctx.parentId ? nodes.find((n) => n.id === ctx.parentId) : undefined;

  const sampleNode = async (name: string): Promise<Attachment | undefined> => {
    // Same sample name in another run is a different sample.
    const existing = nodes.find(
      (n) => nodeTypeOf(n) === 'sample' && displayName(n) === name && (!ctx.runId || !n.meta.runId || n.meta.runId === ctx.runId),
    );
    if (existing) return existing;
    const created = await createNode(reactionId, {
      nodeType: 'sample',
      label: name,
      meta: !parent && ctx.runId ? { runId: ctx.runId } : undefined,
      compoundId: parent ? undefined : ctx.compoundId,
      parentIds: parent ? [parent.id] : undefined,
    });
    nodes.push(created);
    return created;
  };

  for (const ex of experiments) {
    const parts = ex.root.split('/').filter(Boolean);
    // Keep "<sample>/<expno>/…" inside the zip, the layout TopSpin and MNova expect.
    const strip = parts.length > 2 ? parts.slice(0, -2).join('/') + '/' : '';
    const base = [ex.sample, ex.expno].filter(Boolean).join('_') || 'nmr';
    const tr = ctx.progress.start(base);
    try {
      const zip = await zipFiles(ex.files, strip);
      let meta: NmrMeta | undefined;
      let spectrum;
      try {
        ({ meta, spectrum } = brukerFromZip(zip));
      } catch {
        /* keep the upload even if parameters can't be read */
      }
      const group = ex.sample ? await sampleNode(ex.sample) : undefined;
      const up = group ?? parent;
      const nuc = meta?.nucleus?.replace('/', '-');
      const att = await uploadAttachment(
        reactionId,
        new Blob([zip as BlobPart], { type: 'application/zip' }),
        {
          filename: `${base}${nuc ? `_${nuc}` : ''}.zip`,
          kind: 'nmr',
          nodeType: 'source',
          compoundId: up ? undefined : ctx.compoundId,
          meta: { ...(meta ?? {}), ...(!up && ctx.runId ? { runId: ctx.runId } : {}) },
          parentIds: up ? [up.id] : undefined,
          relation: up ? relationFor(nodeTypeOf(up), 'source') : undefined,
        },
        tr.progress,
      );
      nodes.push(att);
      if (spectrum) await uploadPreview(att.id, await thumbnailPng(spectrum)).catch(() => undefined);
      tr.done();
      count++;
    } catch (e) {
      tr.fail(String((e as Error).message ?? e));
    }
  }

  for (const f of picked.filter((p) => !inExperiment.has(p))) {
    const name = f.path.split('/').pop()!;
    const kind = kindFromName(name);
    const nodeType = NODE_FOR_KIND[kind] ?? (kind === 'other' ? 'other' : 'source');
    // A file inside a picked sample folder belongs to that sample unless its name names an experiment.
    const folderSample = f.path.includes('/') ? f.path.split('/').slice(-2, -1)[0] : undefined;
    const sampleOfFolder = folderSample ? nodes.find((n) => nodeTypeOf(n) === 'sample' && displayName(n) === folderSample) : undefined;
    const up = parent ?? guessParent(name, nodes) ?? sampleOfFolder;
    if (up && !parent) autoLinked.push(`${name} → ${displayName(up)}`);
    const tr = ctx.progress.start(name);
    try {
      const ext = name.toLowerCase().split('.').pop() ?? '';
      const blob = f.file.type ? f.file : new Blob([f.file], { type: MIME[ext] ?? 'application/octet-stream' });
      const att = await uploadAttachment(
        reactionId,
        blob,
        {
          filename: name,
          kind,
          nodeType,
          compoundId: up ? undefined : ctx.compoundId,
          meta: !up && ctx.runId ? { runId: ctx.runId } : undefined,
          parentIds: up ? [up.id] : undefined,
          relation: up ? relationFor(nodeTypeOf(up), nodeType) : undefined,
        },
        tr.progress,
      );
      nodes.push(att);
      tr.done();
      count++;
    } catch (e) {
      tr.fail(String((e as Error).message ?? e));
    }
  }
  return { count, autoLinked };
}

/** Create a peak-list text node downstream of `parentId`. */
export const addPeakList = (reactionId: string, parentId: string, label: string) =>
  createNode(reactionId, { nodeType: 'peaklist', label, meta: { text: '' }, parentIds: [parentId] });
