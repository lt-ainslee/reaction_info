// Import an existing inventory spreadsheet (CSV or .xlsx): read the first
// sheet, match column headers (Chinese or English) to inventory fields.
import { strFromU8, unzipSync } from 'fflate';
import { compoundKey, type ReagentLot, type StockStatus } from '../chem/lots';

export type Field =
  | 'name' | 'cas' | 'smiles' | 'formula' | 'mw' | 'supplier' | 'spec' | 'catalogNumber' | 'lotNumber' | 'quantity' | 'remaining'
  | 'location' | 'status' | 'receivedAt' | 'expiresAt' | 'purity' | 'molarity' | 'density' | 'owner' | 'note';

/** Header words for each field (lower-case, compared without spaces / punctuation). */
const ALIASES: Record<Field, string[]> = {
  name: ['名称', '试剂名称', '中文名', '中文名称', '品名', '化合物', '药品名称', 'name', 'reagent', 'chemical', 'compound', 'englishname', '英文名'],
  cas: ['cas', 'cas号', 'casno', 'casnumber', 'cas编号'],
  smiles: ['smiles', '结构'],
  formula: ['分子式', 'formula', 'molecularformula'],
  mw: ['分子量', 'mw', 'molecularweight', 'molwt', 'fw'],
  supplier: ['供应商', '厂家', '品牌', '生产商', '厂商', 'supplier', 'brand', 'vendor', 'manufacturer'],
  spec: ['规格', '纯度等级', '等级', 'grade', 'spec', 'specification', '纯度规格'],
  catalogNumber: ['货号', '产品编号', '目录号', 'catalog', 'catalogno', 'catno', 'cat', 'productno', 'sku'],
  lotNumber: ['批号', '批次', 'lot', 'lotno', 'batch', 'batchno'],
  quantity: ['包装', '数量', '包装规格', '容量', 'quantity', 'size', 'packsize', 'amount', 'package'],
  remaining: ['余量', '剩余', '剩余量', 'remaining', 'left'],
  location: ['位置', '存放位置', '存放地点', '柜号', '储存位置', 'location', 'storage', 'shelf', 'cabinet'],
  status: ['状态', 'status'],
  receivedAt: ['到货日期', '入库日期', '购买日期', '开封日期', 'received', 'receiveddate', 'purchasedate', 'date'],
  expiresAt: ['有效期', '过期日期', '失效日期', 'expiry', 'expires', 'expirydate', 'expirationdate'],
  purity: ['纯度', '含量', 'purity', 'assay'],
  molarity: ['浓度', '摩尔浓度', 'molarity', 'concentration', 'conc'],
  density: ['密度', 'density'],
  owner: ['负责人', '保管人', '购买人', 'owner', 'responsible'],
  note: ['备注', '说明', 'note', 'notes', 'remark', 'remarks', 'comment'],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./:：()（）#]+/g, '');

/** Column index → field, from the header row. */
export function mapHeaders(header: string[]): (Field | null)[] {
  const used = new Set<Field>();
  return header.map((h) => {
    const n = norm(h);
    if (!n) return null;
    const exact = (Object.keys(ALIASES) as Field[]).find((f) => !used.has(f) && ALIASES[f].some((a) => norm(a) === n));
    const partial = exact ?? (Object.keys(ALIASES) as Field[]).find((f) => !used.has(f) && ALIASES[f].some((a) => a.length > 1 && n.includes(norm(a))));
    if (partial) used.add(partial);
    return partial ?? null;
  });
}

/** CSV / TSV (quotes, embedded newlines, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, ''); // BOM
  const first = src.split('\n', 1)[0];
  const sep = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

/** Excel serial date → YYYY-MM-DD. */
const excelDate = (serial: number) => new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10);

