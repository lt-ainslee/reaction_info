// Details and actions for one node of the attachment graph (used by the graph and list views).
import { useEffect, useRef, useState } from 'react';
import { fileUrl, formatSize, type Attachment } from '../attachments/api';
import { prettyNucleus } from '../attachments/bruker';
import { displayName, nodeTypeOf, type Index } from '../attachments/graph';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';
import { NmrMetaLine } from './NmrMetaLine';

export interface NodeActions {
  open: (n: Attachment) => void;
  patch: (n: Attachment, p: { note?: string; label?: string; compoundId?: string | null; meta?: Record<string, unknown> }) => void;
  remove: (n: Attachment) => void;
  addFiles: (parent: Attachment, files: FileList) => void;
  addPeakList: (parent: Attachment) => void;
  pack: (n: Attachment) => void;
  insertCharac: (n: Attachment, text: string) => void;
  select: (id: string) => void;
}

interface Props {
  node: Attachment;
  ix: Index;
  products: Component[];
  /** Product this node belongs to (own or inherited). */
  compoundId?: string;
  packing: boolean;
  actions: NodeActions;
}

export function NodeInspector({ node, ix, products, compoundId, packing, actions }: Props) {
  const { t, lang } = useI18n();
  const type = nodeTypeOf(node);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(node.meta.text ?? ''));
  useEffect(() => setText(String(node.meta.text ?? '')), [node.id, node.meta.text]);
  const ups = ix.parents.get(node.id) ?? [];
  const downs = ix.children.get(node.id) ?? [];
  const nameOf = (id: string) => {
    const n = ix.byId.get(id);
    return n ? displayName(n) : id;
  };
  const isRoot = ups.length === 0;
  const canHavePeaks = node.kind === 'nmr' || type === 'processed';

  return (
    <div className="inspector">
      <div className={'insp-type t-' + type}>{t.att.nodeTypes[type]}</div>
      {node.hasFile ? (
        <button className="link insp-name" onClick={() => actions.open(node)}>{node.filename}</button>
      ) : (
        <input
          key={node.id}
          className="insp-label"
          defaultValue={displayName(node)}
          aria-label={t.att.rename}
          onBlur={(e) => e.target.value.trim() && e.target.value !== displayName(node) && actions.patch(node, { label: e.target.value.trim() })}
        />
      )}
      <div className="insp-meta">
        {node.kind === 'nmr' ? <NmrMetaLine att={node} /> : t.att.kinds[node.kind]}
        {node.hasFile && ` · ${formatSize(node.size)}`}
        {` · ${new Date(node.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en')}`}
      </div>
      {typeof node.meta.title === 'string' && <div className="insp-title">“{node.meta.title}”</div>}
      {node.hasPreview && <img className="insp-preview" src={`/api/attachments/${node.id}/preview`} alt="" onClick={() => actions.open(node)} />}

      {isRoot && (
        <label className="field">
          <span>{t.att.compound}</span>
          <select value={node.compoundId ?? ''} onChange={(e) => actions.patch(node, { compoundId: e.target.value || null })}>
            <option value="">{t.att.noCompound}</option>
            {products.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      {type === 'peaklist' ? (
        <label className="field">
          <span>{t.att.nodeTypes.peaklist}</span>
          <textarea
            rows={5}
            value={text}
            placeholder={t.att.peakListPh}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== node.meta.text && actions.patch(node, { meta: { text } })}
          />
          {compoundId && text.trim() && (
            <button className="ghost small" onClick={() => actions.insertCharac(node, text.trim())}>{t.att.insertCharac}</button>
          )}
        </label>
      ) : (
        <label className="field">
          <span>{t.att.noteLabel}</span>
          <input
            key={node.id}
            defaultValue={node.note}
            placeholder={t.att.notePh}
            onBlur={(e) => e.target.value !== node.note && actions.patch(node, { note: e.target.value })}
          />
        </label>
      )}

      {(ups.length > 0 || downs.length > 0) && (
        <dl className="insp-links">
          {ups.length > 0 && (
            <>
              <dt>{t.att.upstream}</dt>
              <dd>{ups.map((id) => <button key={id} className="link" onClick={() => actions.select(id)}>{nameOf(id)}</button>)}</dd>
            </>
          )}
          {downs.length > 0 && (
            <>
              <dt>{t.att.downstream}</dt>
              <dd>{downs.map((id) => <button key={id} className="link" onClick={() => actions.select(id)}>{nameOf(id)}</button>)}</dd>
            </>
          )}
        </dl>
      )}

      <div className="insp-actions">
        {node.hasFile && <button className="ghost small" onClick={() => actions.open(node)}>{t.att.view}</button>}
        {node.hasFile && <a className="button-like ghost small" href={fileUrl(node.id, true)} download>{t.att.download}</a>}
        <button className="ghost small" onClick={() => fileRef.current?.click()}>+ {t.att.addDownstream}</button>
        {canHavePeaks && <button className="ghost small" onClick={() => actions.addPeakList(node)}>+ {t.att.addPeakList}</button>}
        {(downs.length > 0 || node.hasFile) && (
          <button className="ghost small" disabled={packing} onClick={() => actions.pack(node)}>{packing ? t.att.packing : t.att.packDownload}</button>
        )}
        <button className="ghost small danger" onClick={() => actions.remove(node)}>{t.delete}</button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) actions.addFiles(node, e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/** "¹H" etc. for peak-list labels. */
export const nucleusLabel = (n: Attachment) => prettyNucleus(String(n.meta.nucleus ?? '').split('/')[0]) ?? '';
