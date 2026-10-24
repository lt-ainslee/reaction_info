// Small helpers for writing Office Open XML packages (.docx / .xlsx) by hand.
import { strToU8, zipSync, type Zippable } from 'fflate';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Escape text for XML, dropping characters XML 1.0 can't hold. */
export const x = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (c) => ESC[c]);

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Zip package parts (path → XML string or bytes). */
export function pack(parts: Record<string, string | Uint8Array>, type: string): Blob {
  const tree: Zippable = {};
  for (const [path, data] of Object.entries(parts)) tree[path] = typeof data === 'string' ? strToU8(data) : data;
  return new Blob([zipSync(tree, { level: 6 }) as BlobPart], { type });
}
