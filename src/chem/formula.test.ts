import { describe, expect, it } from 'vitest';
import { formulaMass, hillFormula, parseFormula } from './formula';

describe('parseFormula', () => {
  it('handles simple, grouped and hydrate formulas', () => {
    expect(parseFormula('C6H5Br')).toEqual({ C: 6, H: 5, Br: 1 });
    expect(parseFormula('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(parseFormula('[Cu(NH3)4]SO4')).toEqual({ Cu: 1, N: 4, H: 12, S: 1, O: 4 });
    expect(parseFormula('CuSO4·5H2O')).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(parseFormula('CuSO4.5H2O')).toEqual(parseFormula('CuSO4·5H2O'));
  });

  it('rejects malformed input', () => {
    expect(parseFormula('')).toBeNull();
    expect(parseFormula('Xx2')).toBeNull();
    expect(parseFormula('C6(H5')).toBeNull();
    expect(parseFormula('benzene')).toBeNull();
  });
});

describe('formulaMass', () => {
  it('matches reference molar masses', () => {
    expect(formulaMass('H2O')).toBeCloseTo(18.015, 2);
    expect(formulaMass('C7H6O2')).toBeCloseTo(122.12, 1); // benzoic acid
    expect(formulaMass('C72H60P4Pd')).toBeCloseTo(1155.59, 0);
  });
});

describe('hillFormula', () => {
  it('orders C, H, then alphabetical', () => {
    expect(hillFormula({ O: 2, H: 6, C: 7 })).toBe('C7H6O2');
    expect(hillFormula({ Na: 1, Cl: 1 })).toBe('ClNa');
    expect(hillFormula({ Br: 1, C: 6, H: 5 })).toBe('C6H5Br');
  });
});

import { parseDensity } from './pubchem';

describe('parseDensity', () => {
  it('reads common PubChem density strings', () => {
    expect(parseDensity(['Relative vapor density (air = 1): 2.5', '1.2659 g/cu cm at 15 °C'])?.value).toBe(1.2659);
    expect(parseDensity(['789 kg/m3'])?.value).toBeCloseTo(0.789);
    expect(parseDensity(['no data'])).toBeUndefined();
  });
});

import { fmt } from '../units';

describe('fmt', () => {
  it('keeps 4 significant figures without trailing zeros', () => {
    expect(fmt(1221.2)).toBe('1221');
    expect(fmt(0.012345)).toBe('0.01235');
    expect(fmt(4.4)).toBe('4.4');
    expect(fmt(12000)).toBe('12000');
    expect(fmt(undefined)).toBe('');
  });
});
