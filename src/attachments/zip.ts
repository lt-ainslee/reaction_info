// Zip / unzip in the browser (fflate). Spectra are already compressed poorly,
// so a low level keeps it fast.
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { PickedFile } from './bruker';

export async function zipFiles(files: PickedFile[], stripPrefix = ''): Promise<Uint8Array> {
  const tree: Zippable = {};
  for (const f of files) {
    const path = stripPrefix && f.path.startsWith(stripPrefix) ? f.path.slice(stripPrefix.length) : f.path;
    tree[path] = [new Uint8Array(await f.file.arrayBuffer()), { level: 1 }];
  }
  return zipSync(tree);
}

/** Unzip only the entries `want` accepts (by path). */
export function unzipSome(data: Uint8Array, want: (path: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(data, { filter: (f) => want(f.name) });
}
