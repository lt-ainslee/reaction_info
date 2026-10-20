import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

const zh = {
  appTitle: '反应投料计算',
  appSubtitle: '反应式预览 · 化合物性质 · 投料比',
  reactionTitle: '反应名称',
  reactionTitlePh: '例如：苯甲酸甲酯化 2026-10-20',
  importLabel: '导入反应',
  importPh: '反应 SMILES（如 c1ccccc1C(=O)O.CO>>c1ccccc1C(=O)OC）或名称（如 苯甲酸 + 甲醇 -> 苯甲酸甲酯）',
  importBtn: '导入',
  importHint: '盐或多组分物质可用括号包起来作为一个整体，例如 (O=C([O-])[O-].[K+].[K+])。',
  importing: '正在导入…',
  importFailed: '无法识别：',
  addCompound: '添加化合物',
  searchPh: '名称 / 缩写 / CAS / SMILES，支持中文常用试剂',
  search: '搜索',
  searching: '搜索中…',
  localResults: '常用试剂库',
  pubchemResults: 'PubChem',
  noResults: '未找到结果。可尝试英文名、CAS 号或 SMILES，或手动添加。',
  manualAdd: '手动添加',
  manualName: '名称',
  manualFormula: '分子式',
  manualMw: '分子量',
  add: '添加',
  addAs: '添加为',
  networkError: '网络错误，PubChem 暂时无法访问',
  preview: '反应式预览',
  previewEmpty: '添加化合物或导入反应后在此显示反应式',
  rdkitLoading: '正在加载结构渲染引擎…',
  table: '投料表',
  roles: { reactant: '反应物', reagent: '试剂', catalyst: '催化剂', solvent: '溶剂', product: '产物' },
  forms: { neat: '纯品', solutionM: '溶液 (M)', solutionWt: '溶液 (wt%)' },
  col: {
    ref: '基准',
    name: '化合物',
    role: '角色',
    mw: '分子量',
    form: '形态',
    conc: '浓度',
    density: '密度 g/mL',
    purity: '纯度 %',
    equiv: '当量',
    amount: '物质的量',
    mass: '质量',
    volume: '体积',
  },
  refTip: '设为基准（1.0 equiv，通常为限量试剂）',
  theoMass: '理论产量',
  actualMass: '实际产量',
  yield: '产率',
  solventConc: '浓度 M',
  solventConcTip: '基准物在溶剂中的浓度',
  solnDensity: '溶液密度',
  needMw: '需填写分子量',
  needDensity: '需密度',
  scale: '放大/缩小',
  plan: '按目标产物反推',
  planTarget: '目标产量',
  planYield: '预期产率 %',
  planApply: '计算',
  units: '单位',
  exportMd: '复制 Markdown',
  exportCsv: '导出 CSV',
  print: '打印',
  copied: '已复制',
  notes: '备注 / 实验步骤',
  saved: '已保存的反应',
  save: '保存',
  newReaction: '新建',
  load: '打开',
  delete: '删除',
  confirmDelete: '确定删除？',
  noSaved: '暂无保存的反应',
  details: '化合物性质',
  close: '关闭',
  formula: '分子式',
  iupac: 'IUPAC 名',
  meltingPoint: '熔点',
  boilingPoint: '沸点',
  flashPoint: '闪点',
  solubility: '溶解性',
  ghs: 'GHS 危险性',
  noData: '暂无数据',
  loadingDetails: '正在从 PubChem 获取性质…',
  useDensity: '使用此密度',
  fetchFromPubchem: '从 PubChem 查询',
  dataSource: '数据来源：PubChem，请以试剂标签/SDS 为准。',
  rename: '名称',
  footer: '计算结果仅供参考，请核对试剂规格与安全数据表 (SDS)。',
};

type Dict = typeof zh;

