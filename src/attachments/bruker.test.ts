import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  downsample, findExperiments, nmrMetaFrom, parseParams, pickProcno, prettyNucleus, prettySolvent,
  readSpectrum1r, siPrefix, type PickedFile,
} from './bruker';
import { brukerFromZip } from './spectrumFromZip';

const ACQUS = `##TITLE= Parameter file, TopSpin 4.3.0
##$NUC1= <1H>
##$NUC2= <off>
##$SOLVENT= <CDCl3>
##$SFO1= 400.1324708
##$BF1= 400.13
##$PULPROG= <zg30>
##$DATE= 1729500000
##$TE= 298.1
##$NS= 16
##END=`;

/** Synthetic processed spectrum: SI points from OFFSET downwards, Lorentzian peaks. */
function makeProcessed(si = 4096, peaks: [number, number][] = [[7.26, 1e6], [2.17, 3e6]], opts: { little?: boolean; nc?: number } = {}) {
  const offset = 12, swp = 8000, sf = 400.13;
  const step = swp / sf / si;
  const nc = opts.nc ?? -2;
  const buf = new ArrayBuffer(si * 4);
  const view = new DataView(buf);
  for (let i = 0; i < si; i++) {
    const ppm = offset - i * step;
    let y = 0;
    for (const [p, h] of peaks) y += h / (1 + ((ppm - p) / 0.01) ** 2);
    view.setInt32(i * 4, Math.round(y / 2 ** nc), opts.little ?? true);
  }
  const procs = `##$SI= ${si}\n##$OFFSET= ${offset}\n##$SW_p= ${swp}\n##$SF= ${sf}\n##$BYTORDP= ${opts.little === false ? 1 : 0}\n##$DTYPP= 0\n##$NC_proc= ${nc}\n`;
  return { buf, procs, step };
}

describe('parameters and metadata', () => {
  it('parses JCAMP-style parameter files', () => {
    const p = parseParams(ACQUS);
    expect(p.NUC1).toBe('1H');
    expect(p.SOLVENT).toBe('CDCl3');
    expect(Number(p.SFO1)).toBeCloseTo(400.13, 2);
  });

  it('builds metadata and SI prefix', () => {
    const m = nmrMetaFrom(parseParams(ACQUS), undefined, 'BH-042 crude\nline 2');
    expect(m).toMatchObject({ nucleus: '1H', solvent: 'CDCl3', fieldMHz: 400, pulseProgram: 'zg30', dims: 1, title: 'BH-042 crude' });
    expect(m.acquiredAt).toBe(1729500000000);
    expect(siPrefix(m)).toBe('¹H NMR (400 MHz, CDCl₃) δ ');
    const c13 = nmrMetaFrom(parseParams(ACQUS.replace('<1H>', '<13C>').replace('400.1324708', '100.6228')));
    expect(siPrefix(c13)).toBe('¹³C NMR (101 MHz, CDCl₃) δ ');
    const hsqc = nmrMetaFrom(parseParams(ACQUS), parseParams('##$NUC1= <13C>'));
    expect(hsqc).toMatchObject({ dims: 2, nucleus: '1H/13C' });
    expect(siPrefix(hsqc)).toBeUndefined();
  });

  it('prettifies nuclei and solvents', () => {
    expect(prettyNucleus('19F')).toBe('¹⁹F');
    expect(prettySolvent('DMSO')).toBe('DMSO-d₆');
    expect(prettySolvent('C6D6')).toBe('C₆D₆');
  });
});

describe('finding experiments', () => {
  const f = (path: string): PickedFile => ({ path, file: new Blob([path]) });
  it('splits a sample folder into experiments and keeps nested files with their closest root', () => {
    const files = [
      f('BH-042/1/acqus'), f('BH-042/1/fid'), f('BH-042/1/pdata/1/1r'), f('BH-042/1/pdata/1/procs'),
      f('BH-042/2/acqus'), f('BH-042/2/acqu2s'), f('BH-042/2/ser'),
      f('BH-042/notes.txt'),
    ];
    const ex = findExperiments(files);
    expect(ex.map((e) => [e.root, e.expno, e.sample, e.files.length])).toEqual([
      ['BH-042/1', '1', 'BH-042', 4],
      ['BH-042/2', '2', 'BH-042', 3],
    ]);
    expect(findExperiments([f('a/b.txt')])).toEqual([]);
  });

  it('picks the lowest procno that has a 1r', () => {
    expect(pickProcno(['pdata/2/1r', 'pdata/1/procs', 'pdata/10/1r'])).toBe('2');
    expect(pickProcno(['fid'])).toBeUndefined();
  });
});

