// Printable reaction report (A4). Shown as a paper preview in a modal; "Save
// as PDF" uses the browser's print dialog, which keeps text as vector text and
// renders Chinese with the system fonts (no font embedding needed).
import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { withAbbrs } from '../chem/abbr';
import { activeRun, runCode } from '../chem/runs';
import { REPORT_LOOKS, type ReportLook, type SchemeLabels } from '../chem/scheme';
import type { Component, Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import type { Units } from '../units';
import {
  AttachmentsSection, InputsTable, LotsTable, ProcedureSections, ProductsTable, ReferencesSection, SafetySection, SchemeSection,
} from './ReportSections';
import { useReportData } from './useReportData';

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

export default function Report({ rxn, units, rd, labels, look, onLook, onWord, wordBusy, reactionId, onChange, onClose }: Props) {
  const { t, lang } = useI18n();
  const shown = useMemo(() => withAbbrs(rd, rxn), [rd, rxn]);
  const abbr = (c: Component) => shown.components.find((x) => x.id === c.id)?.abbr;
  const [withSafety, setWithSafety] = useState(true);
  const [withScheme, setWithScheme] = useState(true);
  const [now] = useState(() => new Date());
  const { lots, attachments, safety, progress } = useReportData(rxn, reactionId, withSafety);
  const run = activeRun(rxn);
  const code = runCode(rxn, run);
  const dateText = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

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

          <SchemeSection rxn={rxn} shown={shown} rd={rd} labels={labels} look={look} withScheme={withScheme} />
          <InputsTable rxn={rxn} units={units} abbr={abbr} />
          <LotsTable rxn={rxn} lots={lots} />
          <ProductsTable rxn={rxn} units={units} abbr={abbr} />
          <ProcedureSections rxn={rxn} />
          <AttachmentsSection rxn={rxn} attachments={attachments} />
          <ReferencesSection rxn={rxn} />
          {withSafety && <SafetySection rxn={rxn} safety={safety} fetching={!!progress} />}

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
