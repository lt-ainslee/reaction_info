// The runs of a reaction: one tab per experiment (code · scale · yield · date),
// "new run" (copied from an existing one), and the active run's own fields.
import { useState } from 'react';
import {
  addRun, removeRun, RUN_STATUSES, runCode, runsOf, runYield, switchRun, updateRun, type RunStatus,
} from '../chem/runs';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { fmt } from '../units';

interface Props {
  rxn: Reaction;
  setRxn: (r: Reaction) => void;
  onNotify: (msg: string) => void;
  /** Placeholder for the reaction code when it is empty. */
  suggestedCode: string;
}

const shortDate = (d?: string) => (d ? d.slice(5).replace('-', '/') : '');

export function RunBar({ rxn, setRxn, onNotify, suggestedCode }: Props) {
  const { t } = useI18n();
  const r = t.runs;
  const runs = runsOf(rxn);
  const active = runs.find((x) => x.active)!;
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState(active.id);
  const [copyProc, setCopyProc] = useState(true);
  const codeOf = (x: (typeof runs)[number]) => runCode(rxn, x);
  const autoCode = runCode({ code: rxn.code || suggestedCode }, { seq: active.seq, data: { ...active.data, notebook: undefined } });

  const create = () => {
    const next = addRun(rxn, { sourceId: source, copyProcedure: copyProc });
    setRxn(next);
    setAdding(false);
    const created = runsOf(next).find((x) => x.active)!;
    onNotify(r.created.replace('{code}', runCode(next, created)));
  };

  return (
    <section className="card runs-card">
      <div className="run-tabs" role="tablist" aria-label={r.title}>
        {runs.map((x) => {
          const y = runYield(x.data);
          return (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.active}
              className={'run-tab' + (x.active ? ' on' : '')}
              onClick={() => setRxn(switchRun(rxn, x.id))}
            >
              <span className={'run-dot s-' + x.status} title={r.statuses[x.status]} />
              <span className="run-tab-code">{codeOf(x)}</span>
              <span className="run-tab-meta">
                {fmt(x.data.refMmol, 3)} mmol
                {y !== undefined && <b> · {fmt(y, 3)}%</b>}
                {x.date && ` · ${shortDate(x.date)}`}
              </span>
            </button>
          );
        })}
        <button
          className="ghost run-add no-print"
          onClick={() => {
            setSource(active.id);
            setAdding((a) => !a);
          }}
          aria-expanded={adding}
        >
          + {r.add}
        </button>
      </div>

      {adding && (
        <div className="run-new no-print">
          <label>
            {r.copyFrom}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {runs.map((x) => (
                <option key={x.id} value={x.id}>
                  {codeOf(x)} · {fmt(x.data.refMmol, 3)} mmol{runYield(x.data) !== undefined ? ` · ${fmt(runYield(x.data)!, 3)}%` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={copyProc} onChange={(e) => setCopyProc(e.target.checked)} />
            {r.copyProcedure}
          </label>
          <span className="hint">{r.addHint}</span>
          <span className="run-new-actions">
            <button className="ghost small" onClick={() => setAdding(false)}>{r.cancel}</button>
            <button className="small" onClick={create}>{r.create}</button>
          </span>
        </div>
      )}

      <div className="run-fields">
        <label className="field">
          <span>{r.runCode}</span>
          <input
            value={active.data.notebook ?? ''}
            placeholder={autoCode}
            onChange={(e) => setRxn({ ...rxn, notebook: e.target.value || undefined })}
          />
        </label>
        <label className="field">
          <span>{r.date}</span>
          <input type="date" value={active.date ?? ''} onChange={(e) => setRxn(updateRun(rxn, active.id, { date: e.target.value || undefined }))} />
        </label>
        <label className="field">
          <span>{r.status}</span>
          <select
            className={'run-status s-' + active.status}
            value={active.status}
            onChange={(e) => setRxn(updateRun(rxn, active.id, { status: e.target.value as RunStatus }))}
          >
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>{r.statuses[s]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{r.operator}</span>
          <input value={rxn.operator ?? ''} onChange={(e) => setRxn({ ...rxn, operator: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>{r.appearance}</span>
          <input
            value={active.appearance ?? ''}
            placeholder={r.appearancePh}
            onChange={(e) => setRxn(updateRun(rxn, active.id, { appearance: e.target.value || undefined }))}
          />
        </label>
        <label className="field run-conclusion">
          <span>{r.conclusion}</span>
          <input
            value={active.conclusion ?? ''}
            placeholder={r.conclusionPh}
            onChange={(e) => setRxn(updateRun(rxn, active.id, { conclusion: e.target.value || undefined }))}
          />
        </label>
        {runs.length > 1 && (
          <button
            className="ghost small danger run-remove no-print"
            onClick={() => confirm(r.confirmRemove.replace('{code}', codeOf(active))) && setRxn(removeRun(rxn, active.id))}
          >
            {r.remove}
          </button>
        )}
      </div>
    </section>
  );
}
