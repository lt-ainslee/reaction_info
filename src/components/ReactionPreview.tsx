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

export function ReactionPreview({ rxn, rd, rdError, onSelect }: Props) {
  const { t } = useI18n();
  const by = (roles: Component['role'][]) => rxn.components.filter((c) => roles.includes(c.role));
  const left = by(['reactant']);
  const above = by(['reagent', 'catalyst']);
  const below = by(['solvent']);
  const right = by(['product']);

  if (!rxn.components.length) return <p className="muted center">{t.previewEmpty}</p>;

  const side = (list: Component[]) =>
    list.map((c, i) => (
      <Fragment key={c.id}>
        {i > 0 && <span className="plus">+</span>}
        <Mol c={c} rd={rd} onClick={() => onSelect(c.id)} />
      </Fragment>
    ));

  const label = (c: Component) =>
    c.role === 'catalyst' ? `${c.name} (${+(c.equiv * 100).toFixed(2)} mol%)` : c.name;

  return (
    <div className="scheme">
      {!rd && !rdError && <p className="muted small">{t.rdkitLoading}</p>}
      <div className="scheme-row">
        {side(left)}
        <div className="arrow">
          <div className="arrow-text above">
            {above.map((c) => (
              <button key={c.id} className="link" onClick={() => onSelect(c.id)}>{label(c)}</button>
            ))}
          </div>
          <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="6" x2="114" y2="6" />
            <polygon points="120,6 108,1 108,11" />
          </svg>
          <div className="arrow-text below">
            {below.map((c) => (
              <button key={c.id} className="link" onClick={() => onSelect(c.id)}>{c.name}</button>
            ))}
          </div>
        </div>
        {side(right)}
      </div>
    </div>
  );
}

function Mol({ c, rd, onClick }: { c: Component; rd: MainModule | null; onClick: () => void }) {
  const svg = useMemo(() => (rd && c.smiles ? smilesToSvg(rd, c.smiles) : null), [rd, c.smiles]);
  return (
    <button className="mol" onClick={onClick} title={c.smiles ?? c.formula}>
      {svg ? (
        <img className="mol-svg" alt={c.name} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />
      ) : (
        <span className="mol-text">{c.formula ?? c.name}</span>
      )}
      <span className="mol-name">{c.name}</span>
    </button>
  );
}
