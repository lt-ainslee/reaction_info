import type { Component, Form } from './stoich';
import { formulaMass } from './formula';

// Built-in list of common reagents/solvents with the data that matters for
// weighing out (density, commercial form). Searched before PubChem, and the
// only way Chinese names are resolved. MW is derived from the formula.
export interface LibraryEntry {
  en: string;
  zh: string;
  aliases?: string[];
  formula: string;
  cas: string;
  smiles?: string;
  density?: number;
  purity?: number;
  form?: Form;
  molarity?: number;
  wtPercent?: number;
  solutionDensity?: number;
}

export const LIBRARY: LibraryEntry[] = [
  // Solvents
  { en: 'Water', zh: '水', formula: 'H2O', cas: '7732-18-5', smiles: 'O', density: 0.997 },
  { en: 'Methanol', zh: '甲醇', aliases: ['MeOH'], formula: 'CH4O', cas: '67-56-1', smiles: 'CO', density: 0.792 },
  { en: 'Ethanol', zh: '乙醇', aliases: ['EtOH'], formula: 'C2H6O', cas: '64-17-5', smiles: 'CCO', density: 0.789 },
  { en: 'Isopropanol', zh: '异丙醇', aliases: ['IPA', '2-Propanol'], formula: 'C3H8O', cas: '67-63-0', smiles: 'CC(C)O', density: 0.786 },
  { en: 'Acetone', zh: '丙酮', formula: 'C3H6O', cas: '67-64-1', smiles: 'CC(C)=O', density: 0.791 },
  { en: 'Acetonitrile', zh: '乙腈', aliases: ['MeCN', 'ACN'], formula: 'C2H3N', cas: '75-05-8', smiles: 'CC#N', density: 0.786 },
  { en: 'Dichloromethane', zh: '二氯甲烷', aliases: ['DCM', 'CH2Cl2'], formula: 'CH2Cl2', cas: '75-09-2', smiles: 'ClCCl', density: 1.325 },
  { en: 'Chloroform', zh: '三氯甲烷', aliases: ['氯仿', 'CHCl3'], formula: 'CHCl3', cas: '67-66-3', smiles: 'ClC(Cl)Cl', density: 1.489 },
  { en: '1,2-Dichloroethane', zh: '1,2-二氯乙烷', aliases: ['DCE'], formula: 'C2H4Cl2', cas: '107-06-2', smiles: 'ClCCCl', density: 1.256 },
  { en: 'Tetrahydrofuran', zh: '四氢呋喃', aliases: ['THF'], formula: 'C4H8O', cas: '109-99-9', smiles: 'C1CCOC1', density: 0.889 },
  { en: 'Diethyl ether', zh: '乙醚', aliases: ['Et2O', 'Ether'], formula: 'C4H10O', cas: '60-29-7', smiles: 'CCOCC', density: 0.713 },
  { en: '1,4-Dioxane', zh: '1,4-二氧六环', aliases: ['Dioxane', '二氧六环'], formula: 'C4H8O2', cas: '123-91-1', smiles: 'C1COCCO1', density: 1.033 },
  { en: 'Toluene', zh: '甲苯', aliases: ['PhMe'], formula: 'C7H8', cas: '108-88-3', smiles: 'Cc1ccccc1', density: 0.867 },
  { en: 'n-Hexane', zh: '正己烷', aliases: ['Hexane', '己烷'], formula: 'C6H14', cas: '110-54-3', smiles: 'CCCCCC', density: 0.659 },
  { en: 'Ethyl acetate', zh: '乙酸乙酯', aliases: ['EtOAc', 'EA'], formula: 'C4H8O2', cas: '141-78-6', smiles: 'CCOC(C)=O', density: 0.902 },
  { en: 'N,N-Dimethylformamide', zh: 'N,N-二甲基甲酰胺', aliases: ['DMF'], formula: 'C3H7NO', cas: '68-12-2', smiles: 'CN(C)C=O', density: 0.944 },
  { en: 'Dimethyl sulfoxide', zh: '二甲基亚砜', aliases: ['DMSO'], formula: 'C2H6OS', cas: '67-68-5', smiles: 'CS(C)=O', density: 1.1 },
  { en: 'N-Methyl-2-pyrrolidone', zh: 'N-甲基吡咯烷酮', aliases: ['NMP'], formula: 'C5H9NO', cas: '872-50-4', smiles: 'CN1CCCC1=O', density: 1.028 },
  { en: 'Acetic acid', zh: '乙酸', aliases: ['醋酸', 'AcOH', 'HOAc'], formula: 'C2H4O2', cas: '64-19-7', smiles: 'CC(=O)O', density: 1.049 },
  { en: 'Pyridine', zh: '吡啶', aliases: ['Py'], formula: 'C5H5N', cas: '110-86-1', smiles: 'c1ccncc1', density: 0.982 },

  // Bases
  { en: 'Triethylamine', zh: '三乙胺', aliases: ['TEA', 'Et3N', 'NEt3'], formula: 'C6H15N', cas: '121-44-8', smiles: 'CCN(CC)CC', density: 0.726 },
  { en: 'N,N-Diisopropylethylamine', zh: 'N,N-二异丙基乙胺', aliases: ['DIPEA', 'DIEA', "Hünig's base"], formula: 'C8H19N', cas: '7087-68-5', smiles: 'CCN(C(C)C)C(C)C', density: 0.742 },
  { en: 'DBU', zh: '1,8-二氮杂二环[5.4.0]十一碳-7-烯', aliases: ['1,8-Diazabicyclo[5.4.0]undec-7-ene'], formula: 'C9H16N2', cas: '6674-22-2', smiles: 'C1CCC2=NCCCN2CC1', density: 1.018 },
  { en: '4-Dimethylaminopyridine', zh: '4-二甲氨基吡啶', aliases: ['DMAP'], formula: 'C7H10N2', cas: '1122-58-3', smiles: 'CN(C)c1ccncc1' },
  { en: 'Potassium carbonate', zh: '碳酸钾', aliases: ['K2CO3'], formula: 'K2CO3', cas: '584-08-7', smiles: '[K+].[K+].[O-]C([O-])=O' },
  { en: 'Cesium carbonate', zh: '碳酸铯', aliases: ['Cs2CO3'], formula: 'Cs2CO3', cas: '534-17-8', smiles: '[Cs+].[Cs+].[O-]C([O-])=O' },
  { en: 'Sodium carbonate', zh: '碳酸钠', aliases: ['Na2CO3'], formula: 'Na2CO3', cas: '497-19-8', smiles: '[Na+].[Na+].[O-]C([O-])=O' },
  { en: 'Sodium bicarbonate', zh: '碳酸氢钠', aliases: ['NaHCO3'], formula: 'NaHCO3', cas: '144-55-8', smiles: '[Na+].OC([O-])=O' },
  { en: 'Potassium phosphate', zh: '磷酸钾', aliases: ['K3PO4'], formula: 'K3PO4', cas: '7778-53-2', smiles: '[K+].[K+].[K+].[O-]P([O-])([O-])=O' },
  { en: 'Sodium hydroxide', zh: '氢氧化钠', aliases: ['NaOH'], formula: 'NaOH', cas: '1310-73-2', smiles: '[Na+].[OH-]' },
  { en: 'Potassium hydroxide', zh: '氢氧化钾', aliases: ['KOH'], formula: 'KOH', cas: '1310-58-3', smiles: '[K+].[OH-]' },
  { en: 'Potassium tert-butoxide', zh: '叔丁醇钾', aliases: ['t-BuOK', 'KOtBu'], formula: 'C4H9KO', cas: '865-47-4', smiles: '[K+].CC(C)(C)[O-]' },
  { en: 'Sodium hydride (60% in oil)', zh: '氢化钠（60%，分散于矿物油）', aliases: ['NaH', '氢化钠'], formula: 'NaH', cas: '7646-69-7', smiles: '[Na+].[H-]', purity: 60 },
  { en: 'n-Butyllithium (2.5 M in hexanes)', zh: '正丁基锂（2.5 M 正己烷溶液）', aliases: ['n-BuLi', 'BuLi', '正丁基锂'], formula: 'C4H9Li', cas: '109-72-8', smiles: '[Li]CCCC', form: 'solutionM', molarity: 2.5, solutionDensity: 0.693 },
  { en: 'Lithium diisopropylamide (2.0 M in THF/heptane)', zh: '二异丙基氨基锂（2.0 M）', aliases: ['LDA'], formula: 'C6H14LiN', cas: '4111-54-0', smiles: '[Li+].CC(C)[N-]C(C)C', form: 'solutionM', molarity: 2.0 },

  // Reductants / oxidants
  { en: 'Sodium borohydride', zh: '硼氢化钠', aliases: ['NaBH4'], formula: 'NaBH4', cas: '16940-66-2', smiles: '[Na+].[BH4-]' },
  { en: 'Lithium aluminium hydride', zh: '氢化铝锂', aliases: ['LiAlH4', 'LAH'], formula: 'LiAlH4', cas: '16853-85-3', smiles: '[Li+].[AlH4-]' },
  { en: 'Hydrogen peroxide (30 wt%)', zh: '过氧化氢（30% 水溶液）', aliases: ['H2O2', '双氧水'], formula: 'H2O2', cas: '7722-84-1', smiles: 'OO', form: 'solutionWt', wtPercent: 30, solutionDensity: 1.11 },
  { en: 'm-Chloroperoxybenzoic acid (≤77%)', zh: '间氯过氧苯甲酸（≤77%）', aliases: ['mCPBA', 'm-CPBA'], formula: 'C7H5ClO3', cas: '937-14-4', smiles: 'OOC(=O)c1cccc(Cl)c1', purity: 77 },

  // Acids
  { en: 'Hydrochloric acid (37 wt%)', zh: '浓盐酸（37%）', aliases: ['HCl', '盐酸'], formula: 'HCl', cas: '7647-01-0', smiles: 'Cl', form: 'solutionWt', wtPercent: 37, solutionDensity: 1.19 },
  { en: 'Sulfuric acid (98%)', zh: '浓硫酸（98%）', aliases: ['H2SO4', '硫酸'], formula: 'H2SO4', cas: '7664-93-9', smiles: 'OS(=O)(=O)O', density: 1.84, purity: 98 },
  { en: 'Trifluoroacetic acid', zh: '三氟乙酸', aliases: ['TFA'], formula: 'C2HF3O2', cas: '76-05-1', smiles: 'OC(=O)C(F)(F)F', density: 1.489 },
  { en: 'p-Toluenesulfonic acid monohydrate', zh: '对甲苯磺酸一水合物', aliases: ['TsOH·H2O', 'PTSA', 'p-TsOH'], formula: 'C7H8O3S·H2O', cas: '6192-52-5', smiles: 'Cc1ccc(cc1)S(=O)(=O)O.O' },

  // Common reagents
  { en: 'Acetic anhydride', zh: '乙酸酐', aliases: ['Ac2O', '醋酸酐'], formula: 'C4H6O3', cas: '108-24-7', smiles: 'CC(=O)OC(C)=O', density: 1.08 },
  { en: 'Thionyl chloride', zh: '氯化亚砜', aliases: ['SOCl2', '二氯亚砜'], formula: 'SOCl2', cas: '7719-09-7', smiles: 'O=S(Cl)Cl', density: 1.638 },
  { en: 'Oxalyl chloride', zh: '草酰氯', aliases: ['(COCl)2'], formula: 'C2Cl2O2', cas: '79-37-8', smiles: 'O=C(Cl)C(=O)Cl', density: 1.478 },
  { en: 'Di-tert-butyl dicarbonate', zh: '二碳酸二叔丁酯', aliases: ['Boc2O', '(Boc)2O', 'Boc酸酐'], formula: 'C10H18O5', cas: '24424-99-5', smiles: 'CC(C)(C)OC(=O)OC(=O)OC(C)(C)C', density: 0.95 },
  { en: 'N-Bromosuccinimide', zh: 'N-溴代丁二酰亚胺', aliases: ['NBS'], formula: 'C4H4BrNO2', cas: '128-08-5', smiles: 'BrN1C(=O)CCC1=O' },
  { en: 'tert-Butyldimethylsilyl chloride', zh: '叔丁基二甲基氯硅烷', aliases: ['TBSCl', 'TBDMSCl'], formula: 'C6H15ClSi', cas: '18162-48-6', smiles: 'CC(C)(C)[Si](C)(C)Cl' },
  { en: 'Benzyl bromide', zh: '苄溴', aliases: ['BnBr', '溴化苄'], formula: 'C7H7Br', cas: '100-39-0', smiles: 'BrCc1ccccc1', density: 1.438 },
  { en: 'Iodomethane', zh: '碘甲烷', aliases: ['MeI', '甲基碘'], formula: 'CH3I', cas: '74-88-4', smiles: 'CI', density: 2.28 },
  { en: 'Bromobenzene', zh: '溴苯', aliases: ['PhBr'], formula: 'C6H5Br', cas: '108-86-1', smiles: 'Brc1ccccc1', density: 1.495 },
  { en: 'Phenylboronic acid', zh: '苯硼酸', aliases: ['PhB(OH)2'], formula: 'C6H7BO2', cas: '98-80-6', smiles: 'OB(O)c1ccccc1' },
  { en: 'EDC hydrochloride', zh: '1-乙基-3-(3-二甲氨基丙基)碳二亚胺盐酸盐', aliases: ['EDCI', 'EDC·HCl', 'EDCI·HCl'], formula: 'C8H17N3·HCl', cas: '25952-53-8', smiles: 'CCN=C=NCCCN(C)C.Cl' },
  { en: '1-Hydroxybenzotriazole', zh: '1-羟基苯并三唑', aliases: ['HOBt'], formula: 'C6H5N3O', cas: '2592-95-2', smiles: 'On1nnc2ccccc21' },
  { en: 'HATU', zh: 'HATU', aliases: ['2-(7-Azabenzotriazol-1-yl)-N,N,N\',N\'-tetramethyluronium hexafluorophosphate'], formula: 'C10H15F6N6OP', cas: '148893-10-1', smiles: 'CN(C)C(=[N+](C)C)On1nnc2cccnc21.F[P-](F)(F)(F)(F)F' },
  { en: 'N,N\'-Dicyclohexylcarbodiimide', zh: 'N,N\'-二环己基碳二亚胺', aliases: ['DCC'], formula: 'C13H22N2', cas: '538-75-0', smiles: 'C(=NC1CCCCC1)=NC1CCCCC1' },
  { en: 'Triphenylphosphine', zh: '三苯基膦', aliases: ['PPh3'], formula: 'C18H15P', cas: '603-35-0', smiles: 'c1ccc(cc1)P(c1ccccc1)c1ccccc1' },

  // Catalysts (no SMILES: drawn as text in the scheme)
  { en: 'Tetrakis(triphenylphosphine)palladium(0)', zh: '四(三苯基膦)钯', aliases: ['Pd(PPh3)4'], formula: 'C72H60P4Pd', cas: '14221-01-3' },
  { en: 'Palladium(II) acetate', zh: '醋酸钯', aliases: ['Pd(OAc)2'], formula: 'C4H6O4Pd', cas: '3375-31-3' },
  { en: 'Pd(dppf)Cl2', zh: '[1,1\'-双(二苯基膦)二茂铁]二氯化钯', aliases: ['PdCl2(dppf)'], formula: 'C34H28Cl2FeP2Pd', cas: '72287-26-4' },
  { en: 'Palladium on carbon (10%)', zh: '钯碳（10%）', aliases: ['Pd/C'], formula: 'Pd', cas: '7440-05-3', purity: 10 },
  { en: 'Copper(I) iodide', zh: '碘化亚铜', aliases: ['CuI'], formula: 'CuI', cas: '7681-65-4', smiles: '[Cu]I' },
];

