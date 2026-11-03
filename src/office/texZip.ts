// The LaTeX export as one zip: <code>.tex, kamidoc.cls and the scheme
// (transparent PNG for \includegraphics on the tinted page, SVG to keep the
// vector original). Browser only.
import { zipSync, type Zippable } from 'fflate';
import type { MainModule } from '@rdkit/rdkit';
import { schemeSvg, svgToPng, unitsToPt, type ReportLook, type SchemeLabels } from '../chem/scheme';
import { today } from '../chem/runs';
import { texFileName, texReport, type TexInput } from './tex';
import kamidoc from './tex/kamidoc.cls?raw';

export async function texZip(input: Omit<TexInput, 'scheme' | 'today'> & { rd: MainModule | null; labels?: SchemeLabels; look?: ReportLook }): Promise<Blob> {
  const { rd, labels, look, ...rest } = input;
  const enc = new TextEncoder();
  const files: Zippable = { 'kamidoc.cls': enc.encode(kamidoc) };
  let scheme: TexInput['scheme'] = null;
  const out = schemeSvg(rd, rest.rxn, { background: false, labels, style: look });
  if (out) {
    const png = await svgToPng(out.svg, out.width, out.height, 6, null).catch(() => null);
    if (png) {
      files['scheme.png'] = new Uint8Array(await png.arrayBuffer());
      files['scheme.svg'] = enc.encode(out.svg);
      scheme = { file: 'scheme.png', widthPt: unitsToPt(out.width) };
    }
  }
  files[`${texFileName(rest.rxn)}.tex`] = enc.encode(texReport({ ...rest, scheme, today: today() }));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
