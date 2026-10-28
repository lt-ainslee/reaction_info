// @vitest-environment happy-dom
import initRDKit, { type MainModule } from '@rdkit/rdkit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { abbrOf, autoAbbr, builtinAbbr, entryByAbbr, nameWithAbbr, normalizeAbbr, searchAbbrs, setAbbrTable, withAbbrs, type AbbrEntry } from './abbr';
import { LIBRARY } from './library';
import { parseInputText } from './parseInput';
import { resolveOne, resolveParsed } from './resolve';
import { schemeSvg } from './scheme';
import { newComponent, type Reaction } from './stoich';

let rd: MainModule;
beforeAll(async () => {
  rd = await initRDKit();
});
afterEach(() => setAbbrTable([]));

const entry = (id: string, abbr: string, p: Partial<AbbrEntry>): AbbrEntry => ({ id, abbr, name: abbr, createdAt: 1, updatedAt: 1, ...p });
const lib = (en: string) => LIBRARY.find((e) => e.en === en)!;

describe('built-in abbreviations', () => {
  it('takes abbreviation-like aliases only', () => {
    expect(builtinAbbr(lib('Tetrahydrofuran'))).toBe('THF');
    expect(builtinAbbr(lib('Dichloromethane'))).toBe('DCM');
    expect(builtinAbbr(lib('Triethylamine'))).toBe('TEA');
    expect(builtinAbbr(lib('1,4-Dioxane'))).toBeUndefined();
    expect(builtinAbbr(lib('Chloroform'))).toBe('CHCl3');
  });

  it('finds them by CAS or structure, not when the name already is the abbreviation', () => {
    expect(autoAbbr(rd, { name: 'Tetrahydrofuran', cas: '109-99-9' })).toBe('THF');
    expect(autoAbbr(rd, { name: 'oxolane', smiles: 'O1CCCC1' })).toBe('THF');
    expect(autoAbbr(rd, { name: 'THF', cas: '109-99-9' })).toBeUndefined();
    expect(autoAbbr(rd, { name: 'something', smiles: 'CCCCCCCCO' })).toBeUndefined();
  });
});

describe('abbreviation table', () => {
  const sm = entry('a1', 'SM-1', { name: '4-bromoaniline', smiles: 'Nc1ccc(Br)cc1' });

  it('validates entries', () => {
    expect(normalizeAbbr({ id: 'x', abbr: ' 1a ', name: 'foo' })).toMatchObject({ abbr: '1a', name: 'foo' });
    expect(normalizeAbbr({ id: 'x', abbr: '', name: 'foo' })).toBeNull();
    expect(normalizeAbbr({ id: 'bad id', abbr: 'A', name: 'foo' })).toBeNull();
  });

  it('wins over the library and loses to the component', () => {
    setAbbrTable([sm, entry('a2', 'oxolane', { name: 'Tetrahydrofuran', cas: '109-99-9' })]);
    const c = (p: Parameters<typeof newComponent>[0]) => ({ ...newComponent(p), id: 'c' });
    // Same structure written differently.
    expect(abbrOf(rd, c({ name: 'p-bromoaniline', role: 'reactant', smiles: 'Brc1ccc(N)cc1' }))).toBe('SM-1');
    expect(abbrOf(rd, c({ name: 'THF', role: 'solvent', cas: '109-99-9' }))).toBe('oxolane');
    expect(abbrOf(rd, { ...c({ name: 'x', role: 'reactant', smiles: 'Nc1ccc(Br)cc1' }), abbr: '1a' })).toBe('1a');
    expect(abbrOf(rd, { ...c({ name: 'x', role: 'reactant', smiles: 'Nc1ccc(Br)cc1' }), abbr: '' })).toBeUndefined();
  });

  it('looks up abbreviations, exact case first', () => {
    const bn = entry('b1', 'Bn', { name: 'benzyl' });
    const BN = entry('b2', 'BN', { name: 'boron nitride' });
    expect(entryByAbbr('BN', [bn, BN])).toBe(BN);
    expect(entryByAbbr('bn', [bn, BN])).toBe(bn);
    expect(searchAbbrs('sm', 6, [sm]).map((e) => e.id)).toEqual(['a1']);
    expect(searchAbbrs('bromoaniline', 6, [sm]).map((e) => e.id)).toEqual(['a1']);
  });

  it('resolves abbreviations typed in an equation', async () => {
    setAbbrTable([sm, entry('p1', 'P', { name: 'tert-butyl (4-bromophenyl)carbamate', smiles: 'CC(C)(C)OC(=O)Nc1ccc(Br)cc1' })]);
    // "P" would otherwise read as the SMILES of phosphorus.
    expect((await resolveOne('P', rd, 'en'))?.name).toBe('tert-butyl (4-bromophenyl)carbamate');
    const parsed = parseInputText(rd, 'SM-1 -> P')!;
    const r = await resolveParsed(parsed, rd, 'en');
    expect(r.failed).toEqual([]);
    expect(r.items.map((i) => [i.role, i.data.smiles])).toEqual([
      ['reactant', 'Nc1ccc(Br)cc1'],
      ['product', 'CC(C)(C)OC(=O)Nc1ccc(Br)cc1'],
    ]);
  });
});

describe('in the scheme', () => {
  const rxn = (): Reaction => {
    const c = (id: string, p: Parameters<typeof newComponent>[0]) => ({ ...newComponent(p), id });
    return {
      title: '',
      refId: 'a',
      refMmol: 1,
      conditions: '',
      components: [
        c('a', { name: '4-bromoaniline', role: 'reactant', smiles: 'Nc1ccc(Br)cc1' }),
        c('s', { name: 'Tetrahydrofuran', role: 'solvent', cas: '109-99-9' }),
        c('p', { name: 'product', role: 'product', smiles: 'CC(C)(C)OC(=O)Nc1ccc(Br)cc1' }),
      ],
    };
  };

  it('writes abbreviations or names', () => {
    setAbbrTable([entry('a1', 'SM-1', { name: '4-bromoaniline', smiles: 'Nc1ccc(Br)cc1' })]);
    const shown = withAbbrs(rd, rxn());
    expect(shown.components.map((c) => c.abbr)).toEqual(['SM-1', 'THF', '']);
    expect(nameWithAbbr(shown.components[1])).toBe('Tetrahydrofuran (THF)');
    const abbr = schemeSvg(rd, shown)!.svg;
    expect(abbr).toContain('SM-1');
    expect(abbr).toContain('>THF<');
    expect(abbr).not.toContain('4-bromoaniline');
    const names = schemeSvg(rd, shown, { labels: 'name' })!.svg;
    expect(names).toContain('4-bromoaniline');
    expect(names).toContain('Tetrahydrofuran');
  });
});
