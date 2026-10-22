// Read the processed 1D spectrum and metadata out of an uploaded Bruker zip.
import { nmrMetaFrom, parseParams, pickProcno, readSpectrum1r, type NmrMeta, type Spectrum } from './bruker';
import { unzipSome } from './zip';

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder('latin1').decode(b) : undefined);

export interface BrukerData {
  meta: NmrMeta;
  spectrum?: Spectrum;
}

export function brukerFromZip(zip: Uint8Array): BrukerData {
  const wanted = /(^|\/)(acqus|acqu2s|procs|1r|title)$/;
  const entries = unzipSome(zip, (p) => wanted.test(p));
  const paths = Object.keys(entries);
  const acqusPath = paths.filter((p) => p.endsWith('acqus')).sort((a, b) => a.length - b.length)[0];
  if (!acqusPath) throw new Error('not a Bruker dataset (no acqus)');
  const root = acqusPath.slice(0, acqusPath.length - 'acqus'.length);
  const rel = (p: string) => p.slice(root.length);
  const inRoot = paths.filter((p) => p.startsWith(root));
  const procno = pickProcno(inRoot.map(rel));
  const titlePath = procno ? `${root}pdata/${procno}/title` : undefined;
  const meta = nmrMetaFrom(
    parseParams(text(entries[acqusPath])!),
    entries[`${root}acqu2s`] ? parseParams(text(entries[`${root}acqu2s`])!) : undefined,
    titlePath ? text(entries[titlePath]) : undefined,
  );
  const parts = root.split('/').filter(Boolean);
  meta.expno = parts[parts.length - 1];
  meta.sample = parts.length > 1 ? parts[parts.length - 2] : undefined;
  let spectrum: Spectrum | undefined;
  if (procno && meta.dims === 1) {
    const r = entries[`${root}pdata/${procno}/1r`];
    const procs = entries[`${root}pdata/${procno}/procs`];
    if (r && procs) spectrum = readSpectrum1r(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer, parseParams(text(procs)!));
  }
  return { meta, spectrum };
}