describe('processed spectrum', () => {
  it('decodes 1r with scaling and ppm axis, both byte orders', () => {
    for (const little of [true, false]) {
      const { buf, procs, step } = makeProcessed(4096, undefined, { little });
      const s = readSpectrum1r(buf, parseParams(procs));
      expect(s.ppm[0]).toBe(12);
      expect(s.ppm[1]).toBeCloseTo(12 - step, 9);
      let iMax = 0;
      for (let i = 0; i < s.intensity.length; i++) if (s.intensity[i] > s.intensity[iMax]) iMax = i;
      expect(s.ppm[iMax]).toBeCloseTo(2.17, 1);
      expect(s.intensity[iMax]).toBeGreaterThan(2.5e6);
    }
  });

  it('downsamples keeping peak maxima and honours a window', () => {
    const { buf, procs } = makeProcessed(65536);
    const s = readSpectrum1r(buf, parseParams(procs));
    const d = downsample(s, 500);
    expect(d.x.length).toBeLessThanOrEqual(1000);
    expect(Math.max(...d.y)).toBeGreaterThan(2.9e6);
    const w = downsample(s, 200, [8, 6]);
    expect(Math.max(...w.x)).toBeLessThanOrEqual(8);
    expect(Math.min(...w.x)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...w.y)).toBeGreaterThan(0.9e6); // the 7.26 peak
  });

  it('reads metadata and spectrum from an uploaded zip', () => {
    const { buf, procs } = makeProcessed();
    const zip = zipSync({
      'BH-042/1/acqus': strToU8(ACQUS),
      'BH-042/1/fid': new Uint8Array(8),
      'BH-042/1/pdata/1/procs': strToU8(procs),
      'BH-042/1/pdata/1/1r': new Uint8Array(buf),
      'BH-042/1/pdata/1/title': strToU8('crude product'),
    });
    const d = brukerFromZip(zip);
    expect(d.meta).toMatchObject({ nucleus: '1H', expno: '1', sample: 'BH-042', title: 'crude product' });
    expect(d.spectrum?.ppm.length).toBe(4096);
    expect(() => brukerFromZip(zipSync({ 'x.txt': strToU8('hi') }))).toThrow();
  });
});

import { autoRange, spectrumPath, ticks } from './plot';
import { formatSize, kindFromName } from './api';

describe('plotting helpers', () => {
  it('ticks cover the window in descending order', () => {
    expect(ticks(10, 0, 5)).toEqual([10, 8, 6, 4, 2, 0]);
    expect(ticks(7.5, 7.0, 5)).toEqual([7.5, 7.4, 7.3, 7.2, 7.1, 7]);
  });

  it('auto range trims flat edges and the path is drawable', () => {
    const { buf, procs } = makeProcessed(8192);
    const s = readSpectrum1r(buf, parseParams(procs));
    const [l, r] = autoRange(s);
    expect(l).toBeLessThan(12);
    expect(l).toBeGreaterThan(7.26);
    expect(r).toBeLessThan(2.17);
    const d = spectrumPath(s, { left: l, right: r, width: 400, height: 100 });
    expect(d.startsWith('M')).toBe(true);
    expect(d.split('L').length).toBeGreaterThan(100);
  });

  it('classifies files and formats sizes', () => {
    expect(kindFromName('BH-042 1H.MNOVA')).toBe('mnova');
    expect(kindFromName('hrms.pdf')).toBe('pdf');
    expect(kindFromName('spectrum.jdx')).toBe('jcamp');
    expect(kindFromName('notes')).toBe('other');
    expect(formatSize(5_300_000)).toBe('5.1 MB');
  });
});
