// Printable reaction report (A4). Shown as a paper preview in a modal; "Save
// as PDF" uses the browser's print dialog, which keeps text as vector text and
// renders Chinese with the system fonts (no font embedding needed).
import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatSize, getGraph } from '../attachments/api';
import { isEmptyDoc, procedureOf, toHtml } from '../procedure/doc';
import { compoundOf, displayName, indexGraph, nodeTypeOf, treeRows, type Row } from '../attachments/graph';
import { GHS } from '../chem/ghs';
import { NmrMetaLine } from './NmrMetaLine';
import { getSafetyCached, type PubChemSafety } from '../chem/pubchem';
import { withAbbrs } from '../chem/abbr';
import { REPORT_LOOKS, schemeSvg, unitsToPt, type ReportLook, type SchemeLabels } from '../chem/scheme';
import { findCid } from '../chem/resolve';
import type { ReagentLot } from '../chem/lots';
import { doiUrl, formatReference } from '../chem/refs';
import { activeRun, runCode } from '../chem/runs';
import { lotRepo } from '../storage/lots';
import { compute, dispensedByVolume, type Component, type Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { AMOUNT_UNITS, fmt, MASS_UNITS, VOLUME_UNITS, type Units } from '../units';

interface Props {
  rxn: Reaction;
  units: Units;
  rd: MainModule | null;
  /** Scheme text: abbreviations or full names. */
  labels?: SchemeLabels;
  /** Scheme style (shared with the Word export). */
  look: ReportLook;
  onLook: (v: ReportLook) => void;
  /** Export the same report as Word. */
  onWord?: () => void;
  wordBusy?: boolean;
  /** Saved reaction on the server, to list its attachments. */
  reactionId?: string;
  onChange: (r: Reaction) => void;
  onClose: () => void;
}

type SafetyMap = Record<string, PubChemSafety | null>;

export default function Report({ rxn, units, rd, labels, look, onLook, onWord, wordBusy, reactionId, onChange, onClose }: Props) {
  const { t, lang } = useI18n();
  const shown = useMemo(() => withAbbrs(rd, rxn), [rd, rxn]);
  const abbr = (c: Component) => shown.components.find((x) => x.id === c.id)?.abbr;
  const [withSafety, setWithSafety] = useState(true);
  const [withScheme, setWithScheme] = useState(true);
  const [safety, setSafety] = useState<SafetyMap>({});
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [now] = useState(() => new Date());
  const [attachments, setAttachments] = useState<(Row & { compoundId?: string })[]>([]);
  const procedure = procedureOf(rxn);
  const run = activeRun(rxn);
  const code = runCode(rxn, run);
  const withActual = rxn.components.some((c) => c.actualAmount);
  const withLot = rxn.components.filter((c) => c.role !== 'product' && c.lot);
  const [lots, setLots] = useState<Map<string, ReagentLot>>(new Map());
  useEffect(() => {
    if (!withLot.some((c) => c.lot?.lotId)) return;
    lotRepo.list().then((l) => setLots(new Map(l.map((x) => [x.id, x]))), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reactionId)
      getGraph(reactionId).then(
        (g) => {
          const ix = indexGraph(g.nodes, g.links);
          setAttachments(treeRows(ix, g.nodes).map((r) => ({ ...r, compoundId: compoundOf(ix, r.node.id) })));
        },
        () => setAttachments([]),
      );
  }, [reactionId]);

  // While the report is open, printing shows only the report.
  useEffect(() => {
    document.body.classList.add('report-open');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('report-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Fetch GHS data (cached) for every compound except solvents' duplicates.
  useEffect(() => {
    if (!withSafety) return;
    let cancelled = false;
    const list = rxn.components.filter((c) => !(c.id in safety));
    if (!list.length) return;
    (async () => {
      let done = 0;
      setProgress([0, list.length]);
      for (const c of list) {
        let s: PubChemSafety | null = null;
        try {
          const cid = await findCid(c);
          if (cid) s = await getSafetyCached(cid);
        } catch {
          /* offline */
        }
        if (cancelled) return;
        setSafety((m) => ({ ...m, [c.id]: s }));
        setProgress([++done, list.length]);
      }
      setProgress(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withSafety, rxn.components]);

  const am = AMOUNT_UNITS[units.amount];
  const ms = MASS_UNITS[units.mass];
  const vl = VOLUME_UNITS[units.volume];
  const inputs = rxn.components.filter((c) => c.role !== 'product');
  const products = rxn.components.filter((c) => c.role === 'product');
  const dateText = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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

  const safetyRows = rxn.components
    .map((c) => ({ c, s: safety[c.id] }))
    .filter(({ s }) => s && (s.ghsPictograms.length || s.hazards.length));

  const print = () => {
    const prev = document.title;
    // Browsers use the document title as the default PDF file name.
    document.title = `${code} ${rxn.title || t.report.untitled} ${run.date ?? now.toISOString().slice(0, 10)}`;
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  };

  // Portal to <body>: print CSS hides the app shell and keeps only the report.
  return createPortal(
    <div className="report-root" role="dialog" aria-modal="true" aria-label={t.report.title}>
      <div className="report-bar">
        <strong>{t.report.title}</strong>
        <label>
          {t.report.operator}
          <input value={rxn.operator ?? ''} onChange={(e) => onChange({ ...rxn, operator: e.target.value })} />
        </label>
        <label>
          {t.report.notebook}
          <input value={rxn.notebook ?? ''} placeholder={code} onChange={(e) => onChange({ ...rxn, notebook: e.target.value || undefined })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={withScheme} onChange={(e) => setWithScheme(e.target.checked)} />
          {t.report.includeScheme}
        </label>
        {withScheme && (
          <div className="seg" role="group" aria-label={t.report.schemeStyle} title={t.report.schemeStyleTip}>
            <span className="seg-label">{t.report.schemeStyle}</span>
            {REPORT_LOOKS.map((v) => (
              <button key={v} className={look === v ? 'on' : ''} aria-pressed={look === v} title={t.report.lookTips[v]} onClick={() => onLook(v)}>
                {t.report.looks[v]}
              </button>
            ))}
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={withSafety} onChange={(e) => setWithSafety(e.target.checked)} />
          {t.report.includeSafety}
        </label>
        {progress && <span className="muted small">{t.report.fetching.replace('{a}', String(progress[0])).replace('{b}', String(progress[1]))}</span>}
        <span className="grow" />
        <button className="ghost" onClick={onClose}>{t.close}</button>
        {onWord && (
          <button className="ghost" disabled={wordBusy} title={t.office.word} onClick={onWord}>Word</button>
        )}
        <button onClick={print} title={t.report.pdfTip}>{t.report.savePdf}</button>
      </div>

      <div className="report-scroll">
        <article className="paper">
          <header className="rp-head">
            <div>
              <div className="rp-kicker">{t.report.kicker}</div>
              <h1>{rxn.title || t.report.untitled}</h1>
            </div>
            <dl className="rp-meta">
              <dt>{t.report.notebook}</dt>
              <dd>{code}</dd>
              <dt>{t.report.date}</dt>
              <dd>{run.date ?? dateText}</dd>
              <dt>{t.runs.status}</dt>
              <dd>{t.runs.statuses[run.status]}</dd>
              {rxn.operator && (
                <>
                  <dt>{t.report.operator}</dt>
                  <dd>{rxn.operator}</dd>
                </>
              )}
            </dl>
          </header>

          {withScheme && (
            <section>
              <h2>{t.preview}</h2>
              <Scheme rxn={shown} rd={rd} labels={labels} look={look} />
              {rxn.conditions && (
                <p className="rp-cond">
                  <span>{t.conditions}</span>
                  {rxn.conditions}
                </p>
              )}
            </section>
          )}
          {!withScheme && rxn.conditions && (
            <p className="rp-cond">
              <span>{t.conditions}</span>
              {rxn.conditions}
            </p>
          )}

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

          {withLot.length > 0 && (
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
          )}

          {products.length > 0 && (
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
          )}

          {!isEmptyDoc(procedure) && (
            <section>
              <h2>{t.notes}</h2>
              <div className="rp-text rp-proc" dangerouslySetInnerHTML={{ __html: toHtml(procedure, { observation: t.proc.observation }) }} />
            </section>
          )}

          {products.some((p) => p.characterization?.trim()) && (
            <section>
              <h2>{t.att.characterization}</h2>
              {products
                .filter((p) => p.characterization?.trim())
                .map((p) => (
                  <div key={p.id} className="rp-charac">
                    <div className="rp-name">{p.name}</div>
                    <div className="rp-text">{p.characterization}</div>
                  </div>
                ))}
            </section>
          )}

          {attachments.length > 0 && (
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
          )}

          {(rxn.references?.length ?? 0) > 0 && (
            <section>
              <h2>{t.refs.title}</h2>
              <ol className="rp-refs">
                {rxn.references!.map((r) => (
                  <li key={r.id}>
                    {formatReference(r)}
                    {r.doi && <span className="rp-sub"> {doiUrl(r.doi)}</span>}
                    {!r.doi && r.url && <span className="rp-sub"> {r.url}</span>}
                    {r.note && <div className="rp-sub">{r.note}</div>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {withSafety && (
            <section className="rp-safety">
              <h2>{t.report.safety}</h2>
              {safetyRows.length ? (
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>{t.col.name}</th>
                      <th>{t.report.pictograms}</th>
                      <th>{t.report.hazards}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safetyRows.map(({ c, s }) => (
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
                <p className="muted small">{progress ? t.report.fetchingShort : t.report.noSafety}</p>
              )}
              <p className="rp-fine">{t.dataSource}</p>
            </section>
          )}


          <footer className="rp-foot">
            <span>{t.appTitle} · {dateText}</span>
            <span>{t.footer}</span>
          </footer>
        </article>
      </div>
    </div>,
    document.body,
  );
}

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

/** Black-and-white scheme at its printed (ACS) size; conditions are listed below it. */
function Scheme({ rxn, rd, labels, look }: { rxn: Reaction; rd: MainModule | null; labels?: SchemeLabels; look: ReportLook }) {
  const out = useMemo(() => schemeSvg(rd, { ...rxn, conditions: '' }, { labels, style: look }), [rd, rxn, labels, look]);
  if (!out) return null;
  return (
    <div className="rp-scheme">
      <img alt="" style={{ width: `${unitsToPt(out.width)}pt` }} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg)} />
    </div>
  );
}
