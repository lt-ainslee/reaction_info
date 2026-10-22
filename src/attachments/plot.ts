// Drawing 1D spectra: SVG path for the viewer, PNG for stored thumbnails.
import { downsample, type Spectrum } from './bruker';

export interface Frame {
  /** ppm at the left / right edge (left > right, NMR convention). */
  left: number;
  right: number;
  width: number;
  height: number;
  pad?: number;
}

/** SVG path data, y scaled to the tallest point in the window. */
export function spectrumPath(s: Spectrum, f: Frame): string {
  const pad = f.pad ?? 4;
  const { x, y } = downsample(s, Math.max(100, Math.round(f.width)), [f.left, f.right]);
  if (!x.length) return '';
  const ymax = Math.max(...y);
  const ymin = Math.min(0, ...y);
  const span = ymax - ymin || 1;
  const sx = (ppm: number) => ((f.left - ppm) / (f.left - f.right)) * f.width;
  const sy = (v: number) => f.height - pad - ((v - ymin) / span) * (f.height - 2 * pad);
  let d = '';
  for (let i = 0; i < x.length; i++) d += `${i ? 'L' : 'M'}${sx(x[i]).toFixed(1)} ${sy(y[i]).toFixed(1)}`;
  return d;
}

/** Visible ppm range: drops long flat edges so the thumbnail shows the signals. */
export function autoRange(s: Spectrum): [number, number] {
  const n = s.intensity.length;
  if (!n) return [0, 0];
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(s.intensity[i]));
  const thr = max * 0.01;
  let a = 0;
  let b = n - 1;
  while (a < b && Math.abs(s.intensity[a]) < thr) a++;
  while (b > a && Math.abs(s.intensity[b]) < thr) b--;
  const margin = (s.ppm[0] - s.ppm[n - 1]) * 0.03;
  return [Math.min(s.ppm[0], s.ppm[a] + margin), Math.max(s.ppm[n - 1], s.ppm[b] - margin)];
}

/** Nice axis ticks for a ppm window. */
export function ticks(left: number, right: number, target = 8): number[] {
  const span = Math.abs(left - right);
  if (!span) return [];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(right / step) * step; v <= left + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out.reverse();
}

/** Render a thumbnail PNG (browser only). */
export async function thumbnailPng(s: Spectrum, width = 480, height = 160): Promise<Blob> {
  const [left, right] = autoRange(s);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#1d2330';
  ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D(spectrumPath(s, { left, right, width, height: height - 18, pad: 6 })));
  ctx.fillStyle = '#6b7282';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (const t of ticks(left, right, 6)) {
    const x = ((left - t) / (left - right)) * width;
    ctx.fillRect(x, height - 18, 1, 4);
    ctx.fillText(String(t), Math.min(width - 12, Math.max(12, x)), height - 4);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}
