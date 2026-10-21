import type { MainModule } from '@rdkit/rdkit';
import { Fragment, useMemo } from 'react';
import { smilesToSvg } from '../chem/rdkit';
import type { Component, Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';

interface Props {
  rxn: Reaction;
  rd: MainModule | null;
  rdError: boolean;
  onSelect: (id: string) => void;
}

// Layout: [reactants] → [products], each side wraps on its own so wide
// molecules never push the arrow off screen; on narrow screens the three
// blocks stack and the arrow points down.
export function ReactionPreview({ rxn, rd, rdError, onSelect }: Props) {
  const { t } = useI18n();
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
          <Mol c={c} rd={rd} onClick={() => onSelect(c.id)} />
        </Fragment>
      ))
    ) : (
      <span className="rx-placeholder">{placeholder}</span>
    );

  const label = (c: Component) =>
    c.role === 'catalyst' ? `${c.name} (${+(c.equiv * 100).toFixed(2)} mol%)` : c.name;

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
              <button key={c.id} className="rx-agent" onClick={() => onSelect(c.id)}>{c.name}</button>
            ))}
            {rxn.conditions && <span className="rx-conditions">{rxn.conditions}</span>}
          </div>
        </div>
        <div className="rx-side">{side(right, t.roles.product)}</div>
      </div>
    </div>
  );
}

function Mol({ c, rd, onClick }: { c: Component; rd: MainModule | null; onClick: () => void }) {
  const svg = useMemo(() => (rd && c.smiles ? smilesToSvg(rd, c.smiles) : null), [rd, c.smiles]);
  return (
    <button className="rx-mol" onClick={onClick} title={c.smiles ?? c.formula}>
      {svg ? (
        <img className="rx-mol-img" alt={c.name} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />
      ) : (
        <span className="rx-mol-text">{c.formula ?? c.name}</span>
      )}
      <span className="rx-mol-name">{c.name}</span>
    </button>
  );
}
