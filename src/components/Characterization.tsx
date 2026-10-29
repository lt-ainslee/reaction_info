// SI characterization text of each product, with the NMR headers of its
// spectra to insert and what is still missing (e.g. MS).
import type { Attachment } from '../attachments/api';
import { prettyNucleus, siPrefix, type NmrMeta } from '../attachments/bruker';
import { compoundOf, completeness, nodeTypeOf, type Index } from '../attachments/graph';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';

interface Props {
  products: Component[];
  /** Nodes shown in the card, and their index. */
  nodes: Attachment[];
  ix: Index;
  reactionId?: string;
  /** The card has nodes to report on. */
  hasNodes: boolean;
  onChange: (productId: string, text: string) => void;
  onInsert: (productId: string, text: string) => void;
}

export function Characterization({ products, nodes, ix, reactionId, hasNodes, onChange, onInsert }: Props) {
  const { t } = useI18n();
  const own = nodes.filter((n) => n.reactionId === reactionId);

  /** SI prefixes from 1D NMR experiments of this reaction belonging to the product (or to no compound). */
  const nmrFor = (productId: string) =>
    own
      .filter((a) => a.kind === 'nmr' && nodeTypeOf(a) === 'source')
      .filter((a) => {
        const cid = compoundOf(ix, a.id);
        return cid === productId || !cid;
      })
      .map((a) => siPrefix(a.meta as unknown as NmrMeta))
      .filter((x): x is string => !!x);

  return (
    <div className="charac">
      <h3>{t.att.characterization}</h3>
      {products.map((p) => {
        const prefixes = [...new Set(nmrFor(p.id))];
        const comp = hasNodes ? completeness(ix, own, p.id) : null;
        return (
          <label key={p.id} className="field">
            <span>
              {p.name}
              {comp && (comp.nuclei.length > 0 || comp.ms) && (
                <span className="charac-have no-print">
                  {t.att.complete}: {comp.nuclei.map((n) => prettyNucleus(n) ?? n).join(' · ')}
                  {comp.ms && `${comp.nuclei.length ? ' · ' : ''}MS`}
                  {comp.twoD && ' · 2D'}
                  {!comp.ms && <em> — {t.att.missing}: MS</em>}
                </span>
              )}
            </span>
            <textarea
              rows={3}
              value={p.characterization ?? ''}
              placeholder={t.att.characterizationPh}
              onChange={(e) => onChange(p.id, e.target.value)}
            />
            {prefixes.length > 0 && (
              <span className="charac-chips no-print">
                {prefixes.map((prefix) => (
                  <button key={prefix} type="button" className="ghost small" onClick={() => onInsert(p.id, prefix)}>
                    + {prefix.trim()}
                  </button>
                ))}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
