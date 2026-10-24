// Minimal .docx writer: paragraphs (with bold / italic / sub- / superscript
// runs), tables and one kind of image, A4 page.
import { pack, x, XML_HEAD } from './xml';

export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sub?: boolean;
  sup?: boolean;
  color?: string;
  /** Line break before the text. */
  br?: boolean;
}

export type Style = 'Title' | 'Heading1' | 'Heading2' | 'Heading3' | 'Small' | 'Caption';

export type Block =
  | { kind: 'p'; runs: Run[]; style?: Style; indent?: number; hanging?: number; shade?: 'note' | 'obs'; align?: 'center' | 'right'; keepNext?: boolean }
  | { kind: 'table'; rows: Run[][][]; header?: boolean; widths?: number[]; align?: ('left' | 'right')[]; small?: boolean }
  | { kind: 'image'; png: Uint8Array; width: number; height: number };

export const p = (text: string | Run[], opts: Omit<Extract<Block, { kind: 'p' }>, 'kind' | 'runs'> = {}): Block => ({
  kind: 'p',
  runs: typeof text === 'string' ? [{ text }] : text,
  ...opts,
});

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function run(r: Run): string {
  const pr = [
    r.b && '<w:b/>',
    r.i && '<w:i/>',
    r.u && '<w:u w:val="single"/>',
    r.s && '<w:strike/>',
    r.color && `<w:color w:val="${r.color}"/>`,
    r.sub && '<w:vertAlign w:val="subscript"/>',
    r.sup && '<w:vertAlign w:val="superscript"/>',
  ]
    .filter(Boolean)
    .join('');
  // Line breaks inside the text become <w:br/>.
  const pieces = r.text.split('\n').map((t, i) => `${i || r.br ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(t)}</w:t>`).join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${pieces}</w:r>`;
}

function para(b: Extract<Block, { kind: 'p' }>): string {
  const pr = [
    b.style && `<w:pStyle w:val="${b.style}"/>`,
    b.keepNext && '<w:keepNext/>',
    b.shade === 'obs' && '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="18794E"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF7F1"/>',
    b.shade === 'note' && '<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="F2C48D"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF4E8"/>',
    (b.indent || b.hanging) && `<w:ind w:left="${b.indent ?? 0}"${b.hanging ? ` w:hanging="${b.hanging}"` : ''}/>`,
    b.align && `<w:jc w:val="${b.align}"/>`,
  ]
    .filter(Boolean)
    .join('');
  return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${b.runs.map(run).join('')}</w:p>`;
}

function table(b: Extract<Block, { kind: 'table' }>): string {
  const cols = b.rows[0]?.length ?? 0;
  const widths = b.widths ?? Array.from({ length: cols }, () => Math.floor(9000 / Math.max(cols, 1)));
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const rows = b.rows
    .map((r, ri) => {
      const head = b.header && ri === 0;
      const cells = r
        .map((runs, ci) => {
          const jc = b.align?.[ci] === 'right' ? '<w:jc w:val="right"/>' : '';
          const style = `<w:pStyle w:val="${b.small ? 'TableSmall' : 'Table'}"/>`;
          const content = (head ? runs.map((x) => ({ ...x, b: true })) : runs).map(run).join('');
          return (
            `<w:tc><w:tcPr><w:tcW w:w="${widths[ci] ?? 0}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EDF2FD"/>' : ''}</w:tcPr>` +
            `<w:p><w:pPr>${style}${jc}</w:pPr>${content}</w:p></w:tc>`
          );
        })
        .join('');
      return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    })
    .join('');
  return (
    '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `${grid}${rows}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`
  );
}

function image(b: Extract<Block, { kind: 'image' }>, rid: string, n: number): string {
  // Fit the text width (16 cm).
  const maxW = 16 * 360000;
  let cx = Math.round(b.width * 9525);
  let cy = Math.round(b.height * 9525);
  if (cx > maxW) {
    cy = Math.round((cy * maxW) / cx);
    cx = maxW;
  }
  return (
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

const FONT = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>';
const style = (id: string, name: string, ppr: string, rpr: string, based = 'Normal') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;

const STYLES =
  XML_HEAD +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>` +
  '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  style('Title', 'Title', '<w:spacing w:after="60"/>', '<w:b/><w:sz w:val="36"/><w:color w:val="1D2330"/>') +
  style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="CFD4DC"/></w:pBdr><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="24"/><w:color w:val="2F5FD0"/>') +
  style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="21"/>') +
  style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="120" w:after="40"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="20"/>') +
  style('Small', 'Small', '<w:spacing w:after="40"/>', '<w:sz w:val="17"/><w:color w:val="6B7282"/>') +
  style('Caption', 'Caption', '<w:jc w:val="center"/><w:spacing w:after="120"/>', '<w:sz w:val="17"/><w:color w:val="6B7282"/>') +
  style('Table', 'Table text', '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/>') +
  style('TableSmall', 'Table text small', '<w:spacing w:before="10" w:after="10" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="16"/>') +
  '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="CFD4DC"/>`).join('') +
  '</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

export function buildDocx(blocks: Block[], title = ''): Blob {
  const media: Record<string, Uint8Array> = {};
  const rels: string[] = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  let n = 0;
  const body = blocks
    .map((b) => {
      if (b.kind === 'p') return para(b);
      if (b.kind === 'table') return b.rows.length ? table(b) : '';
      n++;
      const rid = `rIdImg${n}`;
      media[`word/media/image${n}.png`] = b.png;
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.png"/>`);
      return image(b, rid, n);
    })
    .join('');
  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  return pack(
    {
      '[Content_Types].xml':
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>',
      '_rels/.rels':
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
      'docProps/core.xml':
        XML_HEAD +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<dc:title>${x(title)}</dc:title></cp:coreProperties>`,
      'word/_rels/document.xml.rels':
        XML_HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
      'word/styles.xml': STYLES,
      'word/document.xml': `${XML_HEAD}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`,
      ...media,
    },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
}
