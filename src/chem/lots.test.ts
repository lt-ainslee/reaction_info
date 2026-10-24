import { describe, expect, it } from 'vitest';
import { normalizeReaction } from '../storage/schema';
import { applyLot, compoundKey, lotFromComponent, lotLabel, normalizeLot, normalizeSnapshot } from './lots';
import { extractDoi, formatReference, fromCrossref } from './refs';
import { addRun, runsOf, withRuns } from './runs';
import { newComponent } from './stoich';

const buli = { ...newComponent({ name: 'n-BuLi', role: 'reagent', mw: 64.06, form: 'solutionM', molarity: 2.5 }), id: 'b' };
const solid = { ...newComponent({ name: 'K2CO3', role: 'reagent', mw: 138.2, cas: '584-08-7' }), id: 'k' };

describe('reagent lots', () => {
  it('keys compounds by CAS, then SMILES, then name', () => {
    expect(compoundKey(solid)).toBe('cas:584-08-7');
    expect(compoundKey({ name: 'X', smiles: 'CCO' })).toBe('smi:CCO');
    expect(compoundKey({ name: ' n-BuLi ' })).toBe('name:n-buli');
  });

  it('feeds titrated concentration and measured purity into the component', () => {
    expect(applyLot(buli, { supplier: 'Energy', molarity: 2.31 }, 'L1')).toEqual({ lot: { supplier: 'Energy', molarity: 2.31, lotId: 'L1' }, molarity: 2.31 });
    expect(applyLot(solid, { purity: 97.5 })).toMatchObject({ purity: 97.5 });
    expect(applyLot(solid, { molarity: 2 }).molarity).toBeUndefined();
  });

  it('builds library lots and labels', () => {
    const c = { ...solid, lot: { supplier: 'Adamas', catalogNumber: 'A123', lotNumber: 'P2304', verification: 'ok' as const } };
    const lot = lotFromComponent(c, 'L9', 5);
    expect(lot).toMatchObject({ id: 'L9', key: 'cas:584-08-7', name: 'K2CO3', supplier: 'Adamas', verification: 'ok', createdAt: 5 });
    expect(lotLabel(lot)).toBe('Adamas · A123 · lot P2304');
    expect(lotLabel({ source: 'made', sourceLabel: 'RXN-001' }, '自制')).toBe('自制 · RXN-001');
    const bad = normalizeLot({ ...lot, verification: 'bogus', purity: -3 })!;
    expect(bad.id).toBe('L9');
    expect('verification' in bad || 'purity' in bad).toBe(false);
    expect(normalizeSnapshot({ supplier: '', lotId: 'bad id!' })).toBeUndefined();
  });

  it('keeps the lot when a run is copied, and survives storage', () => {
    let r = withRuns({ title: 'T', refId: 'k', refMmol: 1, components: [{ ...solid, lot: { supplier: 'TCI', lotId: 'L1' }, actualNote: '1.38 g' }] });
    r = addRun(r);
    expect(r.components[0].lot).toEqual({ supplier: 'TCI', lotId: 'L1' });
    expect(r.components[0].actualNote).toBeUndefined();
    const back = normalizeReaction(JSON.parse(JSON.stringify(r)))!;
    expect(runsOf(back)[0].data.components[0]).toMatchObject({ lot: { supplier: 'TCI', lotId: 'L1' }, actualNote: '1.38 g' });
  });
});

describe('references', () => {
  it('finds DOIs in links and text', () => {
    expect(extractDoi('https://doi.org/10.1021/jacs.0c01234')).toBe('10.1021/jacs.0c01234');
    expect(extractDoi('see doi:10.1002/anie.202012345.')).toBe('10.1002/anie.202012345');
    expect(extractDoi('no doi here')).toBeUndefined();
  });

  it('formats Crossref data ACS-style', () => {
    const r = fromCrossref({
      title: ['A <i>Nice</i> Coupling'],
      author: [{ given: 'Jane Ann', family: 'Smith' }, { given: 'Li', family: 'Wang' }],
      'short-container-title': ['J. Am. Chem. Soc.'],
      issued: { 'date-parts': [[2020, 3]] },
      volume: '142',
      issue: '3',
      page: '1234-1240',
      DOI: '10.1021/jacs.0c01234',
    });
    expect(formatReference({ id: 'x', ...r })).toBe('Smith, J. A.; Wang, L. A Nice Coupling. J. Am. Chem. Soc. 2020, 142 (3), 1234–1240.');
    expect(formatReference({ id: 'y', citation: 'CN 112345678 A' })).toBe('CN 112345678 A');
  });

  it('stores references at the reaction level', () => {
    const r = normalizeReaction({ title: '', refId: null, refMmol: 1, components: [], references: [{ id: 'a', doi: '10.1/x', url: 'javascript:1', year: 3 }, { nope: 1 }] })!;
    expect(r.references).toEqual([{ id: 'a', doi: '10.1/x' }]);
  });
});

describe('inventory', () => {
  it('turns a bottle into a component ready for the calculator', async () => {
    const { componentFromLot } = await import('./lots');
    const d = componentFromLot({
      id: 'L1', key: 'name:n-buli', name: 'n-BuLi', supplier: 'Energy', spec: '2.5 M in hexanes', molarity: 2.31,
      compound: { formula: 'C4H9Li', mw: 64.06, form: 'solutionM', molarity: 2.5, solutionDensity: 0.68 }, createdAt: 0, updatedAt: 0,
    });
    expect(d).toMatchObject({ name: 'n-BuLi', mw: 64.06, form: 'solutionM', molarity: 2.31, solutionDensity: 0.68, lot: { lotId: 'L1', supplier: 'Energy', molarity: 2.31 } });
  });

  it('imports spreadsheets with Chinese headers', async () => {
    const { parseCsv, rowsToLots } = await import('../inventory/importTable');
    const rows = parseCsv('﻿试剂名称,CAS号,品牌,货号,批号,包装,存放位置,状态,入库日期,备注\n溴苯,108-86-1,Adamas,A1,"P2304",500 g,4号柜B层,在用,2026/3/5,"含, 逗号"\n,,,,,,,,,\n乙酸乙酯,141-78-6,国药,,,"2.5 L",溶剂柜,已用完,,\n');
    let n = 0;
    const { lots, fields } = rowsToLots(rows, () => `x${++n}`, 1);
    expect(fields).toEqual(['name', 'cas', 'supplier', 'catalogNumber', 'lotNumber', 'quantity', 'location', 'status', 'receivedAt', 'note']);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toMatchObject({ name: '溴苯', cas: '108-86-1', key: 'cas:108-86-1', supplier: 'Adamas', lotNumber: 'P2304', location: '4号柜B层', status: 'in_stock', receivedAt: '2026-03-05', note: '含, 逗号' });
    expect(lots[1].status).toBe('empty');
  });
});
