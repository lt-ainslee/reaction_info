// List view of the attachments card (mobile default): compounds, their lots
// and nodes, indented like the graph.
import { useMemo } from 'react';
import { formatSize, previewUrl, type Attachment } from '../attachments/api';
import { displayName, nodeTypeOf, type Index } from '../attachments/graph';
import { useI18n } from '../i18n';
import type { VNode } from './AttachmentGraph';
import { NmrMetaLine } from './NmrMetaLine';
import { isRoot } from './useAttachmentGraph';

interface Props {
  virtual: VNode[];
  nodes: Attachment[];
  ix: Index;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onView: (a: Attachment) => void;
}

type Row = { kind: 'v'; v: VNode; depth: number } | { kind: 'n'; node: Attachment; depth: number; alsoFrom: string[] };

export function AttachmentList({ virtual, nodes, ix, selectedId, onSelect, onView }: Props) {
  const { t } = useI18n();
  const nameOf = (id: string) => {
    const n = ix.byId.get(id);
    return n ? displayName(n) : id;
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    const placed = new Set<string>();
    const visit = (id: string, depth: number) => {
      const n = ix.byId.get(id);
      if (!n || placed.has(id)) return;
      placed.add(id);
      out.push({ kind: 'n', node: n, depth, alsoFrom: (ix.parents.get(id) ?? []).slice(1) });
      for (const c of ix.children.get(id) ?? []) if ((ix.parents.get(c) ?? [])[0] === id) visit(c, depth + 1);
    };
    const vById = new Map(virtual.map((v) => [v.id, v]));
    for (const v of virtual.filter((x) => x.kind === 'compound')) {
      out.push({ kind: 'v', v, depth: 0 });
      for (const to of v.targets) {
        const lot = vById.get(to);
        if (lot) {
          out.push({ kind: 'v', v: lot, depth: 1 });
          for (const r of lot.targets) visit(r, 2);
        } else visit(to, 1);
      }
    }
    for (const n of nodes) if (isRoot(ix, n.id)) visit(n.id, 0);
    return out;
  }, [virtual, ix, nodes]);

  const toggle = (id: string) => onSelect(id === selectedId ? null : id);

  return (
    <div className="att-tree">
      {rows.map((r) => {
        if (r.kind === 'v') {
          const v = r.v;
          return (
            <div
              key={v.id}
              className={'att-row att-vrow ' + v.cls + (v.id === selectedId ? ' selected' : '')}
              style={{ paddingLeft: `${r.depth * 22 + 8}px` }}
              onClick={() => toggle(v.id)}
            >
              {r.depth > 0 && <span className="att-branch" aria-hidden>└</span>}
              <span className="att-type-dot" aria-hidden />
              <div className="att-row-main">
                <div className="att-row-title">
                  <span className="att-row-type">{v.strip}</span>
                  <span>{v.title}</span>
                </div>
                {v.sub && <div className="att-row-sub muted small">{v.sub}</div>}
              </div>
            </div>
          );
        }
        const { node: a, depth, alsoFrom } = r;
        const type = nodeTypeOf(a);
        return (
          <div
            key={a.id}
            className={'att-row t-' + type + (a.id === selectedId ? ' selected' : '')}
            style={{ paddingLeft: `${depth * 22 + 8}px` }}
            onClick={() => toggle(a.id)}
          >
            {depth > 0 && <span className="att-branch" aria-hidden>└</span>}
            {a.hasPreview ? (
              <img className="att-row-thumb" src={previewUrl(a.id)} alt="" loading="lazy" />
            ) : (
              <span className={'att-type-dot t-' + type} aria-hidden />
            )}
            <div className="att-row-main">
              <div className="att-row-title">
                <span className="att-row-type">{t.att.nodeTypes[type]}</span>
                {a.hasFile ? (
                  <button
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(a);
                    }}
                  >
                    {displayName(a)}
                  </button>
                ) : (
                  <span>{displayName(a)}</span>
                )}
              </div>
              <div className="att-row-sub muted small">
                {a.kind === 'nmr' && <NmrMetaLine att={a} />}
                {a.hasFile && <span>{formatSize(a.size)}</span>}
                {type === 'peaklist' && <span>{String(a.meta.text ?? '').slice(0, 80)}</span>}
                {a.note && <span>{a.note}</span>}
                {alsoFrom.length > 0 && <span>{t.att.alsoFrom.replace('{list}', alsoFrom.map(nameOf).join(', '))}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
