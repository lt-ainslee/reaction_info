// The reagent table card: scaling, text / office exports, the "actual
// amounts" switch, the report button, the table and the plan-for-product row.
import { useState } from 'react';
import type { ReportLook } from '../chem/scheme';
import { planForProduct, removeComponent, scale, type Reaction } from '../chem/stoich';
import { activeRun } from '../chem/runs';
import { download, toCsv, toMarkdown } from '../export';
import { useI18n } from '../i18n';
import { MASS_UNITS, type Units } from '../units';
import { NumInput } from './NumInput';
import { StoichTable } from './StoichTable';

interface Props {
  rxn: Reaction;
  setRxn: (r: Reaction) => void;
  units: Units;
  onUnits: (u: Units) => void;
  /** Effective abbreviation of each compound (by id). */
  abbrs: ReadonlyMap<string, string>;
  /** Compounds whose phase / density is being looked up. */
  pending: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  fileBase: string;
  building: boolean;
  reportLook: ReportLook;
  onOffice: (kind: 'word' | 'excel') => void;
  onReport: () => void;
  onNotify: (msg: string) => void;
}

export function TableCard({ rxn, setRxn, units, onUnits, abbrs, pending, selected, onSelect, fileBase, building, reportLook, onOffice, onReport, onNotify }: Props) {
  const { t } = useI18n();
  const [planTarget, setPlanTarget] = useState<number | undefined>();
  const [planYield, setPlanYield] = useState<number | undefined>(80);
  const [showActual, setShowActual] = useState(false);
  const run = activeRun(rxn);
  const actualOn = showActual || run.status !== 'planned' || rxn.components.some((c) => c.actualAmount);
  const product = rxn.components.find((c) => c.role === 'product');
  const exportLabels = { roles: t.roles, col: t.col, yield: t.yield, actualMass: t.actualMass, actual: t.runs.actual, conditions: t.conditions, liquid: t.forms.liquid, notes: t.notes };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t.table}</h2>
        <div className="toolbar no-print">
          <div className="seg" role="group" aria-label={t.scale}>
            <span className="seg-label">{t.scale}</span>
            {[0.5, 2, 5, 10].map((f) => (
              <button key={f} onClick={() => setRxn(scale(rxn, f))}>×{f}</button>
            ))}
          </div>
          <div className="seg" role="group">
            <button onClick={() => navigator.clipboard.writeText(toMarkdown(rxn, units, exportLabels)).then(() => onNotify(t.copied))}>
              {t.exportMd}
            </button>
            <button onClick={() => download(`${fileBase}.csv`, toCsv(rxn, units, exportLabels))}>{t.exportCsv}</button>
            <button disabled={building} title={`${t.office.word}\n${t.report.schemeStyle}: ${t.report.looks[reportLook]}`} onClick={() => onOffice('word')}>Word</button>
            <button disabled={building} title={t.office.excel} onClick={() => onOffice('excel')}>Excel</button>
          </div>
          {run.status === 'planned' && (
            <label className="check small" title={t.runs.actualTip}>
              <input type="checkbox" checked={actualOn} disabled={rxn.components.some((c) => c.actualAmount)} onChange={(e) => setShowActual(e.target.checked)} />
              {t.runs.actualToggle}
            </label>
          )}
          <button onClick={onReport}>{t.exportReport}</button>
        </div>
      </div>
      <StoichTable
        rxn={rxn}
        abbrs={abbrs}
        units={units}
        onUnits={onUnits}
        pending={pending}
        showActual={actualOn}
        onChange={setRxn}
        onSelect={onSelect}
        onRemove={(id) => {
          setRxn(removeComponent(rxn, id));
          if (selected === id) onSelect(null);
        }}
      />
      {product && rxn.refId && (
        <div className="plan no-print">
          <span className="plan-label">{t.plan}</span>
          <label>
            {t.planTarget} ({units.mass})
            <NumInput value={planTarget} onCommit={setPlanTarget} onClear={() => setPlanTarget(undefined)} />
          </label>
          <label>
            {t.planYield}
            <NumInput value={planYield} sig={3} onCommit={setPlanYield} />
          </label>
          <button
            className="ghost small"
            disabled={!planTarget || !planYield}
            onClick={() => setRxn(planForProduct(rxn, product.id, planTarget! * MASS_UNITS[units.mass], planYield!))}
          >
            {t.planApply}
          </button>
        </div>
      )}
    </section>
  );
}
