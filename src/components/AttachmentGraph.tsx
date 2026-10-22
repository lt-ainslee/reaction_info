// Node-graph view of a reaction's attachments (lazy-loaded):
// product → sample → raw data → processed / exports / peak lists, left to right.
import dagre from '@dagrejs/dagre';
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react';
import { previewUrl, type Attachment, type Link } from '../attachments/api';
import { displayName, nodeTypeOf, wouldCycle, type Index } from '../attachments/graph';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';
import { PRODUCT } from './attachmentGraphIds';
import { NmrMetaLine } from './NmrMetaLine';

export { PRODUCT };

export interface AttachmentGraphProps {
  reactionId: string;
  nodes: Attachment[];
  links: Link[];
  ix: Index;
  products: Component[];
  selectedId: string | null;
  /** Bumped by the parent to request an automatic layout. */
  tidyToken: number;
  onSelect: (id: string | null) => void;
  onOpen: (n: Attachment) => void;
  /** `from` may be a product id (PRODUCT + compound id). */
  onConnect: (from: string, to: string) => void;
  onDisconnect: (from: string, to: string) => void;
  onMove: (positions: Record<string, [number, number]>) => void;
  /** Files dropped on a node (or on the canvas when nodeId is null). */
  onDrop: (nodeId: string | null, dt: DataTransfer) => void;
}

interface AttData extends Record<string, unknown> {
  att: Attachment;
  downstream: number;
  onDrop: (nodeId: string, dt: DataTransfer) => void;
}

interface ProductData extends Record<string, unknown> {
  name: string;
  formula?: string;
  label: string;
}

const SIZE = {
  product: { w: 190, h: 62 },
  att: { w: 210, h: 66 },
  attPreview: { w: 230, h: 128 },
};

const onDragOverNode = (e: DragEvent) => {
  if ([...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drop');
  }
};

const AttNode = memo(function AttNode({ data, selected }: NodeProps<Node<AttData>>) {
  const { t } = useI18n();
  const { att, downstream } = data;
  const type = nodeTypeOf(att);
  return (
    <div
      className={`gnode t-${type}${selected ? ' selected' : ''}`}
      onDragOver={onDragOverNode}
      onDragLeave={(e) => e.currentTarget.classList.remove('drop')}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drop');
        data.onDrop(att.id, e.dataTransfer);
      }}
    >
      <Handle type="target" position={Position.Left} className="ghandle" />
      <div className="gnode-strip">
        <span>{t.att.nodeTypes[type]}</span>
        {att.kind !== 'sample' && att.kind !== 'text' && <span className="gnode-kind">{t.att.kinds[att.kind]}</span>}
      </div>
      {att.hasPreview && <img className="gnode-thumb" src={previewUrl(att.id)} alt="" draggable={false} />}
      <div className="gnode-body">
        <div className="gnode-title" title={displayName(att)}>{displayName(att)}</div>
        <div className="gnode-sub">
          {att.kind === 'nmr' ? (
            <NmrMetaLine att={att} />
          ) : type === 'peaklist' ? (
            String(att.meta.text ?? '').slice(0, 60) || '—'
          ) : (
            att.note || ' '
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={'ghandle' + (downstream ? '' : ' open')} />
    </div>
  );
});

const ProductNode = memo(function ProductNode({ data, selected }: NodeProps<Node<ProductData>>) {
  return (
    <div className={`gnode t-product${selected ? ' selected' : ''}`}>
      <div className="gnode-strip">
        <span>{data.label}</span>
      </div>
      <div className="gnode-body">
        <div className="gnode-title">{data.name}</div>
        <div className="gnode-sub">{data.formula ?? ' '}</div>
      </div>
      <Handle type="source" position={Position.Right} className="ghandle" />
    </div>
  );
});

const nodeTypes = { att: AttNode, product: ProductNode };

const productPosKey = (rid: string) => `graph-product-pos-${rid}`;
function loadProductPos(rid: string): Record<string, [number, number]> {
  try {
    return JSON.parse(localStorage.getItem(productPosKey(rid)) ?? '{}');
  } catch {
    return {};
  }
}
function saveProductPos(rid: string, pos: Record<string, [number, number]>) {
  try {
    localStorage.setItem(productPosKey(rid), JSON.stringify({ ...loadProductPos(rid), ...pos }));
  } catch {
    /* ignore */
  }
}

/** Left-to-right layered layout (dagre). */
function autoLayout(nodes: Node[], edges: Edge[]): Record<string, [number, number]> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width ?? SIZE.att.w, height: n.height ?? SIZE.att.h });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out: Record<string, [number, number]> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    out[n.id] = [Math.round(p.x - (n.width ?? 0) / 2), Math.round(p.y - (n.height ?? 0) / 2)];
  }
  return out;
}

