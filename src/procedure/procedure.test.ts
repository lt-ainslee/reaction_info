import { describe, expect, it } from 'vitest';
import { CHARGE_FIND, FORMULA_FIND, formulaSubscripts, SYMBOL_RULES } from './chemText';
import { fromPlainText, isEmptyDoc, procedureOf, toHtml, toPlainText, type ProcDoc } from './doc';

const sub = (t: string) => {
  const ix = formulaSubscripts(t);
  return ix ? [...t].map((c, i) => (ix.includes(i) ? `_${c}` : c)).join('') : null;
};

describe('formulaSubscripts', () => {
  it('subscripts digits after element symbols and groups', () => {
    expect(sub('CH2Cl2')).toBe('CH_2Cl_2');
    expect(sub('Na2SO4')).toBe('Na_2SO_4');
    expect(sub('Et3N')).toBe('Et_3N');
    expect(sub('Pd(PPh3)4')).toBe('Pd(PPh_3)_4');
    expect(sub('C18')).toBe('C_1_8');
    expect(sub('N2')).toBe('N_2');
  });
  it('leaves ordinary words alone', () => {
    for (const w of ['Step2', 'MS4', 'T3P', 'Q3', 'THF', 'B2pin2', 'Fig1']) expect(sub(w)).toBeNull();
  });
  it('matches whole words ending with a trigger', () => {
    expect('dried over Na2SO4,'.match(FORMULA_FIND)?.[1]).toBe('Na2SO4');
    expect('（CH2Cl2）'.match(FORMULA_FIND)?.[1]).toBe('CH2Cl2');
    expect('2H '.match(FORMULA_FIND)).toBeNull();
    expect('[M+H]+'.match(CHARGE_FIND)?.[1]).toBe('+');
  });
  it('replaces symbol shortcuts', () => {
    const apply = (s: string) => {
      for (const [re, f] of SYMBOL_RULES) {
        const m = s.match(re);
        if (m) return s.slice(0, m.index) + f(m);
      }
      return s;
    };
    expect(apply('A ->')).toBe('A →');
    expect(apply('at 90 oC')).toBe('at 90 °C');
    expect(apply('50 uL')).toBe('50 µL');
    expect(apply('3 x ')).toBe('3 × ');
    expect(apply('box ')).toBe('box ');
  });
});

describe('procedure documents', () => {
  const doc: ProcDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Workup' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Dissolve in CH' },
          { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
          { type: 'text', text: 'Cl' },
          { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
          { type: 'text', text: ' <b>', marks: [{ type: 'bold' }] },
        ],
      },
      { type: 'orderedList', content: [1, 2].map((i) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `step ${i}` }] }] })) },
      { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
    ],
  };
  it('renders escaped HTML with a fixed tag set', () => {
    const html = toHtml(doc);
    expect(html).toContain('CH<sub>2</sub>Cl<sub>2</sub>');
    expect(html).toContain('<strong> &lt;b&gt;</strong>');
    expect(html).toContain('<ol><li><p>step 1</p></li>');
    expect(html).not.toContain('javascript');
  });
  it('flattens to plain text', () => {
    expect(toPlainText(doc)).toBe('Workup\nDissolve in CH2Cl2 <b>\n1. step 1\n2. step 2\nx');
  });
  it('reads old plain notes', () => {
    const d = procedureOf({ notes: 'line 1\n\nline 3' });
    expect(d.content).toHaveLength(3);
    expect(toPlainText(d)).toBe('line 1\n\nline 3');
    expect(isEmptyDoc(fromPlainText(''))).toBe(true);
    expect(procedureOf({ procedure: doc, notes: 'old' })).toBe(doc);
  });
});