/** First worksheet of an .xlsx file as rows of strings (dates in date-formatted cells become YYYY-MM-DD). */
export function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  const xml = (path: string) => (files[path] ? new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml') : null);
  const wb = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const firstSheet = wb?.getElementsByTagName('sheet')[0];
  const rid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const sheet = xml(path) ?? xml('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('no worksheet');
  const shared = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
  );
  // Cell styles that are dates (built-in date formats 14–22, or custom formats with y/d).
  const styles = xml('xl/styles.xml');
  const custom = new Map([...(styles?.getElementsByTagName('numFmt') ?? [])].map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
  const xfs = [...(styles?.getElementsByTagName('cellXfs')[0]?.getElementsByTagName('xf') ?? [])];
  const isDateStyle = (s: number) => {
    const id = Number(xfs[s]?.getAttribute('numFmtId') ?? 0);
    return (id >= 14 && id <= 22) || /[yd]/i.test((custom.get(id) ?? '').replace(/"[^"]*"/g, ''));
  };
  const rows: string[][] = [];
  for (const r of [...sheet.getElementsByTagName('row')]) {
    const row: string[] = [];
    for (const c of [...r.getElementsByTagName('c')]) {
      const i = colIndex(c.getAttribute('r') ?? '');
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let text: string;
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
      else if (!type && v && isDateStyle(Number(c.getAttribute('s') ?? 0))) text = excelDate(Number(v));
      else text = v;
      row[i] = text;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const STATUS_WORDS: [RegExp, StockStatus][] = [
  [/用完|已用|空|empty|used ?up|finished/i, 'empty'],
  [/报废|废弃|处理|丢弃|disposed|discard/i, 'disposed'],
  [/不足|少|低|low/i, 'low'],
];

const numOf = (s: string) => {
  const m = /-?\d+(\.\d+)?/.exec(s.replace(/,/g, ''));
  return m ? Number(m[0]) : undefined;
};

const date = (s: string) => {
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
};

/** Rows (header first) → inventory lots. Rows without a name or CAS are skipped. */
export function rowsToLots(rows: string[][], newId: () => string, now = Date.now()): { lots: ReagentLot[]; fields: (Field | null)[]; skipped: number } {
  const [header = [], ...body] = rows;
  const fields = mapHeaders(header);
  const lots: ReagentLot[] = [];
  let skipped = 0;
  for (const r of body) {
    const get = (f: Field) => {
      const i = fields.indexOf(f);
      return i >= 0 ? (r[i] ?? '').trim() : '';
    };
    const name = get('name') || get('cas');
    if (!name) {
      skipped++;
      continue;
    }
    const cas = /^\d{2,7}-\d{2}-\d$/.test(get('cas')) ? get('cas') : undefined;
    const statusText = get('status');
    const status = STATUS_WORDS.find(([re]) => re.test(statusText))?.[1] ?? 'in_stock';
    const purity = numOf(get('purity') || (/(\d+(\.\d+)?)\s*%/.exec(get('spec'))?.[0] ?? ''));
    const molarity = numOf(get('molarity'));
    const lot: ReagentLot = {
      id: newId(),
      key: '',
      name,
      ...(cas ? { cas } : {}),
      ...(get('smiles') ? { smiles: get('smiles') } : {}),
      compound: {
        ...(get('formula') ? { formula: get('formula') } : {}),
        ...(numOf(get('mw')) ? { mw: numOf(get('mw')) } : {}),
        ...(numOf(get('density')) ? { density: numOf(get('density')) } : {}),
        ...(molarity ? { form: 'solutionM' as const, molarity } : {}),
      },
      supplier: get('supplier') || undefined,
      spec: get('spec') || undefined,
      catalogNumber: get('catalogNumber') || undefined,
      lotNumber: get('lotNumber') || undefined,
      quantity: get('quantity') || undefined,
      remaining: get('remaining') || undefined,
      location: get('location') || undefined,
      receivedAt: date(get('receivedAt')),
      expiresAt: date(get('expiresAt')),
      owner: get('owner') || undefined,
      note: get('note') || undefined,
      ...(purity && purity > 0 && purity <= 100 && get('purity') ? { purity } : {}),
      status,
      createdAt: now,
      updatedAt: now,
    };
    lot.key = compoundKey(lot);
    lots.push(lot);
  }
  return { lots, fields, skipped };
}
