import type { MainModule } from '@rdkit/rdkit';
import { Fragment, useMemo } from 'react';
import { smilesToSvg } from '../chem/rdkit';
import { schemeSvg, unitsToPt, type SchemeLabels } from '../chem/scheme';
import type { Component, Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';

interface Props {
  /** With effective abbreviations filled in (see chem/abbr withAbbrs). */
  rxn: Reaction;
  rd: MainModule | null;
  rdError: boolean;
  /** 'color': RDKit colours, interactive layout; 'mono': black-and-white scheme as exported. */
  look: SchemeLook;
  labels: SchemeLabels;
  onSelect: (id: string) => void;
}

export type SchemeLook = 'color' | 'mono';

// Layout: [reactants] → [products], each side wraps on its own so wide
// molecules never push the arrow off screen; on narrow screens the three
// blocks stack and the arrow points down.
export function ReactionPreview({ rxn, rd, rdError, look, labels, onSelect }: Props) {
  const { t } = useI18n();
  if (look === 'mono' && (rxn.components.length || rxn.conditions)) return <MonoScheme rxn={rxn} rd={rd} rdError={rdError} labels={labels} onSelect={onSelect} />;
  const text = (c: Component) => (labels === 'abbr' && c.abbr) || c.name;
  const by = (roles: Component['role'][]) => rxn.components.filter((c) => roles.includes(c.role));
  const left = by(['reactant']);
  const above = by(['reagent', 'catalyst']);
  const below = by(['solvent']);
  const right = by(['product']);

  if (!rxn.components.length && !rxn.conditions) return <p className="muted center">{t.previewEmpty}</p>;

  const side = (list: Component[], placeholder: string) =>
    list.length ? (
      list.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <span className="rx-plus">+</span>}
          <Mol c={c} rd={rd} text={text(c)} onClick={() => onSelect(c.id)} />
        </Fragment>
      ))
    ) : (
      <span className="rx-placeholder">{placeholder}</span>
    );

  const label = (c: Component) =>
    c.role === 'catalyst' ? `${text(c)} (${+(c.equiv * 100).toFixed(2)} mol%)` : text(c);

  return (
    <div className="rx-wrap">
      {!rd && !rdError && <p className="muted small">{t.rdkitLoading}</p>}
      <div className="rx-scheme">
        <div className="rx-side">{side(left, t.roles.reactant)}</div>
        <div className="rx-arrow">
          <div className="rx-arrow-text rx-above">
            {above.map((c) => (
              <button key={c.id} className="rx-agent" onClick={() => onSelect(c.id)}>{label(c)}</button>
            ))}
          </div>
          <div className="rx-arrow-line" aria-hidden />
          <div className="rx-arrow-text rx-below">
            {below.map((c) => (
              <button key={c.id} className="rx-agent" onClick={() => onSelect(c.id)}>{text(c)}</button>
            ))}
            {rxn.conditions && <span className="rx-conditions">{rxn.conditions}</span>}
          </div>
        </div>
        <div className="rx-side">{side(right, t.roles.product)}</div>
      </div>
    </div>
  );
}

function Mol({ c, rd, text, onClick }: { c: Component; rd: MainModule | null; text: string; onClick: () => void }) {
  const svg = useMemo(() => (rd && c.smiles ? smilesToSvg(rd, c.smiles) : null), [rd, c.smiles]);
  return (
    <button className="rx-mol" onClick={onClick} title={[text !== c.name && c.name, c.smiles ?? c.formula].filter(Boolean).join('\n')}>
      {svg ? (
        <img className="rx-mol-img" alt={c.name} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />
      ) : (
        <span className="rx-mol-text">{c.formula ?? c.name}</span>
      )}
      <span className="rx-mol-name">{text}</span>
    </button>
  );
}

/** The exported SVG itself (what you see is what you download); click a compound to select it. */
function MonoScheme({ rxn, rd, rdError, labels, onSelect }: Omit<Props, 'look'>) {
  const { t } = useI18n();
  // Redraw only when something drawn changes, not on every amount edit.
  const key = JSON.stringify([rxn.conditions, rxn.components.map((c) => [c.id, c.role, c.name, c.abbr, c.smiles, c.formula, c.role === 'catalyst' && c.equiv])]);
  const out = useMemo(() => schemeSvg(rd, rxn, { interactive: true, labels }), [rd, key, labels]);
  return (
    <div className="rx-wrap">
      {!rd && !rdError && <p className="muted small">{t.rdkitLoading}</p>}
      {out && (
        <div
          className="rx-cd"
          // Shown at 1.6× the printed (ACS) size, shrunk to fit narrow screens.
          style={{ ['--cd-w' as string]: `${((unitsToPt(out.width) * 4) / 3) * 1.6}px` }}
          onClick={(e) => {
            const id = (e.target as Element).closest('[data-cid]')?.getAttribute('data-cid');
            if (id) onSelect(id);
          }}
          dangerouslySetInnerHTML={{ __html: out.svg }}
        />
      )}
    </div>
  );
}
