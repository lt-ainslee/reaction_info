// Logical layout of a table whose cells may span several rows / columns
// (HTML / Tiptap `colspan` / `rowspan`).

export interface CellSpan {
  rowspan?: number;
  colspan?: number;
}

/** Where one source cell sits: top-left grid position and its (clamped) size. */
export interface GridCell {
  r: number;
  c: number;
  rowspan: number;
  colspan: number;
}

const span = (v: number | undefined) => (v && Number.isFinite(v) && v >= 1 ? Math.trunc(v) : 1);

/**
 * Places each source cell on the grid, row by row: a cell takes the first
 * column not already covered by a rowspan from above, and covers
 * rowspan × colspan positions. Spans are clamped to the table's last row and
 * shrunk where they would run into an already-taken position, so cells never
 * overlap. `cells` has the same shape as `spans`.
 */
export function tableGrid(spans: CellSpan[][]): { cells: GridCell[][]; cols: number } {
  const taken: Set<number>[] = spans.map(() => new Set());
  let cols = 0;
  const cells = spans.map((row, r) => {
    let c = 0;
    return row.map((s) => {
      while (taken[r].has(c)) c++;
      let colspan = 1;
      while (colspan < span(s.colspan) && !taken[r].has(c + colspan)) colspan++;
      let rowspan = 1;
      const free = (rr: number) => Array.from({ length: colspan }, (_, k) => c + k).every((cc) => !taken[rr].has(cc));
      while (rowspan < span(s.rowspan) && r + rowspan < spans.length && free(r + rowspan)) rowspan++;
      for (let rr = r; rr < r + rowspan; rr++) for (let cc = c; cc < c + colspan; cc++) taken[rr].add(cc);
      const cell = { r, c, rowspan, colspan };
      c += colspan;
      cols = Math.max(cols, c);
      return cell;
    });
  });
  return { cells, cols };
}
