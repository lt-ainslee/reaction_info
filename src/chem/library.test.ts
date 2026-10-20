import { describe, expect, it } from 'vitest';
import { exactLibraryMatch, LIBRARY, searchLibrary } from './library';
import { parseFormula } from './formula';

describe('library', () => {
  it('every entry has a parseable formula and a valid CAS checksum', () => {
    for (const e of LIBRARY) {
      expect(parseFormula(e.formula), e.en).not.toBeNull();
      const digits = e.cas.replace(/-/g, '');
      const body = digits.slice(0, -1).split('').reverse();
      const sum = body.reduce((s, d, i) => s + Number(d) * (i + 1), 0);
      expect(sum % 10, `${e.en} ${e.cas}`).toBe(Number(digits.at(-1)));
    }
  });

  it('finds by Chinese name, abbreviation and CAS', () => {
    expect(exactLibraryMatch('二氯甲烷')?.en).toBe('Dichloromethane');
    expect(exactLibraryMatch('dcm')?.en).toBe('Dichloromethane');
    expect(exactLibraryMatch('75-09-2')?.en).toBe('Dichloromethane');
    expect(exactLibraryMatch('n-BuLi')?.molarity).toBe(2.5);
    expect(searchLibrary('碳酸').length).toBeGreaterThan(2);
  });
});
