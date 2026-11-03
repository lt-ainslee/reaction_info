import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zh } from '../i18n/zh';
import { en } from '../i18n/en';
import { newComponent, type Reaction } from '../chem/stoich';
import { withRuns, updateRun } from '../chem/runs';
import { DEFAULT_UNITS } from '../units';
import { procedureTex, tex, texFileName, texName, texReport } from './tex';

/** A reaction with everything the record can show, including LaTeX-hostile text. */
export function sample(): Reaction {
  const a = { ...newComponent({ name: '4-Bromoanisole', abbr: '1a', role: 'reactant', mw: 187.04, smiles: 'COc1ccc(Br)cc1', cas: '104-92-7' }), id: 'a' };
  const b = { ...newComponent({ name: 'PhB(OH)₂', role: 'reagent', mw: 121.93, equiv: 1.5 }), id: 'b' };
  const k = {
    ...newComponent({ name: 'K₂CO₃ (10% w/w, "dry")', role: 'reagent', mw: 138.2, equiv: 2 }),
    id: 'k',
    actualAmount: { mass: 280 },
    actualNote: '280 mg',
    lot: { supplier: 'Adamas & Co.', spec: 'AR_500 g', catalogNumber: '#A123', lotNumber: 'L~2304', verification: 'issue' as const, verificationNote: '含 3% 水 {KF}' },
  };
  const c = { ...newComponent({ name: 'Pd(PPh₃)₄', role: 'catalyst', mw: 1155.6, equiv: 0.05 }), id: 'c' };
  const s = { ...newComponent({ name: '1,4-dioxane/H₂O', role: 'solvent', mw: 88.1 }), id: 's', solventVolume: 5000 };
  const p = {
    ...newComponent({ name: '4-Methoxybiphenyl', abbr: '3a', role: 'product', mw: 184.24 }),
    id: 'p',
    actualMass: 156,
    characterization: '¹H NMR (400 MHz, CDCl₃) δ 7.55–7.50 (m, 4H), 6.98 (d, J = 8.8 Hz, 2H), 3.85 (s, 3H).\nHRMS (ESI) m/z: [M+H]⁺ calcd for C₁₃H₁₃O⁺ 185.0961; found 185.0960.\nR_f = 0.4 (PE/EA = 20:1), 100% conv. $5 ^_^ \\ ~',
  };
  let r: Reaction = {
    title: 'Suzuki 偶联 & 放大 #2',
    code: 'LT-042',
    refId: 'a',
    refMmol: 1,
    components: [a, b, k, c, s, p],
    conditions: '90 °C, 12 h, N₂',
    operator: '张三',
    procedure: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '反应' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '在 25 mL Schlenk 管中加入 ' },
            { type: 'text', text: '1a', marks: [{ type: 'bold' }] },
            { type: 'text', text: '，抽换 N' },
            { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
            { type: 'text', text: ' 三次；t', marks: [{ type: 'italic' }] },
            { type: 'text', text: '-BuOK 50% → 90 °C。' },
            { type: 'hardBreak' },
          ],
        },
        { type: 'paragraph' },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '加入 5 mL 溶剂 & 搅拌' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'TLC 监测' }] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2 h：原料剩余 ~10%' }] }] }] },
              ],
            },
          ],
        },
        { type: 'observation', content: [{ type: 'paragraph', content: [{ type: 'text', text: '溶液由黄色变为黑色，有 Pd 黑析出。' }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '注意：Pd 催化剂需避光保存。' }] }] },
        { type: 'horizontalRule' },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: ['柱层析', 'R_f', '收集'].map((x) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: x }] }] })) },
            { type: 'tableRow', content: ['[PE/EA] 20:1', '0.40', '15–28'].map((x) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: x }] }] })) },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '见 ' }, { type: 'text', text: '文献', marks: [{ type: 'link', attrs: { href: 'https://example.org/a_b%20c#x' } }] }] },
      ],
    },
    references: [
      { id: 'r1', authors: 'Miyaura, N.; Suzuki, A.', title: 'Palladium-Catalyzed Cross-Coupling Reactions of Organoboron Compounds', journal: 'Chem. Rev.', year: 1995, volume: '95', issue: '7', pages: '2457-2483', doi: '10.1021/cr00039a007' },
      { id: 'r2', citation: 'SI p. S5, entry 3a', url: 'https://example.org/si?x=1&y=2', note: '条件 b' },
    ],
  };
  r = withRuns(r);
  r = updateRun(r, r.activeRunId!, { status: 'done', date: '2026-11-03', appearance: '白色固体', conclusion: '放大到 1 mmol 后产率 85%，与小量一致。' });
  return r;
}

describe('LaTeX export', () => {
  it('escapes special characters and converts sub- / superscripts', () => {
    expect(tex('a_b & 50% #1 {x} $ ^ ~ \\')).toBe('a\\_b \\& 50\\% \\#1 \\{x\\} \\$ \\textasciicircum{} \\textasciitilde{} \\textbackslash{}');
    expect(tex('CH₂Cl₂ [M+H]⁺ δ 5 µL')).toBe('CH\\textsubscript{2}Cl\\textsubscript{2} [M+H]\\textsuperscript{+} \\ensuremath{\\delta} 5 \\ensuremath{\\mu}L');
    expect(tex('a\nb')).toBe('a b');
  });

  it('writes the procedure blocks', () => {
    const out = procedureTex(sample().procedure!, '现象');
    expect(out).toContain('\\begin{enumerate}[start=3]');
    expect(out).toContain('\\begin{card}[现象]');
    expect(out).toContain('N\\textsubscript{2}');
    expect(out).toContain('\\href{https://example.org/a_b\\%20c\\#x}{文献}');
    expect(out).toContain('90 °C。\n\n\\begin{enumerate}'); // trailing line break dropped
  });

  it('fills the Kami experiment-record layout', () => {
    const r = sample();
    const out = texReport({ rxn: r, units: DEFAULT_UNITS, t: zh, scheme: { file: 'scheme.png', widthPt: 300 } });
    expect(out).toContain('\\documentclass{kamidoc}');
    expect(out).toContain('\\headfigure{84.7\\%}');
    expect(out).toContain('\\includegraphics[width=300.0pt]{scheme.png}');
    expect(out).toContain('\\warnbadge{');
    expect(out).toContain('\\bibitem{ref1}');
    expect(texFileName(r)).toBe('LT-042-1');
    if (process.env.TEX_OUT) {
      writeFileSync(`${process.env.TEX_OUT}/zh.tex`, out);
      writeFileSync(`${process.env.TEX_OUT}/en.tex`, texReport({ rxn: r, units: DEFAULT_UNITS, t: en, scheme: { file: 'scheme.png', widthPt: 600 } }));
      const empty: Reaction = { title: '', refId: null, refMmol: 0, components: [] };
      writeFileSync(`${process.env.TEX_OUT}/empty.tex`, texReport({ rxn: empty, units: DEFAULT_UNITS, t: zh, scheme: null }));
    }
  });
});

describe('texName', () => {
  it('lets long names break', () => {
    expect(texName('Tetrakis(triphenylphosphine)palladium(0)')).toBe('Tetrakis(triphenylphosphine)\\allowbreak{}palladium(0)');
    expect(texName('1,4-dioxane')).toBe('1,\\allowbreak{}4-\\allowbreak{}dioxane');
  });
});
