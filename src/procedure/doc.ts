// Rich-text procedure documents: the ProseMirror / Tiptap JSON the editor
// stores, plus dependency-free conversions used by the report, exports and
// search (the editor itself is lazy-loaded).

export interface PMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PNode[];
  marks?: PMark[];
  text?: string;
}

export interface ProcDoc extends PNode {
  type: 'doc';
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A stored value that looks like a procedure document, else undefined. */
export function asProcDoc(x: unknown): ProcDoc | undefined {
  return isObj(x) && x.type === 'doc' && (x.content === undefined || Array.isArray(x.content)) ? (x as unknown as ProcDoc) : undefined;
}

/** Old plain-text notes → one paragraph per line. */
export function fromPlainText(text: string): ProcDoc {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return {
    type: 'doc',
    content: lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })),
  };
}

/** The document to show for a reaction: the rich text, else its old plain notes. */
export const procedureOf = (r: { procedure?: unknown; notes?: string }): ProcDoc =>
  asProcDoc(r.procedure) ?? fromPlainText(r.notes ?? '');

export function isEmptyDoc(doc: ProcDoc): boolean {
  const has = (n: PNode): boolean =>
    (n.type === 'text' && !!n.text?.trim()) || n.type === 'horizontalRule' || (n.content ?? []).some(has);
  return !has(doc);
}

/** Labels of special blocks in plain text / HTML output. */
export interface DocLabels {
  observation?: string;
}

/** Plain text (for search, CSV/text export and the clipboard). */
export function toPlainText(doc: ProcDoc, labels: DocLabels = {}): string {
  const inline = (n: PNode): string =>
    n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join('');
  const block = (n: PNode, prefix = ''): string[] => {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        return [prefix + inline(n)];
      case 'bulletList':
      case 'orderedList': {
        const start = Number(n.attrs?.start ?? 1);
        return (n.content ?? []).flatMap((li, i) => {
          const mark = n.type === 'orderedList' ? `${start + i}. ` : '• ';
          const lines = (li.content ?? []).flatMap((c) => block(c));
          return lines.map((l, j) => (j === 0 ? prefix + mark + l : prefix + ' '.repeat(mark.length) + l));
        });
      }
      case 'blockquote':
        return (n.content ?? []).flatMap((c) => block(c, prefix + '> '));
      case 'observation': {
        const lines = (n.content ?? []).flatMap((c) => block(c, prefix));
        const label = labels.observation ?? '»';
        return lines.map((l, i) => (i === 0 ? `${prefix}${label}${/[\u4e00-\u9fff]/.test(label) ? '：' : ': '}${l.slice(prefix.length)}` : l));
      }
      case 'horizontalRule':
        return [prefix + '———'];
      case 'table':
        return (n.content ?? []).map((row) => prefix + (row.content ?? []).map((cell) => (cell.content ?? []).map(inline).join(' ')).join('\t'));
      default:
        return (n.content ?? []).flatMap((c) => block(c, prefix));
    }
  };
  return (doc.content ?? []).flatMap((n) => block(n)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
const safeHref = (h: unknown) => (typeof h === 'string' && /^(https?:|mailto:)/i.test(h.trim()) ? h.trim() : undefined);
const intAttr = (v: unknown, min = 1, max = 50) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

const MARK_TAGS: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'u', strike: 's', subscript: 'sub', superscript: 'sup' };

/**
 * Escaped HTML with a fixed set of tags — for the report and for copying
 * into Word. Unknown node types render their children only.
 */
export function toHtml(doc: ProcDoc, labels: DocLabels = {}): string {
  const text = (n: PNode) => {
    let out = esc(n.text ?? '');
    for (const m of n.marks ?? []) {
      if (m.type === 'link') {
        const href = safeHref(m.attrs?.href);
        if (href) out = `<a href="${esc(href)}">${out}</a>`;
      } else if (MARK_TAGS[m.type]) {
        out = `<${MARK_TAGS[m.type]}>${out}</${MARK_TAGS[m.type]}>`;
      }
    }
    return out;
  };
  const kids = (n: PNode): string => (n.content ?? []).map(node).join('');
  const cell = (tag: 'td' | 'th', n: PNode) => {
    const cs = intAttr(n.attrs?.colspan);
    const rs = intAttr(n.attrs?.rowspan);
    return `<${tag}${cs && cs > 1 ? ` colspan="${cs}"` : ''}${rs && rs > 1 ? ` rowspan="${rs}"` : ''}>${kids(n)}</${tag}>`;
  };
  const node = (n: PNode): string => {
    switch (n.type) {
      case 'text':
        return text(n);
      case 'paragraph':
        return `<p>${kids(n) || '<br>'}</p>`;
      case 'heading': {
        const level = intAttr(n.attrs?.level, 1, 6) ?? 3;
        return `<h${level}>${kids(n)}</h${level}>`;
      }
      case 'bulletList':
        return `<ul>${kids(n)}</ul>`;
      case 'orderedList': {
        const start = intAttr(n.attrs?.start, 0, 10000);
        return `<ol${start !== undefined && start !== 1 ? ` start="${start}"` : ''}>${kids(n)}</ol>`;
      }
      case 'listItem':
        return `<li>${kids(n)}</li>`;
      case 'blockquote':
        return `<blockquote>${kids(n)}</blockquote>`;
      case 'observation':
        return `<div class="proc-obs"><div class="proc-obs-label">${esc(labels.observation ?? 'Observation')}</div>${kids(n)}</div>`;
      case 'horizontalRule':
        return '<hr>';
      case 'hardBreak':
        return '<br>';
      case 'table':
        return `<table><tbody>${kids(n)}</tbody></table>`;
      case 'tableRow':
        return `<tr>${kids(n)}</tr>`;
      case 'tableHeader':
        return cell('th', n);
      case 'tableCell':
        return cell('td', n);
      default:
        return kids(n);
    }
  };
  return kids(doc);
}
