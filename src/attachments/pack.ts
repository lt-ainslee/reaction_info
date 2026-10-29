// "Download with downstream": one zip with a node's files and everything below it.
import { zipSync, strToU8, type Zippable } from 'fflate';
import { fileUrl, type Attachment } from './api';
import { displayName, nodeTypeOf } from './graph';

export async function packNodes(nodes: Attachment[]): Promise<Blob> {
  const tree: Zippable = {};
  const used = new Set<string>();
  const unique = (name: string) => {
    let n = name;
    for (let i = 2; used.has(n); i++) n = name.replace(/(\.[^.]*)?$/, (ext) => `_${i}${ext ?? ''}`);
    used.add(n);
    return n;
  };
  for (const n of nodes) {
    if (n.hasFile) {
      const res = await fetch(fileUrl(n.id));
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${n.filename}`);
      tree[unique(n.filename)] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
    } else if (nodeTypeOf(n) === 'peaklist' && typeof n.meta.text === 'string' && n.meta.text.trim()) {
      tree[unique(`${displayName(n)}.txt`.replace(/[\\/:*?"<>|]/g, '_'))] = strToU8(n.meta.text);
    }
  }
  return new Blob([zipSync(tree) as BlobPart], { type: 'application/zip' });
}

