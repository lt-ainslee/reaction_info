// The sections of the printable report (see Report.tsx).
import type { MainModule } from '@rdkit/rdkit';
import { useMemo } from 'react';
import { formatSize } from '../attachments/api';
import { displayName, nodeTypeOf } from '../attachments/graph';
import { GHS } from '../chem/ghs';
import type { ReagentLot } from '../chem/lots';
import { doiUrl, formatReference } from '../chem/refs';
import { activeRun } from '../chem/runs';
import { schemeSvg, unitsToPt, type ReportLook, type SchemeLabels } from '../chem/scheme';
import { compute, dispensedByVolume, type Component, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { isEmptyDoc, procedureOf, toHtml } from '../procedure/doc';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from '../units';
import { NmrMetaLine } from './NmrMetaLine';
import type { AttachmentRow, SafetyMap } from './useReportData';

/** Effective abbreviation of a compound (by id). */
type AbbrOf = (c: Component) => string | undefined;

/** Formula and CAS; each kept on one line. */
function Sub({ c, abbr }: { c: Component; abbr?: string }) {
  return (
    <div className="rp-sub">
      {abbr && abbr !== c.name && <span>{abbr}</span>}
      {c.formula && <span>{c.formula}</span>}
      {c.cas && <span>CAS {c.cas}</span>}
    </div>
  );
}

function Conditions({ rxn }: { rxn: Reaction }) {
  const { t } = useI18n();
  return rxn.conditions ? (
    <p className="rp-cond">
      <span>{t.conditions}</span>
      {rxn.conditions}
    </p>
  ) : null;
}

/** The scheme at its printed size (conditions listed below it), or just the conditions. */
export function SchemeSection({ rxn, shown, rd, labels, look, withScheme }: {
  rxn: Reaction;
  /** With effective abbreviations. */
  shown: Reaction;
  rd: MainModule | null;
  labels?: SchemeLabels;
  look: ReportLook;
  withScheme: boolean;
}) {
  const { t } = useI18n();
  const out = useMemo(
    () => (withScheme ? schemeSvg(rd, { ...shown, conditions: '' }, { labels, style: look }) : null),
    [withScheme, rd, shown, labels, look],
  );
  if (!withScheme) return <Conditions rxn={rxn} />;
  return (
    <section>
      <h2>{t.preview}</h2>
      {out && (
        <div className="rp-scheme">
          <img alt="" style={{ width: `${unitsToPt(out.width)}pt` }} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg)} />
        </div>
      )}
      <Conditions rxn={rxn} />
    </section>
  );
}

