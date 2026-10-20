// @vitest-environment happy-dom
import initRDKit, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectFormat, fragmentCharge, groupFragments, parseAgentText, parseInputText, splitNameReaction, splitReactionSmiles } from './parseInput';

let rd: MainModule;
beforeAll(async () => {
  rd = await initRDKit();
});

// --- tiny CDXML builder (mirrors what ChemDraw writes) ---
let nextId = 100;
interface Frag { id: number; xml: string; ring: number[] }

/** Benzene ring at (cx, cy) with optional substituent nodes attached to ring atoms. */
function benzene(cx: number, cy: number, subs: { at: number; node: (id: number, x: number, y: number) => string }[]): Frag {
  const id = nextId++;
  const ring = Array.from({ length: 6 }, () => nextId++);
  const pts = ring.map((_, i) => [cx + 14.4 * Math.cos((Math.PI / 3) * i), cy + 14.4 * Math.sin((Math.PI / 3) * i)]);
  let xml = ring.map((n, i) => `<n id="${n}" p="${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}"/>`).join('');
  xml += ring.map((n, i) => `<b id="${nextId++}" B="${n}" E="${ring[(i + 1) % 6]}"${i % 2 ? ' Order="2"' : ''}/>`).join('');
  for (const s of subs) {
    const sid = nextId++;
    const [x, y] = pts[s.at];
    xml += s.node(sid, x * 1.0 + (x - cx) * 1.0, y + (y - cy) * 1.0);
    xml += `<b id="${nextId++}" B="${ring[s.at]}" E="${sid}"/>`;
  }
  return { id, xml: `<fragment id="${id}">${xml}</fragment>`, ring };
}

const atom = (z: number) => (id: number, x: number, y: number) => `<n id="${id}" p="${x} ${y}" Element="${z}"/>`;
const boronic = (id: number, x: number, y: number) => {
  // B(OH)2 drawn explicitly: B node plus two O nodes, bonds added inline.
  const o1 = nextId++;
  const o2 = nextId++;
  return `<n id="${id}" p="${x} ${y}" Element="5"/><n id="${o1}" p="${x + 12} ${y - 7}" Element="8"/><n id="${o2}" p="${x + 12} ${y + 7}" Element="8"/>` +
    `<b id="${nextId++}" B="${id}" E="${o1}"/><b id="${nextId++}" B="${id}" E="${o2}"/>`;
};
/** "OMe" abbreviation: a Fragment node with an inner fragment and an external connection point. */
const ome = (id: number, x: number, y: number) => {
  const [inner, ecp, o, c] = [nextId++, nextId++, nextId++, nextId++];
  return `<n id="${id}" p="${x} ${y}" NodeType="Fragment"><fragment id="${inner}">` +
    `<n id="${ecp}" p="${x - 10} ${y}" NodeType="ExternalConnectionPoint"/><n id="${o}" p="${x} ${y}" Element="8"/><n id="${c}" p="${x + 12} ${y}"/>` +
    `<b id="${nextId++}" B="${ecp}" E="${o}"/><b id="${nextId++}" B="${o}" E="${c}"/></fragment><t p="${x} ${y}"><s>OMe</s></t></n>`;
};

