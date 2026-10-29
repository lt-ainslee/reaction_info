// Files picked or dropped for upload, with their folder paths (Bruker data
// sets are folders). System clutter (.DS_Store, Thumbs.db…) is left out.
import type { PickedFile } from './bruker';

const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

/** Files from <input webkitdirectory> or a plain multi-file input. */
export const fromInput = (list: FileList): PickedFile[] =>
  [...list].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })).filter((f) => !IGNORED.test(f.path));

/** Files (recursively) from a drag-and-drop, folders included. */
export async function fromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const readAll = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = dir.createReader();
      const acc: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(acc);
          acc.push(...batch);
          next();
        }, reject);
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