// Entries in the "Solvents" block above, used to guess roles of pasted agents.
const SOLVENT_COUNT = LIBRARY.findIndex((e) => e.en === 'Triethylamine');
export const isLibrarySolvent = (e: LibraryEntry) => LIBRARY.indexOf(e) < SOLVENT_COUNT;

const norm = (s: string) => s.toLowerCase().replace(/[\s()（）,，\-·.]/g, '');

export function searchLibrary(query: string, limit = 8): LibraryEntry[] {
  const q = norm(query);
  if (!q) return [];
  const scored: [number, LibraryEntry][] = [];
  for (const e of LIBRARY) {
    const keys = [e.en, e.zh, e.cas, e.formula, ...(e.aliases ?? [])].map(norm);
    let score = 0;
    if (keys.includes(q)) score = 3;
    else if (keys.some((k) => k.startsWith(q))) score = 2;
    else if (keys.some((k) => k.includes(q))) score = 1;
    if (score) scored.push([score, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, e]) => e);
}

export function exactLibraryMatch(query: string): LibraryEntry | undefined {
  const r = searchLibrary(query, 1);
  return r.length && [r[0].en, r[0].zh, r[0].cas, r[0].formula, ...(r[0].aliases ?? [])].map(norm).includes(norm(query))
    ? r[0]
    : undefined;
}

export function libraryToComponent(e: LibraryEntry, lang: 'zh' | 'en'): Omit<Component, 'id' | 'role' | 'equiv'> {
  return {
    name: lang === 'zh' ? e.zh : e.en,
    smiles: e.smiles,
    formula: e.formula,
    cas: e.cas,
    mw: formulaMass(e.formula) ?? undefined,
    density: e.density,
    purity: e.purity ?? 100,
    form: e.form ?? 'neat',
    molarity: e.molarity,
    wtPercent: e.wtPercent,
    solutionDensity: e.solutionDensity,
  };
}