function Graph(props: AttachmentGraphProps) {
  const { t } = useI18n();
  const { fitView } = useReactFlow();
  const { reactionId, nodes: atts, links, ix, products, onConnect, onDisconnect, onMove } = props;

  const onDropNode = useCallback((id: string, dt: DataTransfer) => props.onDrop(id, dt), [props]);

  // Graph model from props (positions filled below).
  const model = useMemo(() => {
    const rfNodes: Node[] = [
      ...products.map((p) => ({
        id: PRODUCT + p.id,
        type: 'product',
        position: { x: 0, y: 0 },
        width: SIZE.product.w,
        height: SIZE.product.h,
        data: { name: p.name, formula: p.formula, label: t.att.nodeTypes.product } satisfies ProductData,
      })),
      ...atts.map((a) => {
        const size = a.hasPreview ? SIZE.attPreview : SIZE.att;
        return {
          id: a.id,
          type: 'att',
          position: { x: 0, y: 0 },
          width: size.w,
          height: size.h,
          data: { att: a, downstream: (ix.children.get(a.id) ?? []).length, onDrop: onDropNode } satisfies AttData,
        };
      }),
    ];
    const edges: Edge[] = [
      ...links
        .filter((l) => ix.byId.has(l.from) && ix.byId.has(l.to))
        .map((l) => ({
          id: `${l.from}->${l.to}`,
          source: l.from,
          target: l.to,
          label: l.relation ? t.att.relations[l.relation] : undefined,
          className: 'gedge',
        })),
      // Product → its top-level nodes (nodes with inputs inherit the product).
      ...atts
        .filter((a) => a.compoundId && products.some((p) => p.id === a.compoundId) && !(ix.parents.get(a.id) ?? []).length)
        .map((a) => ({ id: `${PRODUCT}${a.compoundId}->${a.id}`, source: PRODUCT + a.compoundId, target: a.id, className: 'gedge gedge-product' })),
    ];
    return { rfNodes, edges };
  }, [atts, links, ix, products, t, onDropNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Merge positions: current (being dragged) > saved > automatic layout.
  useEffect(() => {
    const auto = autoLayout(model.rfNodes, model.edges);
    const productPos = loadProductPos(reactionId);
    setNodes((current) => {
      const cur = new Map(current.map((n) => [n.id, n.position]));
      return model.rfNodes.map((n) => {
        const att = ix.byId.get(n.id);
        const saved = att?.pos ?? productPos[n.id.slice(PRODUCT.length)];
        const p = cur.get(n.id) ?? (saved ? { x: saved[0], y: saved[1] } : { x: auto[n.id][0], y: auto[n.id][1] });
        return { ...n, position: p, selected: n.id === props.selectedId };
      });
    });
    setEdges(model.edges);
  }, [model, reactionId, ix, setNodes, setEdges, props.selectedId]);

  // Re-fit when nodes are added or removed (uploads, new samples).
  const count = model.rfNodes.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (lastCount.current === count) return;
    lastCount.current = count;
    const id = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(id);
  }, [count, fitView]);

  // "Tidy up": automatic layout for everything, saved.
  useEffect(() => {
    if (!props.tidyToken) return;
    const auto = autoLayout(model.rfNodes, model.edges);
    setNodes((ns) => ns.map((n) => ({ ...n, position: { x: auto[n.id][0], y: auto[n.id][1] } })));
    const atPos: Record<string, [number, number]> = {};
    const prodPos: Record<string, [number, number]> = {};
    for (const [id, p] of Object.entries(auto)) {
      if (id.startsWith(PRODUCT)) prodPos[id.slice(PRODUCT.length)] = p;
      else atPos[id] = p;
    }
    saveProductPos(reactionId, prodPos);
    onMove(atPos);
    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tidyToken]);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.target.startsWith(PRODUCT)) return false;
      if (c.source.startsWith(PRODUCT)) return true;
      return !wouldCycle(ix, c.source, c.target);
    },
    [ix],
  );

  return (
    <div className="graph-wrap" onDragOver={(e) => [...e.dataTransfer.types].includes('Files') && e.preventDefault()} onDrop={(e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      props.onDrop(null, e.dataTransfer);
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        colorMode="system"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        isValidConnection={isValidConnection}
        onConnect={(c) => c.source && c.target && onConnect(c.source, c.target)}
        onBeforeDelete={async ({ edges: del }) => {
          // Only links can be deleted from the canvas (Delete key); nodes go through the inspector.
          for (const e of del) onDisconnect(e.source, e.target);
          return false;
        }}
        onNodeClick={(_, n) => props.onSelect(n.id.startsWith(PRODUCT) ? null : n.id)}
        onPaneClick={() => props.onSelect(null)}
        onNodeDoubleClick={(_, n) => {
          const a = ix.byId.get(n.id);
          if (a?.hasFile) props.onOpen(a);
        }}
        onNodeDragStop={(_, __, dragged) => {
          const atPos: Record<string, [number, number]> = {};
          const prodPos: Record<string, [number, number]> = {};
          for (const n of dragged) {
            const p: [number, number] = [Math.round(n.position.x), Math.round(n.position.y)];
            if (n.id.startsWith(PRODUCT)) prodPos[n.id.slice(PRODUCT.length)] = p;
            else atPos[n.id] = p;
          }
          if (Object.keys(prodPos).length) saveProductPos(reactionId, prodPos);
          if (Object.keys(atPos).length) onMove(atPos);
        }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function AttachmentGraph(props: AttachmentGraphProps) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