export function InputsTable({ rxn, units, abbr }: { rxn: Reaction; units: Units; abbr: AbbrOf }) {
  const { t } = useI18n();
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const inputs = rxn.components.filter((c) => c.role !== 'product');
  const withActual = rxn.components.some((c) => c.actualAmount);

  const notes = (c: Component) => {
    const out: string[] = [];
    if (c.form === 'solutionM' && c.molarity) out.push(`${c.molarity} M ${t.report.solution}`);
    if (c.form === 'solutionWt' && c.wtPercent) out.push(`${c.wtPercent} wt%`);
    if (c.form === 'neat' && c.phase) out.push(t.forms[c.phase]);
    if (c.form === 'neat' && c.purity < 100) out.push(`${t.report.purity} ${c.purity}%`);
    if (c.density && (c.form === 'neat' || c.role === 'solvent')) out.push(`d ${fmt(c.density)}`);
    if (c.role === 'solvent' && c.solventConc) out.push(`${c.solventConc} M`);
    return out.join(' · ');
  };

  const actualText = (c: Component, v: ReturnType<typeof compute>) => {
    const a = c.actualAmount;
    if (!a) return '';
    const byVol = dispensedByVolume(c);
    const amount = byVol && a.volume ? `${fmt(a.volume / vl)} ${units.volume}` : a.mass ? `${fmt(a.mass / ms)} ${units.mass}` : '';
    const eq = v.actualEquiv !== undefined && c.id !== rxn.refId ? ` (${c.role === 'catalyst' ? `${fmt(v.actualEquiv * 100, 3)} mol%` : `${fmt(v.actualEquiv, 3)} eq`})` : '';
    return amount + eq;
  };

  return (
    <section>
      <h2>{t.table}</h2>
      <table className="rp-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t.col.name}</th>
            <th>{t.col.role}</th>
            <th className="r">{t.col.mw}</th>
            <th className="r">{t.col.equiv}</th>
            <th className="r">{t.col.amount} ({units.amount})</th>
            <th className="r">{t.col.mass} ({units.mass})</th>
            <th className="r">{t.col.volume} ({units.volume})</th>
            {withActual && <th className="r">{t.runs.actual}</th>}
            <th>{t.report.remarks}</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map((c, i) => {
            const v = compute(rxn, c);
            const isRef = c.id === rxn.refId;
            return (
              <tr key={c.id} className={isRef ? 'ref' : ''}>
                <td className="idx">{i + 1}</td>
                <td>
                  <div className="rp-name">
                    {c.name}
                    {isRef && <span className="rp-badge">{t.col.ref}</span>}
                  </div>
                  <Sub c={c} abbr={abbr(c)} />
                </td>
                <td className="nowrap">{t.roles[c.role]}</td>
                <td className="r">{fmt(c.mw, 6)}</td>
                <td className="r">
                  {c.role === 'solvent' ? '—' : c.role === 'catalyst' ? `${fmt(c.equiv * 100, 3)} mol%` : fmt(c.equiv, 3)}
                </td>
                <td className="r">{c.role === 'solvent' ? '—' : fmt(v.mmol !== undefined ? v.mmol / am : undefined)}</td>
                <td className="r key">{fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—'}</td>
                <td className="r key">{fmt(v.volume !== undefined ? v.volume / vl : undefined) || '—'}</td>
                {withActual && <td className="r">{actualText(c, v)}</td>}
                <td className="rp-notes">{notes(c)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Reagent lots used in this run, with the library's identity check. */
export function LotsTable({ rxn, lots }: { rxn: Reaction; lots: Map<string, ReagentLot> }) {
  const { t } = useI18n();
  const withLot = rxn.components.filter((c) => c.role !== 'product' && c.lot);
  if (!withLot.length) return null;
  return (
    <section>
      <h2>{t.office.lots}</h2>
      <table className="rp-table">
        <thead>
          <tr>
            <th>{t.col.name}</th>
            <th>{t.lots.supplier}</th>
            <th>{t.lots.spec}</th>
            <th>{t.lots.catalog} / {t.lots.lot}</th>
            <th className="r">{t.col.purity}</th>
            <th>{t.lots.verification}</th>
          </tr>
        </thead>
        <tbody>
          {withLot.map((c) => {
            const l = { ...c.lot!, ...(c.lot!.lotId ? lots.get(c.lot!.lotId) ?? {} : {}) };
            const ver = l.verification ?? 'unverified';
            return (
              <tr key={c.id}>
                <td className="rp-name">{c.name}</td>
                <td>{l.source === 'made' ? `${t.lots.made}${l.sourceLabel ? ` · ${l.sourceLabel}` : ''}` : l.supplier}</td>
                <td className="rp-sub">{l.spec}</td>
                <td className="rp-sub">{[l.catalogNumber, l.lotNumber].filter(Boolean).join(' / ')}</td>
                <td className="r">{[l.purity && `${l.purity}%`, l.molarity && `${l.molarity} M`].filter(Boolean).join(' · ')}</td>
                <td>
                  <span className={'rp-ver v-' + ver}>{t.lots.verifications[ver]}</span>
                  {l.verificationNote && <div className="rp-sub">{l.verificationNote}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function ProductsTable({ rxn, units, abbr }: { rxn: Reaction; units: Units; abbr: AbbrOf }) {
  const { t } = useI18n();
  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const products = rxn.components.filter((c) => c.role === 'product');
  const run = activeRun(rxn);
  if (!products.length) return null;
  return (
    <section>
      <h2>{t.roles.product}</h2>
      <table className="rp-table">
        <thead>
          <tr>
            <th>{t.col.name}</th>
            <th className="r">{t.col.mw}</th>
            <th className="r">{t.col.equiv}</th>
            <th className="r">{t.col.amount} ({units.amount})</th>
            <th className="r">{t.theoMass} ({units.mass})</th>
            <th className="r">{t.actualMass} ({units.mass})</th>
            <th className="r">{t.yield}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((c) => {
            const v = compute(rxn, c);
            return (
              <tr key={c.id}>
                <td>
                  <div className="rp-name">{c.name}</div>
                  <Sub c={c} abbr={abbr(c)} />
                </td>
                <td className="r">{fmt(c.mw, 6)}</td>
                <td className="r">{fmt(c.equiv, 3)}</td>
                <td className="r">{fmt(v.mmol !== undefined ? v.mmol / am : undefined)}</td>
                <td className="r key">{fmt(v.theoMass !== undefined ? v.theoMass / ms : undefined) || '—'}</td>
                <td className="r">{fmt(v.mass !== undefined ? v.mass / ms : undefined) || '—'}</td>
                <td className="r key">{v.yieldPct !== undefined ? `${fmt(v.yieldPct, 3)}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(run.appearance || run.conclusion) && (
        <p className="rp-cond">
          {run.appearance && (
            <>
              <span>{t.runs.appearance}</span>
              {run.appearance}{' '}
            </>
          )}
          {run.conclusion && (
            <>
              <span>{t.runs.conclusion}</span>
              {run.conclusion}
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** Procedure, then the products' characterization text. */
export function ProcedureSections({ rxn }: { rxn: Reaction }) {
  const { t } = useI18n();
  const procedure = procedureOf(rxn);
  const charac = rxn.components.filter((c) => c.role === 'product' && c.characterization?.trim());
  return (
    <>
      {!isEmptyDoc(procedure) && (
        <section>
          <h2>{t.notes}</h2>
          <div className="rp-text rp-proc" dangerouslySetInnerHTML={{ __html: toHtml(procedure, { observation: t.proc.observation }) }} />
        </section>
      )}
      {charac.length > 0 && (
        <section>
          <h2>{t.att.characterization}</h2>
          {charac.map((p) => (
            <div key={p.id} className="rp-charac">
              <div className="rp-name">{p.name}</div>
              <div className="rp-text">{p.characterization}</div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

export function AttachmentsSection({ rxn, attachments }: { rxn: Reaction; attachments: AttachmentRow[] }) {
  const { t } = useI18n();
  if (!attachments.length) return null;
  return (
    <section>
      <h2>{t.att.reportList}</h2>
      <table className="rp-table">
        <tbody>
          {attachments.map(({ node: a, depth, compoundId }) => (
            <tr key={a.id}>
              <td className="rp-name" style={{ paddingLeft: `${depth * 4}mm` }}>
                {depth > 0 && '└ '}
                {displayName(a)}
                <span className="rp-sub"> · {t.att.nodeTypes[nodeTypeOf(a)]}</span>
              </td>
              <td className="rp-sub">{a.kind === 'nmr' ? <NmrMetaLine att={a} /> : nodeTypeOf(a) === 'peaklist' ? String(a.meta.text ?? '') : ''}</td>
              <td className="rp-sub">{depth === 0 ? rxn.components.find((c) => c.id === compoundId)?.name ?? '' : ''}</td>
              <td className="rp-sub">{a.note}</td>
              <td className="r rp-sub">{a.hasFile ? formatSize(a.size) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ReferencesSection({ rxn }: { rxn: Reaction }) {
  const { t } = useI18n();
  if (!rxn.references?.length) return null;
  return (
    <section>
      <h2>{t.refs.title}</h2>
      <ol className="rp-refs">
        {rxn.references.map((r) => (
          <li key={r.id}>
            {formatReference(r)}
            {r.doi && <span className="rp-sub"> {doiUrl(r.doi)}</span>}
            {!r.doi && r.url && <span className="rp-sub"> {r.url}</span>}
            {r.note && <div className="rp-sub">{r.note}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SafetySection({ rxn, safety, fetching }: { rxn: Reaction; safety: SafetyMap; fetching: boolean }) {
  const { t, lang } = useI18n();
  const rows = rxn.components
    .map((c) => ({ c, s: safety[c.id] }))
    .filter(({ s }) => s && (s.ghsPictograms.length || s.hazards.length));
  return (
    <section className="rp-safety">
      <h2>{t.report.safety}</h2>
      {rows.length ? (
        <table className="rp-table">
          <thead>
            <tr>
              <th>{t.col.name}</th>
              <th>{t.report.pictograms}</th>
              <th>{t.report.hazards}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, s }) => (
              <tr key={c.id}>
                <td className="rp-name">{c.name}</td>
                <td>
                  <div className="rp-ghs">
                    {s!.ghsPictograms.map((p) => {
                      const [code, zh] = GHS[p] ?? ['GHS', p];
                      return (
                        <span key={p} className="ghs-tag" title={p}>
                          <i aria-hidden>!</i>
                          {code} {lang === 'zh' ? zh : p}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="rp-h">{s!.hazards.map((h) => <div key={h}>{h}</div>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">{fetching ? t.report.fetchingShort : t.report.noSafety}</p>
      )}
      <p className="rp-fine">{t.dataSource}</p>
    </section>
  );
}
