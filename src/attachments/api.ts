// Client for the attachment API (worker/attachments.ts).
import { api as call } from '../storage/http';

export type Kind = 'nmr' | 'mnova' | 'jcamp' | 'ms' | 'hplc' | 'ir' | 'xrd' | 'cif' | 'pdf' | 'image' | 'text' | 'sample' | 'other';
export type NodeType = 'sample' | 'source' | 'processed' | 'export' | 'peaklist' | 'other';
export type Relation = 'contains' | 'processed' | 'export' | 'peaklist' | 'derived';

export interface Attachment {
  id: string;
  reactionId: string;
  compoundId?: string;
  kind: Kind;
  filename: string;
  size: number;
  sha256?: string;
  contentType?: string;
  hasPreview: boolean;
  meta: Record<string, unknown>;
  note: string;
  uploadedBy?: string;
  createdAt: number;
  /** Graph role; absent on attachments uploaded before the node graph. */
  nodeType?: NodeType;
  /** Display name for file-less nodes (sample groups, peak lists). */
  label?: string;
  hasFile: boolean;
  /** Saved position in the node graph. */
  pos?: [number, number];
}

export interface Link {
  from: string;
  to: string;
  relation?: Relation;
}

export interface Graph {
  nodes: Attachment[];
  links: Link[];
}

export interface UploadMeta {
  filename: string;
  kind: Kind;
  compoundId?: string;
  note?: string;
  meta?: Record<string, unknown>;
  nodeType?: NodeType;
  /** Upstream nodes to link from. */
  parentIds?: string[];
  relation?: Relation;
}

export const fileUrl = (id: string, download = false) => `/api/attachments/${encodeURIComponent(id)}/file${download ? '?download' : ''}`;
export const previewUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}/preview`;

/**
 * Attachments belong to an owner: a reaction id, or "lot:<lot id>" for a
 * reagent lot's identity spectra. `rid` parameters below accept either.
 */
export const ownerBase = (owner: string) =>
  owner.startsWith('lot:') ? `/api/lots/${encodeURIComponent(owner.slice(4))}` : `/api/reactions/${encodeURIComponent(owner)}`;

export const listAttachments = (owner: string) => call<Attachment[]>(`${ownerBase(owner)}/attachments`);

export const updateAttachment = (
  id: string,
  patch: Partial<Pick<Attachment, 'note' | 'kind' | 'meta' | 'label'>> & { compoundId?: string | null; nodeType?: NodeType },
) =>
  call<Attachment>(`/api/attachments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const deleteAttachment = (id: string) => call<void>(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });

const rpath = (rid: string, what: string) => `${ownerBase(rid)}/${what}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getGraph = (rid: string) => call<Graph>(rpath(rid, 'graph'));

export const createNode = (
  rid: string,
  node: { nodeType: 'sample' | 'peaklist'; label: string; meta?: Record<string, unknown>; compoundId?: string; parentIds?: string[] },
) => call<Attachment>(rpath(rid, 'nodes'), jsonInit('POST', node));

/** Rejects with Error('cycle') if the link would create a loop. */
export const linkNodes = (rid: string, link: Link) => call<Link>(rpath(rid, 'links'), jsonInit('POST', link));

export const unlinkNodes = (rid: string, from: string, to: string) =>
  call<void>(`${rpath(rid, 'links')}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'DELETE' });

export const savePositions = (rid: string, positions: Record<string, [number, number] | null>) =>
  call<void>(rpath(rid, 'positions'), jsonInit('PUT', { positions }));

export async function sha256Hex(data: Blob | Uint8Array): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Upload with progress (fetch has no upload progress). */
export async function uploadAttachment(
  reactionId: string,
  data: Blob,
  meta: UploadMeta,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  const sha256 = await sha256Hex(data);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ownerBase(reactionId)}/attachments`);
    xhr.setRequestHeader('Content-Type', data.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Attachment', encodeURIComponent(JSON.stringify({ ...meta, sha256 })));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Attachment);
      else reject(new Error((body as { error?: string } | null)?.error ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.send(data);
  });
}

export async function uploadPreview(id: string, png: Blob) {
  const res = await fetch(previewUrl(id), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const EXT: Record<string, Kind> = {
  mnova: 'mnova', jdx: 'jcamp', dx: 'jcamp', jcamp: 'jcamp', pdf: 'pdf', cif: 'cif', xy: 'xrd', xrdml: 'xrd',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', spa: 'ir', jdf: 'nmr',
};

export function kindFromName(name: string): Kind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return EXT[ext] ?? 'other';
}

export const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', txt: 'text/plain',
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
