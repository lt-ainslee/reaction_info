// Word / Excel reports and scheme pictures / files of the current reaction.
import type { MainModule } from '@rdkit/rdkit';
import { useState } from 'react';
import { saveBlob } from '../export';
import { activeRun, runCode, runsOf } from '../chem/runs';
import type { ReportLook, SchemeLabels } from '../chem/scheme';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { lotRepo } from '../storage/lots';
import type { Units } from '../units';

export type SchemeFormat = 'svg' | 'png' | 'cdxml' | 'rxn';

interface Options {
  rxn: Reaction;
  /** The reaction with effective abbreviations (withAbbrs). */
  shown: Reaction;
  units: Units;
  rd: MainModule | null;
  labels: SchemeLabels;
  reportLook: ReportLook;
  notify: (msg: string) => void;
}

/** "LT-042-1 Suzuki", safe as a file name. */
export const fileBaseOf = (rxn: Reaction) =>
  ([runCode(rxn, activeRun(rxn)), rxn.title].filter(Boolean).join(' ') || 'reaction').replace(/[\\/:*?"<>|]/g, '_');

export function useExports({ rxn, shown, units, rd, labels, reportLook, notify }: Options) {
  const { t } = useI18n();
  const [building, setBuilding] = useState(false);
  const fileBase = fileBaseOf(rxn);

  /** Word report / Excel workbook of the reaction (generator loaded on demand). */
  const exportOffice = async (kind: 'word' | 'excel') => {
    setBuilding(true);
    try {
      const [m, lib] = await Promise.all([import('../office/report'), lotRepo.list().catch(() => [])]);
      const used = new Set(runsOf(rxn).flatMap((r) => r.data.components.map((c) => c.lot?.lotId).filter(Boolean)));
      const lots = new Map(lib.filter((l) => used.has(l.id)).map((l) => [l.id, l]));
      const input = { rxn: shown, units, t, rd, lots, labels, look: reportLook };
      if (kind === 'word') saveBlob(await m.wordReport(input), `${fileBase}.docx`);
      else saveBlob(m.excelWorkbook(input), `${fileBase}.xlsx`);
    } catch (e) {
      console.error(e);
      notify(t.saveFailed);
    } finally {
      setBuilding(false);
    }
  };

  /** The scheme in black and white (ChemDraw style): SVG / PNG picture, editable CDXML, or RXN structures. */
  const exportScheme = async (f: SchemeFormat) => {
    const m = await import('../chem/scheme');
    if (f === 'svg' || f === 'png') {
      const out = m.schemeSvg(rd, shown, { background: f === 'png', labels });
      if (!out) return;
      if (f === 'svg') return saveBlob(new Blob([out.svg], { type: 'image/svg+xml' }), `${fileBase}.svg`);
      const png = await m.svgToPng(out.svg, out.width, out.height).catch(() => null);
      return png ? saveBlob(png, `${fileBase}.png`) : notify(t.saveFailed);
    }
    if (!rd) return notify(t.rdkitLoading);
    const text = f === 'cdxml' ? m.schemeCdxml(rd, shown, labels) : m.schemeRxnfile(rd, rxn);
    if (!text) return notify(t.scheme.noStructures);
    saveBlob(new Blob([text], { type: f === 'cdxml' ? 'chemical/x-cdxml' : 'chemical/x-mdl-rxnfile' }), `${fileBase}.${f}`);
  };

  return { building, fileBase, exportOffice, exportScheme };
}
