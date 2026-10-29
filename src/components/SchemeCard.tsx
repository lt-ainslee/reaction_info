// The reaction card: scheme preview with its display / export tools, SMILES,
// and the two ways in (import / edit the equation, add a compound).
import type { MainModule } from '@rdkit/rdkit';
import type { ReagentLot } from '../chem/lots';
import type { CompoundData, Resolved } from '../chem/resolve';
import type { SchemeLabels } from '../chem/scheme';
import type { Reaction, Role } from '../chem/stoich';
import type { OpenEditor } from '../app/editor';
import type { SchemeFormat } from '../app/useExports';
import { drawableEquation, reactionSmiles } from '../export';
import { useI18n } from '../i18n';
import { CompoundSearch } from './CompoundSearch';
import { ReactionInput, type ApplyMode } from './ReactionInput';
import { ReactionPreview, type SchemeLook } from './ReactionPreview';

interface Props {
  rxn: Reaction;
  /** With effective abbreviations, for drawing. */
  shown: Reaction;
  rd: MainModule | null;
  rdError: boolean;
  look: SchemeLook;
  onLook: (v: SchemeLook) => void;
  labels: SchemeLabels;
  onLabels: (v: SchemeLabels) => void;
  onExport: (f: SchemeFormat) => void;
  onSelect: (id: string) => void;
  openEditor: OpenEditor;
  onApply: (res: Resolved, mode: ApplyMode) => void;
  onDrawn: (r: { text: string; isReaction: boolean }) => void;
  onAdd: (data: CompoundData, role: Role) => void;
  onAddLot: (lot: ReagentLot, role: Role) => void;
}

export function SchemeCard(p: Props) {
  const { t } = useI18n();
  const { rxn } = p;
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t.preview}</h2>
        <div className="card-tools no-print">
          <div className="seg" role="group" aria-label={t.scheme.look}>
            {(['color', 'mono'] as const).map((v) => (
              <button key={v} className={p.look === v ? 'on' : ''} aria-pressed={p.look === v} title={t.scheme.lookTips[v]} onClick={() => p.onLook(v)}>
                {t.scheme.looks[v]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" title={t.scheme.labelsTip}>
            {(['abbr', 'name'] as const).map((v) => (
              <button key={v} className={p.labels === v ? 'on' : ''} aria-pressed={p.labels === v} onClick={() => p.onLabels(v)}>
                {t.scheme.labels[v]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={t.scheme.export}>
            <span className="seg-label">{t.scheme.export}</span>
            {(['svg', 'png', 'cdxml', 'rxn'] as const).map((f) => (
              <button key={f} title={t.scheme.formatTips[f]} disabled={!rxn.components.length} onClick={() => p.onExport(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ReactionPreview rxn={p.shown} rd={p.rd} rdError={p.rdError} look={p.look} labels={p.labels} onSelect={p.onSelect} />
      {rxn.components.some((c) => c.smiles) && (
        <details className="smiles-details">
          <summary>SMILES</summary>
          <p className="mono small muted break">{reactionSmiles(rxn)}</p>
        </details>
      )}
      <div className="input-grid no-print">
        <div className="input-block">
          <h3>{t.importLabel}</h3>
          <ReactionInput
            rd={p.rd}
            hasComponents={rxn.components.length > 0}
            currentEquation={() => reactionSmiles(rxn)}
            onApply={p.onApply}
            onDraw={() =>
              p.openEditor({
                mode: 'reaction',
                initial: drawableEquation(rxn),
                editing: rxn.components.length > 0,
                onApply: p.onDrawn,
              })
            }
          />
        </div>
        <div className="input-block">
          <h3>{t.addCompound}</h3>
          <CompoundSearch rd={p.rd} onAdd={p.onAdd} onAddLot={p.onAddLot} openEditor={p.openEditor} />
        </div>
      </div>
    </section>
  );
}
