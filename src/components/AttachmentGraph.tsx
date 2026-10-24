// Node-graph view of a reaction's characterization data (lazy-loaded), left to
// right: compounds of the run → reagent lots / samples → raw data → processed /
// exports / peak lists. Compound and lot nodes are "virtual" (built by the
// parent from the reaction); the rest are attachments, possibly of several
// owners (the reaction, and each lot used).
import dagre from '@dagrejs/dagre';
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react';
import { previewUrl, type Attachment, type Link } from '../attachments/api';
import { displayName, nodeTypeOf, type Index } from '../attachments/graph';
import { useI18n } from '../i18n';
import { NmrMetaLine } from './NmrMetaLine';

/** A compound of the run, or a reagent lot — drawn as a node, not stored as an attachment. */
export interface VNode {
  id: string;
  kind: 'compound' | 'lot';
  /** Text in the coloured strip ("Reactant", "Reagent lot"). */
  strip: string;
  title: string;
  sub?: string;
  /** CSS class for the colour (t-product, t-reactant, t-lot…). */
  cls: string;
  /** Nodes it points to (dashed edges). */
  targets: string[];
  /** Small status dot (lot identity check). */
  status?: 'ok' | 'issue' | 'unverified';
}

export interface AttachmentGraphProps {
  nodes: Attachment[];
  links: Link[];
  ix: Index;
  virtual: VNode[];
  /** localStorage key for the positions of virtual nodes. */
  posKey: string;
  selectedId: string | null;
  /** Bumped by the parent to request an automatic layout. */
  tidyToken: number;
  /** Bumped by the parent to bring the selected node into view. */
  centerToken: number;
  canConnect: (from: string, to: string) => boolean;
  onSelect: (id: string | null) => void;
  onOpen: (n: Attachment) => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (from: string, to: string) => void;
  /** Positions of attachment nodes after a drag / tidy. */
  onMove: (positions: Record<string, [number, number]>) => void;
  /** Files dropped on a node (or on the canvas when nodeId is null). */
  onDrop: (nodeId: string | null, dt: DataTransfer) => void;
}

interface AttData extends Record<string, unknown> {
  att: Attachment;
  downstream: number;
  onDrop: (nodeId: string, dt: DataTransfer) => void;
}

interface VData extends Record<string, unknown> {
  v: VNode;
  onDrop: (nodeId: string, dt: DataTransfer) => void;
}

const SIZE = {
  virtual: { w: 200, h: 62 },
  att: { w: 210, h: 66 },
  attPreview: { w: 230, h: 128 },
};

const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

/** Drag-and-drop of files onto a node. */
const dropProps = (id: string, onDrop: (id: string, dt: DataTransfer) => void) => ({
  onDragOver: (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drop');
  },
  onDragLeave: (e: DragEvent<HTMLDivElement>) => e.currentTarget.classList.remove('drop'),
  onDrop: (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drop');
    onDrop(id, e.dataTransfer);
  },
});

const AttNode = memo(function AttNode({ data, selected }: NodeProps<Node<AttData>>) {
  const { t } = useI18n();
  const { att, downstream } = data;
  const type = nodeTypeOf(att);
  return (
    <div className={`gnode t-${type}${selected ? ' selected' : ''}`} {...dropProps(att.id, data.onDrop)}>
      <Handle type="target" position={Position.Left} className="ghandle" />
      <div className="gnode-strip">
        <span>{t.att.nodeTypes[type]}</span>
        {att.kind !== 'sample' && att.kind !== 'text' && <span className="gnode-kind">{t.att.kinds[att.kind]}</span>}
      </div>
      {att.hasPreview && <img className="gnode-thumb" src={previewUrl(att.id)} alt="" draggable={false} />}
      <div className="gnode-body">
        <div className="gnode-title" title={displayName(att)}>{displayName(att)}</div>
        <div className="gnode-sub">
          {att.kind === 'nmr' ? <NmrMetaLine att={att} /> : type === 'peaklist' ? String(att.meta.text ?? '').slice(0, 60) || '—' : att.note || ' '}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={'ghandle' + (downstream ? '' : ' open')} />
    </div>
  );
});

const VirtNode = memo(function VirtNode({ data, selected }: NodeProps<Node<VData>>) {
  const { v } = data;
  return (
    <div className={`gnode gvirt ${v.cls}${selected ? ' selected' : ''}`} {...dropProps(v.id, data.onDrop)}>
      {v.kind === 'lot' && <Handle type="target" position={Position.Left} className="ghandle" isConnectable={false} />}
      <div className="gnode-strip">
        <span>{v.strip}</span>
        {v.status && <span className={'gnode-status v-' + v.status} />}
      </div>
      <div className="gnode-body">
        <div className="gnode-title" title={v.title}>{v.title}</div>
        <div className="gnode-sub">{v.sub || ' '}</div>
      </div>
      <Handle type="source" position={Position.Right} className="ghandle" />
    </div>
  );
});

