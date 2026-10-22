// Client for the attachment API (worker/attachments.ts).

export type Kind = 'nmr' | 'mnova' | 'jcamp' | 'ms' | 'hplc' | 'ir' | 'xrd' | 'cif' | 'pdf' | 'image' | 'other';
export const KINDS: Kind[] = ['nmr', 'mnova', 'jcamp', 'ms', 'hplc', 'ir', 'xrd', 'cif', 'pdf', 'image', 'other'];

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
}

export interface UploadMeta {
  filename: string;
  kind: Kind;
  compoundId?: string;
  note?: string;
  meta?: Record<string, unknown>;
}

export const fileUrl = (id: string, download = false) => `/api/attachments/${encodeURIComponent(id)}/file${download ? '?download' : ''}`;
export const previewUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}/preview`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const listAttachments = (reactionId: string) =>
  call<Attachment[]>(`/api/reactions/${encodeURIComponent(reactionId)}/attachments`);

export const updateAttachment = (id: string, patch: Partial<Pick<Attachment, 'note' | 'kind' | 'meta'>> & { compoundId?: string | null }) =>
  call<Attachment>(`/api/attachments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const deleteAttachment = (id: string) => call<void>(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });

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
    xhr.open('POST', `/api/reactions/${encodeURIComponent(reactionId)}/attachments`);
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
