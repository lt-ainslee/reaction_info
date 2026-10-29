// @vitest-environment happy-dom
import initRDKit, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCdxml } from './cdxml';
import { richText, schemeCdxml, schemeRxnfile, schemeSvg } from './scheme';
import { newComponent, type Reaction } from './stoich';

let rd: MainModule;
beforeAll(async () => {
  rd = await initRDKit();
});

const rxn = (): Reaction => {
  const c = (id: string, p: Parameters<typeof newComponent>[0]) => ({ ...newComponent(p), id });
  return {
    title: 'Suzuki',
    refId: 'a',
    refMmol: 1,
    conditions: '90 °C, 12 h',
    components: [
      c('a', { name: '4-bromonitrobenzene', role: 'reactant', smiles: 'O=[N+]([O-])c1ccc(Br)cc1' }),
      c('b', { name: 'PhB(OH)2', role: 'reactant', smiles: 'OB(O)c1ccccc1' }),
      c('k', { name: 'K2CO3', role: 'reagent', formula: 'K2CO3', equiv: 2 }),
      c('pd', { name: 'Pd(PPh3)4', role: 'catalyst', equiv: 0.05 }),
      c('s', { name: '1,4-dioxane/H2O', role: 'solvent' }),
      c('p', { name: '4-nitrobiphenyl', role: 'product', smiles: 'O=[N+]([O-])c1ccc(-c2ccccc2)cc1' }),
    ],
  };
};

describe('rich text', () => {
  it('subscripts formula digits only', () => {
    expect(richText('Pd(PPh3)4 (5 mol%)')).toEqual([{ text: 'Pd(PPh' }, { text: '3', sub: true }, { text: ')' }, { text: '4', sub: true }, { text: ' (5 mol%)' }]);
    expect(richText('1,4-dioxane/H2O')).toEqual([{ text: '1,4-dioxane/H' }, { text: '2', sub: true }, { text: 'O' }]);
    expect(richText('90 °C, 12 h')).toEqual([{ text: '90 °C, 12 h' }]);
  });
});

describe('scheme export', () => {
  it('draws one black-and-white SVG', () => {
    const out = schemeSvg(rd, rxn())!;
    expect(out.svg).toMatch(/^<svg [^>]*width="[\d.]+pt"/);
    const colours = new Set(out.svg.match(/#[0-9A-Fa-f]{6}\b/g));
    expect([...colours]).toEqual(['#000000']);
    expect(out.svg).toContain('4-nitrobiphenyl');
    expect(out.svg).toContain('mol%');
    expect(out.svg).not.toContain('data-cid');
    expect(schemeSvg(rd, rxn(), { interactive: true })!.svg).toContain('data-cid="pd"');
    const doc = new DOMParser().parseFromString(out.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  it('draws the coloured styles', () => {
    const colours = (svg: string) => new Set(svg.match(/#[0-9A-Fa-f]{6}\b/g));
    const cd = schemeSvg(rd, rxn(), { style: 'cdcolor' })!;
    expect(colours(cd.svg).has('#FF0000')).toBe(true); // oxygen
    // Classic: same-size boxes (wider than the ACS drawing), names in grey.
    const classic = schemeSvg(rd, rxn(), { style: 'color' })!;
    expect(colours(classic.svg).has('#FF0000')).toBe(true);
    expect(classic.svg).toContain('fill="#555555"');
    expect(classic.width).toBeGreaterThan(cd.width);
    expect(classic.svg.match(/<g transform="scale\(/g)).toHaveLength(3);
  });

  it('writes CDXML that reads back as the same reaction', () => {
    const xml = schemeCdxml(rd, rxn())!;
    const back = parseCdxml(xml)!;
    expect(back.isReaction).toBe(true);
    expect(back.reactants).toHaveLength(2);
    expect(back.products).toHaveLength(1);
    expect(back.above.map((e) => e.text).join(' ')).toContain('Pd(PPh3)4');
    expect(back.below.map((e) => e.text).join(' ')).toContain('90 °C');
    const smi = (mb: string) => {
      const m = rd.get_mol(mb)!;
      const s = m.get_smiles();
      m.delete();
      return s;
    };
    const canon = (s: string) => smi(s);
    expect(smi(back.products[0].molblock!)).toBe(canon('O=[N+]([O-])c1ccc(-c2ccccc2)cc1'));
    expect(smi(back.reactants[1].molblock!)).toBe(canon('OB(O)c1ccccc1'));
  });

  it('writes an RXN file of the structures', () => {
    const f = schemeRxnfile(rd, rxn())!;
    expect(f.startsWith('$RXN')).toBe(true);
    expect(f.split('\n')[4]).toBe('  2  1');
    expect(f.match(/\$MOL/g)).toHaveLength(3);
  });

  it('returns nothing for an empty reaction', () => {
    expect(schemeSvg(rd, { ...rxn(), components: [], conditions: '' })).toBeNull();
  });
});