const en: Dict = {
  appTitle: 'Reaction Stoichiometry',
  appSubtitle: 'Scheme preview · Compound data · Reagent amounts',
  reactionTitle: 'Reaction name',
  reactionTitlePh: 'e.g. Methyl benzoate esterification 2026-10-20',
  importLabel: 'Import reaction',
  importPh: 'Reaction SMILES (e.g. c1ccccc1C(=O)O.CO>>c1ccccc1C(=O)OC) or names (e.g. benzoic acid + methanol -> methyl benzoate)',
  importBtn: 'Import',
  importHint: 'Wrap salts / multi-fragment species in parentheses to keep them together, e.g. (O=C([O-])[O-].[K+].[K+]).',
  importing: 'Importing…',
  importFailed: 'Not recognised: ',
  addCompound: 'Add compound',
  searchPh: 'Name / abbreviation / CAS / SMILES',
  search: 'Search',
  searching: 'Searching…',
  localResults: 'Common reagents',
  pubchemResults: 'PubChem',
  noResults: 'No results. Try another name, a CAS number or SMILES, or add manually.',
  manualAdd: 'Add manually',
  manualName: 'Name',
  manualFormula: 'Formula',
  manualMw: 'MW',
  add: 'Add',
  addAs: 'Add as',
  networkError: 'Network error – PubChem is unreachable',
  preview: 'Reaction scheme',
  previewEmpty: 'Add compounds or import a reaction to see the scheme',
  rdkitLoading: 'Loading structure renderer…',
  table: 'Reagent table',
  roles: { reactant: 'Reactant', reagent: 'Reagent', catalyst: 'Catalyst', solvent: 'Solvent', product: 'Product' },
  forms: { neat: 'Neat', solutionM: 'Solution (M)', solutionWt: 'Solution (wt%)' },
  col: {
    ref: 'Ref',
    name: 'Compound',
    role: 'Role',
    mw: 'MW',
    form: 'Form',
    conc: 'Conc.',
    density: 'Density g/mL',
    purity: 'Purity %',
    equiv: 'Equiv',
    amount: 'Amount',
    mass: 'Mass',
    volume: 'Volume',
  },
  refTip: 'Set as reference (1.0 equiv, usually the limiting reagent)',
  theoMass: 'Theor. yield',
  actualMass: 'Isolated',
  yield: 'Yield',
  solventConc: 'Conc. M',
  solventConcTip: 'Concentration of the reference compound in this solvent',
  solnDensity: 'Soln. density',
  needMw: 'MW needed',
  needDensity: 'density needed',
  scale: 'Scale',
  plan: 'Plan from product target',
  planTarget: 'Target mass',
  planYield: 'Expected yield %',
  planApply: 'Apply',
  units: 'Units',
  exportMd: 'Copy Markdown',
  exportCsv: 'Export CSV',
  print: 'Print',
  copied: 'Copied',
  notes: 'Notes / procedure',
  saved: 'Saved reactions',
  save: 'Save',
  newReaction: 'New',
  load: 'Open',
  delete: 'Delete',
  confirmDelete: 'Delete this reaction?',
  noSaved: 'No saved reactions yet',
  details: 'Compound properties',
  close: 'Close',
  formula: 'Formula',
  iupac: 'IUPAC name',
  meltingPoint: 'Melting point',
  boilingPoint: 'Boiling point',
  flashPoint: 'Flash point',
  solubility: 'Solubility',
  ghs: 'GHS hazards',
  noData: 'No data',
  loadingDetails: 'Fetching properties from PubChem…',
  useDensity: 'Use this density',
  fetchFromPubchem: 'Look up in PubChem',
  dataSource: 'Source: PubChem. Always check the reagent label / SDS.',
  rename: 'Name',
  footer: 'Results are for reference only — verify reagent specifications and safety data sheets.',
};

const DICTS: Record<Lang, Dict> = { zh, en };

interface Ctx { t: Dict; lang: Lang; setLang: (l: Lang) => void }
const I18nContext = createContext<Ctx | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = DICTS[lang].appTitle;
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang]);
  return <I18nContext.Provider value={{ t: DICTS[lang], lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