const text = (id: number, x: number, y: number, s: string) => `<t id="${id}" p="${x} ${y}"><s font="3" size="10">${s}</s></t>`;
const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n<CDXML><page id="1">${body}</page></CDXML>`;

const phBr = () => benzene(50, 100, [{ at: 0, node: atom(35) }]);
const arylB = () => benzene(150, 100, [{ at: 3, node: boronic }, { at: 0, node: ome }]);

describe('CDXML', () => {
  it('reads a reaction step with abbreviations and arrow text', () => {
    const r1 = phBr();
    const r2 = arylB();
    // Biphenyl product: second ring attached to the first.
    const p = benzene(420, 100, [{ at: 0, node: ome }]);
    const ring2 = benzene(470, 100, []);
    const prodXml = `<fragment id="${p.id}">${p.xml.replace(/^<fragment id="\d+">|<\/fragment>$/g, '')}${ring2.xml.replace(/^<fragment id="\d+">|<\/fragment>$/g, '')}<b id="${nextId++}" B="${p.ring[3]}" E="${ring2.ring[0]}"/></fragment>`;
    const above = nextId++;
    const below = nextId++;
    const step = `<scheme id="${nextId++}"><step id="${nextId++}" ReactionStepReactants="${r1.id} ${r2.id}" ReactionStepProducts="${p.id}" ReactionStepObjectsAboveArrow="${above}" ReactionStepObjectsBelowArrow="${below}"/></scheme>`;
    const xml = wrap(
      r1.xml + r2.xml + prodXml +
      text(above, 280, 80, 'Pd(PPh3)4 (5 mol%)\nK2CO3 (2.0 equiv)') +
      text(below, 280, 120, 'dioxane/H2O (4:1), 90 °C, 12 h') + step,
    );
    expect(detectFormat(xml)).toBe('cdxml');
    const parsed = parseInputText(rd, xml)!;
    expect(parsed.isReaction).toBe(true);
    expect(parsed.reactants.map((s) => s.smiles)).toEqual(['Brc1ccccc1', 'COc1ccc(B(O)O)cc1']);
    expect(parsed.products.map((s) => s.smiles)).toEqual(['COc1ccc(-c2ccccc2)cc1']);
    expect(parsed.agents.map((s) => s.text)).toEqual(['Pd(PPh3)4 (5 mol%)\nK2CO3 (2.0 equiv)', 'dioxane/H2O (4:1), 90 °C, 12 h']);
  });

  it('falls back to arrow position when there is no reaction step', () => {
    const r = phBr();
    const p = benzene(300, 100, [{ at: 0, node: atom(8) }]);
    const xml = wrap(
      r.xml + p.xml + `<arrow id="${nextId++}" Head3D="220 100 0" Tail3D="120 100 0"/>` +
      text(nextId++, 170, 85, 'NaOH') + text(nextId++, 50, 140, '1a'),
    );
    const parsed = parseInputText(rd, xml)!;
    expect(parsed.reactants.map((s) => s.smiles)).toEqual(['Brc1ccccc1']);
    expect(parsed.products.map((s) => s.smiles)).toEqual(['Oc1ccccc1']);
    expect(parsed.agents).toEqual([{ text: 'NaOH' }]);
  });

  it('reads plain structures without an arrow', () => {
    const parsed = parseInputText(rd, wrap(phBr().xml + text(nextId++, 50, 140, 'caption')))!;
    expect(parsed.isReaction).toBe(false);
    expect(parsed.molecules).toEqual([{ smiles: 'Brc1ccccc1' }]);
  });

  it('rejects malformed XML', () => {
    expect(parseInputText(rd, '<CDXML><page>')).toBeNull();
  });
});

describe('MDL formats', () => {
  const mol = (smi: string) => rd.get_mol(smi)!.get_molblock();

  it('reads a molfile and an SDF, grouping ions', () => {
    expect(parseInputText(rd, mol('c1ccccc1Br'))!.molecules).toEqual([{ smiles: 'Brc1ccccc1' }]);
    const sdf = `${mol('CCO')}\n>  <NAME>\nethanol\n\n$$$$\n${mol('O=C([O-])[O-].[K+].[K+]')}\n$$$$\n`;
    expect(parseInputText(rd, sdf)!.molecules.map((s) => s.smiles)).toEqual(['CCO', 'O=C([O-])[O-].[K+].[K+]']);
  });

  it('reads a V2000 RXN file', () => {
    const rxn = ['$RXN', '', '  ChemDraw', '', '  2  1', '$MOL', mol('CC(=O)O'), '$MOL', mol('CCO'), '$MOL', mol('CCOC(C)=O')].join('\n');
    expect(detectFormat(rxn)).toBe('rxn');
    const p = parseInputText(rd, rxn)!;
    expect(p.reactants.map((s) => s.smiles)).toEqual(['CC(=O)O', 'CCO']);
    expect(p.products.map((s) => s.smiles)).toEqual(['CCOC(C)=O']);
  });

  it('reads a V3000 RXN file', () => {
    const ctab = (smi: string) => {
      const b = rd.get_mol(smi)!.get_v3Kmolblock();
      return b.slice(b.indexOf('M  V30 BEGIN CTAB'), b.indexOf('M  V30 END CTAB') + 15);
    };
    const rxn = ['$RXN V3000', '', '', '', 'M  V30 COUNTS 1 1', 'M  V30 BEGIN REACTANT', ctab('CCO'), 'M  V30 END REACTANT',
      'M  V30 BEGIN PRODUCT', ctab('CC=O'), 'M  V30 END PRODUCT', 'M  END'].join('\n');
    const p = parseInputText(rd, rxn)!;
    expect(p.reactants).toEqual([{ smiles: 'CCO' }]);
    expect(p.products).toEqual([{ smiles: 'CC=O' }]);
  });
});

describe('text input', () => {
  it('splits reaction SMILES, grouping bare ions', () => {
    expect(splitReactionSmiles('c1ccccc1Br.OB(O)c1ccccc1>[K+].[K+].[O-]C([O-])=O>c1ccc(cc1)-c1ccccc1')).toEqual({
      reactants: ['c1ccccc1Br', 'OB(O)c1ccccc1'],
      agents: ['[K+].[K+].[O-]C([O-])=O'],
      products: ['c1ccc(cc1)-c1ccccc1'],
    });
    expect(splitReactionSmiles('CCO>(O=C([O-])[O-].[K+].[K+]).[Na+].[Cl-]>CC=O')?.agents).toEqual(['O=C([O-])[O-].[K+].[K+]', '[Na+].[Cl-]']);
    expect(splitReactionSmiles('CCO')).toBeNull();
  });

  it('splits name reactions and line lists', () => {
    expect(splitNameReaction('苯甲酸 + 甲醇 -> 苯甲酸甲酯')).toEqual({ reactants: ['苯甲酸', '甲醇'], products: ['苯甲酸甲酯'] });
    expect(detectFormat('benzoic acid + methanol → methyl benzoate')).toBe('names');
    expect(parseInputText(rd, 'CCO\nTHF\n64-17-5')!.molecules).toEqual([{ text: 'CCO' }, { text: 'THF' }, { text: '64-17-5' }]);
    expect(parseInputText(rd, 'InChI=1S/CH4O/c1-2/h2H,1H3')!.molecules).toEqual([{ text: 'InChI=1S/CH4O/c1-2/h2H,1H3' }]);
  });

  it('computes fragment charges', () => {
    expect(fragmentCharge('[K+]')).toBe(1);
    expect(fragmentCharge('O=C([O-])[O-]')).toBe(-2);
    expect(fragmentCharge('[Fe+3]')).toBe(3);
    expect(fragmentCharge('[NH4+]')).toBe(1);
    expect(groupFragments('CCN.Cl')).toEqual(['CCN', 'Cl']);
  });
});

describe('parseAgentText', () => {
  it('extracts equivalents, mol% and conditions', () => {
    expect(parseAgentText('Pd(PPh3)4 (5 mol%)\nK2CO3 (2.0 equiv)')).toEqual([
      { name: 'Pd(PPh3)4', equiv: 0.05, molPercent: true },
      { name: 'K2CO3', equiv: 2, molPercent: false },
    ]);
    expect(parseAgentText('dioxane/H2O (4:1), 90 °C, 12 h, N2')).toEqual([
      { name: 'dioxane/H2O', equiv: undefined, molPercent: false },
      { condition: '90 °C' },
      { condition: '12 h' },
      { condition: 'N2' },
    ]);
    expect(parseAgentText('1.5 eq NaH; THF, 0 °C to rt')).toEqual([
      { name: 'NaH', equiv: 1.5, molPercent: false },
      { name: 'THF', equiv: undefined, molPercent: false },
      { condition: '0 °C to rt' },
    ]);
  });
});