const nodeTypes = { att: AttNode, virtual: VirtNode };

function loadPos(key: string): Record<string, [number, number]> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}
function savePos(key: string, pos: Record<string, [number, number]>) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...loadPos(key), ...pos }));
  } catch {
    /* ignore */
  }
}

/** Left-to-right layered layout (dagre). */
function autoLayout(nodes: Node[], edges: Edge[]): Record<string, [number, number]> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 64, marginx: 20, marginy: 20 });
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
  const { nodes: atts, links, ix, virtual, posKey, onConnect, onDisconnect, onMove, canConnect } = props;
  const isVirtual = useCallback((id: string) => virtual.some((v) => v.id === id), [virtual]);

  const onDropNode = useCallback((id: string, dt: DataTransfer) => props.onDrop(id, dt), [props]);

  const model = useMemo(() => {
    const visible = new Set(atts.map((a) => a.id));
    const rfNodes: Node[] = [
      ...virtual.map((v) => ({
        id: v.id,
        type: 'virtual',
        position: { x: 0, y: 0 },
        width: SIZE.virtual.w,
        height: SIZE.virtual.h,
        data: { v, onDrop: onDropNode } satisfies VData,
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
    const ids = new Set(rfNodes.map((n) => n.id));
    const edges: Edge[] = [
      ...links
        .filter((l) => visible.has(l.from) && visible.has(l.to))
        .map((l) => ({
          id: `${l.from}->${l.to}`,
          source: l.from,
          target: l.to,
          label: l.relation ? t.att.relations[l.relation] : undefined,
          className: 'gedge',
        })),
      ...virtual.flatMap((v) =>
        v.targets.filter((to) => ids.has(to)).map((to) => ({ id: `${v.id}->${to}`, source: v.id, target: to, className: 'gedge gedge-virtual' })),
      ),
    ];
    return { rfNodes, edges };
  }, [atts, links, ix, virtual, t, onDropNode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Positions: current (being dragged) > saved > automatic layout.
  useEffect(() => {
    const auto = autoLayout(model.rfNodes, model.edges);
    const vpos = loadPos(posKey);
    setNodes((current) => {
      const cur = new Map(current.map((n) => [n.id, n.position]));
      return model.rfNodes.map((n) => {
        const saved = ix.byId.get(n.id)?.pos ?? vpos[n.id];
        const p = cur.get(n.id) ?? (saved ? { x: saved[0], y: saved[1] } : { x: auto[n.id][0], y: auto[n.id][1] });
        return { ...n, position: p, selected: n.id === props.selectedId };
      });
    });
    setEdges(model.edges);
  }, [model, posKey, ix, setNodes, setEdges, props.selectedId]);

  // Re-fit when nodes are added or removed (uploads, new samples, another run).
  const count = model.rfNodes.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (lastCount.current === count) return;
    lastCount.current = count;
    const id = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
    return () => clearTimeout(id);
  }, [count, fitView]);

  useEffect(() => {
    if (!props.centerToken || !props.selectedId) return;
    const id = setTimeout(() => fitView({ nodes: [{ id: props.selectedId! }], padding: 1.2, maxZoom: 1.1, duration: 300 }), 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.centerToken]);

  const persist = (pos: Record<string, [number, number]>) => {
    const att: Record<string, [number, number]> = {};
    const virt: Record<string, [number, number]> = {};
    for (const [id, p] of Object.entries(pos)) (isVirtual(id) ? virt : att)[id] = p;
    if (Object.keys(virt).length) savePos(posKey, virt);
    if (Object.keys(att).length) onMove(att);
  };

  // "Tidy up": automatic layout for everything, saved.
  useEffect(() => {
    if (!props.tidyToken) return;
    const auto = autoLayout(model.rfNodes, model.edges);
    setNodes((ns) => ns.map((n) => ({ ...n, position: { x: auto[n.id][0], y: auto[n.id][1] } })));
    persist(auto);
    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tidyToken]);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => !!c.source && !!c.target && c.source !== c.target && canConnect(c.source, c.target),
    [canConnect],
  );

  return (
    <div
      className="graph-wrap"
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        props.onDrop(null, e.dataTransfer);
      }}
    >
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
        onNodeClick={(_, n) => props.onSelect(n.id)}
        onPaneClick={() => props.onSelect(null)}
        onNodeDoubleClick={(_, n) => {
          const a = ix.byId.get(n.id);
          if (a?.hasFile) props.onOpen(a);
        }}
        onNodeDragStop={(_, __, dragged) =>
          persist(Object.fromEntries(dragged.map((n) => [n.id, [Math.round(n.position.x), Math.round(n.position.y)] as [number, number]])))
        }
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
