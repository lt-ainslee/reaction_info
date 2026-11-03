import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PNode } from '../procedure/doc';
import { buildDocx, type Block } from './docx';
import { tableGrid } from './grid';
import { procedureBlocks } from './report';

const txt = (text: string): PNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (type: string, text: string, attrs: Record<string, unknown> = {}): PNode => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [txt(text)] });
const row = (...cells: PNode[]): PNode => ({ type: 'tableRow', content: cells });

// | Reagent (2 rows) | Amount (2 cols)  | Note |
// |                  | mmol    | g      | –    |
// | NaH              | 1.0     | 0.04   | dry  |
const fixture: PNode = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        row(cell('tableHeader', 'Reagent', { rowspan: 2 }), cell('tableHeader', 'Amount', { colspan: 2 }), cell('tableHeader', 'Note')),
        row(cell('tableCell', 'mmol'), cell('tableCell', 'g'), cell('tableCell', '–')),
        row(cell('tableCell', 'NaH'), cell('tableCell', '1.0'), cell('tableCell', '0.04'), cell('tableCell', 'dry')),
      ],
    },
  ],
};

async function documentXml(blocks: Block[]): Promise<string> {
  const zip = unzipSync(new Uint8Array(await buildDocx(blocks).arrayBuffer()));
  return strFromU8(zip['word/document.xml']);
}

/** Text of each <w:tc> per <w:tr>, plus its gridSpan / vMerge marks. */
function cellsOf(xml: string): string[][] {
  return [...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/g)].map((m) =>
    [...m[1].matchAll(/<w:tc>(.*?)<\/w:tc>/g)].map((c) => {
      const text = [...c[1].matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map((t) => t[1]).join('');
      const span = c[1].match(/<w:gridSpan w:val="(\d+)"\/>/)?.[1];
      const merge = c[1].includes('<w:vMerge w:val="restart"/>') ? '↓' : c[1].includes('<w:vMerge/>') ? '^' : '';
      return `${merge}${text}${span ? `×${span}` : ''}`;
    }),
  );
}

describe('tableGrid', () => {
  it('places cells past rowspans and colspans', () => {
    const { cells, cols } = tableGrid([[{ rowspan: 2 }, { colspan: 2 }, {}], [{}, {}, {}], [{}, {}, {}, {}]]);
    expect(cols).toBe(4);
    expect(cells.map((r) => r.map((c) => [c.c, c.rowspan, c.colspan]))).toEqual([
      [[0, 2, 1], [1, 1, 2], [3, 1, 1]],
      [[1, 1, 1], [2, 1, 1], [3, 1, 1]],
      [[0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1]],
    ]);
  });
  it('clamps spans to the table and never overlaps', () => {
    const { cells } = tableGrid([[{}, { rowspan: 5 }], [{ colspan: 3 }]]);
    expect(cells[0][1]).toEqual({ r: 0, c: 1, rowspan: 2, colspan: 1 });
    // Runs into the rowspan from above at column 1, so it is cut to 1 column.
    expect(cells[1][0]).toEqual({ r: 1, c: 0, rowspan: 1, colspan: 1 });
  });
});

describe('procedureBlocks tables', () => {
  it('passes cell spans through', () => {
    const [b] = procedureBlocks(fixture, 'Obs');
    expect(b.kind === 'table' && b.spans?.[0]).toEqual([{ colspan: 1, rowspan: 2 }, { colspan: 2, rowspan: 1 }, { colspan: 1, rowspan: 1 }]);
  });

  it('writes merged cells into the .docx on their logical columns', async () => {
    const xml = await documentXml(procedureBlocks(fixture, 'Obs'));
    expect(xml.match(/<w:gridCol /g)).toHaveLength(4);
    expect(cellsOf(xml)).toEqual([
      ['↓Reagent', 'Amount×2', 'Note'],
      ['^', 'mmol', 'g', '–'],
      ['NaH', '1.0', '0.04', 'dry'],
    ]);
  });

  it('leaves tables without merges as before', async () => {
    const xml = await documentXml([{ kind: 'table', rows: [[[{ text: 'a' }], [{ text: 'b' }]]] }]);
    expect(cellsOf(xml)).toEqual([['a', 'b']]);
    expect(xml).not.toContain('vMerge');
  });
});
