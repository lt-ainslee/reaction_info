import {
  compute, needsDensity, setEquiv, setMass, setMmol, setReference, setRole, setVolume, updateComponent,
  type Component, type Phase, type Reaction, type Role,
} from '../chem/stoich';
import { useI18n } from '../i18n';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from '../units';
import { NumInput } from './NumInput';

interface Props {
  rxn: Reaction;
  units: Units;
  onUnits: (u: Units) => void;
  onChange: (r: Reaction) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  /** Compounds whose phase/density is being looked up. */
  pending: ReadonlySet<string>;
}

const ROLES: Role[] = ['reactant', 'reagent', 'catalyst', 'solvent', 'product'];
/** The form select combines phase (for neat compounds) and solution forms. */
type FormChoice = 'neat' | Phase | 'solutionM' | 'solutionWt';
const FORM_CHOICES: FormChoice[] = ['solid', 'liquid', 'gas', 'solutionM', 'solutionWt'];
const formChoice = (c: Component): FormChoice => (c.form === 'neat' ? c.phase ?? 'neat' : c.form);

export function StoichTable({ rxn, units, onUnits, onChange, onSelect, onRemove, pending }: Props) {
  const { t } = useI18n();
  const inputs = rxn.components.filter((c) => c.role !== 'product');
  const products = rxn.components.filter((c) => c.role === 'product');
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const up = (id: string, p: Partial<Component>) => onChange(updateComponent(rxn, id, p));

  const unitSelect = <K extends keyof Units>(key: K, options: Record<string, number>) => (
    <select className="unit" value={units[key]} onChange={(e) => onUnits({ ...units, [key]: e.target.value as Units[K] })}>
      {Object.keys(options).map((u) => (
        <option key={u}>{u}</option>
      ))}
    </select>
  );

  const roleSelect = (c: Component) => (
    <select value={c.role} onChange={(e) => onChange(setRole(rxn, c.id, e.target.value as Role))}>
      {ROLES.map((r) => (
        <option key={r} value={r}>{t.roles[r]}</option>
      ))}
    </select>
  );

  /** Name cell (sticky on narrow screens); input rows carry the reference radio. */
  const nameCell = (c: Component, withRef = false) => {
    const canRef = withRef && c.role !== 'solvent';
    return (
      <td className="name-cell">
        <div className="name-wrap">
          {withRef && (
            <span className="ref-slot">
              {canRef && (
                <input
                  type="radio"
                  name="ref"
                  checked={c.id === rxn.refId}
                  title={t.refTip}
                  aria-label={t.refTip}
                  onChange={() => onChange(setReference(rxn, c.id))}
                />
              )}
            </span>
          )}
          <span className="name-text">
            <button className="link name" onClick={() => onSelect(c.id)}>{c.name}</button>
            <span className="name-meta">
              {c.formula && <span className="formula">{c.formula}</span>}
              {c.id === rxn.refId && withRef && <span className="badge">{t.col.ref}</span>}
            </span>
            {pending.has(c.id) && <span className="lookup">{t.lookingUp}</span>}
          </span>
        </div>
      </td>
    );
  };

  const removeBtn = (c: Component) => (
    <td>
      <button className="icon" onClick={() => onRemove(c.id)} aria-label={t.delete} title={t.delete}>×</button>
    </td>
  );

  return (
    <div className="table-wrap">
      <table className="stoich">
        <thead>
          <tr>
            <th className="name-th" title={t.refTip}>{t.col.name}</th>
            <th>{t.col.role}</th>
            <th className="r">{t.col.mw}</th>
            <th>{t.col.form}</th>
            <th className="r">{t.col.density}</th>
            <th className="r">{t.col.purity}</th>
            <th className="r">{t.col.equiv}</th>
            <th className="r">{t.col.amount} {unitSelect('amount', AMOUNT_UNITS)}</th>
            <th className="r key">{t.col.mass} {unitSelect('mass', MASS_UNITS)}</th>
            <th className="r key">{t.col.volume} {unitSelect('volume', VOLUME_UNITS)}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {inputs.map((c) => {
            const v = compute(rxn, c);
            const isRef = c.id === rxn.refId;
            const solvent = c.role === 'solvent';
            return (
              <tr key={c.id} className={isRef ? 'ref' : ''}>
                {nameCell(c, true)}
                <td>{roleSelect(c)}</td>
                <td className="r">
                  <NumInput value={c.mw} sig={6} onCommit={(mw) => up(c.id, { mw })} className={!c.mw && !solvent ? 'missing' : ''} placeholder={t.needMw} />
                </td>
                <td>{solvent ? <span className="muted">—</span> : <FormCell c={c} up={up} />}</td>
                <td className="r">
                  {c.form === 'neat' || solvent ? (
                    <span className="density-cell">
                      <NumInput
                        value={c.density}
                        className={needsDensity(c) && !pending.has(c.id) ? 'missing' : ''}
                        placeholder={needsDensity(c) ? (pending.has(c.id) ? '…' : t.needDensity) : ''}
                        onCommit={(density) => up(c.id, { density, densitySource: 'manual' })}
                        onClear={() => up(c.id, { density: undefined, densitySource: undefined })}
                      />
                      {c.density && c.densitySource && c.densitySource !== 'manual' && (
                        <small className="src" title={t.densitySourceTip}>{t.densitySources[c.densitySource]}</small>
                      )}
                    </span>
                  ) : (
                    <NumInput
                      value={c.solutionDensity}
                      title={t.solnDensity}
                      placeholder={t.solnDensity}
                      onCommit={(solutionDensity) => up(c.id, { solutionDensity })}
                      onClear={() => up(c.id, { solutionDensity: undefined })}
                    />
                  )}
                </td>
                <td className="r">
                  {c.form === 'neat' && !solvent ? (
                    <NumInput value={c.purity} sig={3} onCommit={(purity) => up(c.id, { purity: Math.min(purity, 100) })} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="r">
                  {solvent ? (
                    <span className="with-suffix" title={t.solventConcTip}>
                      <NumInput
                        value={c.solventConc}
                        placeholder="—"
                        onCommit={(solventConc) => up(c.id, { solventConc })}
                        onClear={() => up(c.id, { solventConc: undefined })}
                      />
                      <small>M</small>
                    </span>
                  ) : isRef ? (
                    <span className="fixed">1.00</span>
                  ) : c.role === 'catalyst' ? (
                    <span className="with-suffix">
                      <NumInput value={c.equiv * 100} sig={3} onCommit={(p) => onChange(setEquiv(rxn, c.id, p / 100))} />
                      <small>mol%</small>
                    </span>
                  ) : (
                    <NumInput value={c.equiv} sig={3} onCommit={(e) => onChange(setEquiv(rxn, c.id, e))} />
                  )}
                </td>
                <td className="r">
                  {solvent ? (
                    <span className="muted">—</span>
                  ) : (
                    <NumInput value={v.mmol !== undefined ? v.mmol / am : undefined} onCommit={(x) => onChange(setMmol(rxn, c.id, x * am))} />
                  )}
                </td>
                <td className="r key">
                  <NumInput
                    value={v.mass !== undefined ? v.mass / ms : undefined}
                    placeholder={c.mw || solvent ? '' : t.needMw}
                    onCommit={(x) => onChange(setMass(rxn, c.id, x * ms))}
                  />
                </td>
                <td className="r key">
                  {c.form === 'neat' && !solvent && (c.phase === 'solid' || c.phase === 'gas') ? (
                    <span className="muted">—</span>
                  ) : (
                    <NumInput
                      value={v.volume !== undefined ? v.volume / vl : undefined}
                      className={c.form === 'neat' && c.phase === 'liquid' && !solvent ? 'dispense' : ''}
                      title={c.phase === 'liquid' ? t.dispenseVolume : undefined}
                      placeholder={needsDensity(c) ? t.needDensity : ''}
                      onCommit={(x) => onChange(setVolume(rxn, c.id, x * vl))}
                    />
                  )}
                </td>
                {removeBtn(c)}
              </tr>
            );
          })}
        </tbody>
      </table>

      {products.length > 0 && (
        <table className="stoich products">
          <thead>
            <tr>
              <th className="name-th">{t.roles.product}</th>
              <th>{t.col.role}</th>
              <th className="r">{t.col.mw}</th>
              <th className="r">{t.col.equiv}</th>
              <th className="r">{t.col.amount} ({units.amount})</th>
              <th className="r">{t.theoMass} ({units.mass})</th>
              <th className="r">{t.actualMass} ({units.mass})</th>
              <th className="r">{t.yield}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((c) => {
              const v = compute(rxn, c);
              return (
                <tr key={c.id}>
                  {nameCell(c)}
                  <td>{roleSelect(c)}</td>
                  <td className="r">
                    <NumInput value={c.mw} sig={6} onCommit={(mw) => up(c.id, { mw })} className={!c.mw ? 'missing' : ''} placeholder={t.needMw} />
                  </td>
                  <td className="r">
                    <NumInput value={c.equiv} sig={3} onCommit={(e) => onChange(setEquiv(rxn, c.id, e))} />
                  </td>
                  <td className="r ro">{fmt(v.mmol !== undefined ? v.mmol / am : undefined)}</td>
                  <td className="r ro key">{fmt(v.theoMass !== undefined ? v.theoMass / ms : undefined)}</td>
                  <td className="r">
                    <NumInput
                      value={c.actualMass !== undefined ? c.actualMass / ms : undefined}
                      onCommit={(x) => onChange(setMass(rxn, c.id, x * ms))}
                      onClear={() => up(c.id, { actualMass: undefined })}
                    />
                  </td>
                  <td className="r ro strong">{v.yieldPct !== undefined ? `${fmt(v.yieldPct, 3)}%` : ''}</td>
                  {removeBtn(c)}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FormCell({ c, up }: { c: Component; up: (id: string, p: Partial<Component>) => void }) {
  const { t } = useI18n();
  return (
    <span className="form-cell">
      <select
        value={formChoice(c)}
        onChange={(e) => {
          const v = e.target.value as FormChoice;
          if (v === 'solutionM' || v === 'solutionWt') up(c.id, { form: v });
          // Choosing liquid on a compound without density triggers a new lookup.
          else if (v !== 'neat') up(c.id, { form: 'neat', phase: v, ...(v === 'liquid' && !c.density ? { lookup: undefined } : {}) });
        }}
      >
        {formChoice(c) === 'neat' && <option value="neat">{t.forms.neat}</option>}
        {FORM_CHOICES.map((f) => (
          <option key={f} value={f}>{t.forms[f]}</option>
        ))}
      </select>
      {c.form === 'solutionM' && (
        <span className="with-suffix">
          <NumInput value={c.molarity} onCommit={(molarity) => up(c.id, { molarity })} className={!c.molarity ? 'missing' : ''} />
          <small>M</small>
        </span>
      )}
      {c.form === 'solutionWt' && (
        <span className="with-suffix">
          <NumInput value={c.wtPercent} sig={3} onCommit={(wtPercent) => up(c.id, { wtPercent: Math.min(wtPercent, 100) })} className={!c.wtPercent ? 'missing' : ''} />
          <small>wt%</small>
        </span>
      )}
    </span>
  );
}
