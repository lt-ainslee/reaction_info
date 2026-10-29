import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { withAbbrs } from './chem/abbr';
import { REPORT_LOOKS, type SchemeLabels } from './chem/scheme';
import { emptyReaction, updateComponent, type Reaction } from './chem/stoich';
import type { EditorRequest, OpenEditor } from './app/editor';
import { usePref, useUnits } from './app/prefs';
import { useCompoundInput } from './app/useCompoundInput';
import { useExports } from './app/useExports';
import { useNotify } from './app/useNotify';
import { useRDKit } from './app/useRDKit';
import { useSaveReaction } from './app/useSaveReaction';
import { useStorageInfo } from './app/useStorageInfo';
import { AbbrTable } from './components/AbbrTable';
import { AppBar } from './components/AppBar';
import { Attachments } from './components/Attachments';
import { DetailPanel } from './components/DetailPanel';
import { DocHead } from './components/DocHead';
import { Inventory } from './components/Inventory';
import { Procedure } from './components/Procedure';
import type { SchemeLook } from './components/ReactionPreview';
import { References } from './components/References';
import Report from './components/Report';
import { RunBar } from './components/RunBar';
import { SchemeCard } from './components/SchemeCard';
import { TableCard } from './components/TableCard';
import { download } from './export';
import { useI18n } from './i18n';
import { loadDraft, reactionToFile, saveDraft } from './storage';
import { useAbbrs } from './storage/abbrs';
import { useSavedDoc } from './storage/useSavedDoc';
import { useAutoLookup } from './useAutoLookup';

const StructureEditor = lazy(() => import('./components/StructureEditor'));

export default function App() {
  const { t } = useI18n();
  const [rxn, setRxn] = useState<Reaction>(() => loadDraft() ?? emptyReaction());
  useEffect(() => saveDraft(rxn), [rxn]);
  const doc = useSavedDoc(rxn, setRxn);
  const { dirty, openId: savedId } = doc;
  const { rd, rdError } = useRDKit();
  const { flash, notify } = useNotify();
  const { storage, remote, suggestedCode } = useStorageInfo(savedId);
  const pending = useAutoLookup(rxn, setRxn, rd);

  const [units, setUnits] = useUnits();
  const [look, setLook] = usePref<SchemeLook>('schemeLook', ['color', 'mono']);
  const [labels, setLabels] = usePref<SchemeLabels>('schemeLabels', ['abbr', 'name']);
  // Scheme style in the PDF / Word reports (chosen in the report dialog).
  const [reportLook, setReportLook] = usePref('reportLook', REPORT_LOOKS);

  // The reaction with every compound's effective abbreviation, for drawing.
  const abbrTable = useAbbrs();
  const shown = useMemo(() => withAbbrs(rd, rxn, abbrTable ?? []), [rd, rxn, abbrTable]);
  const abbrMap = useMemo(() => new Map(shown.components.filter((c) => c.abbr).map((c) => [c.id, c.abbr!])), [shown]);

  // Open panels and windows.
  const [selected, setSelected] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [abbrsOpen, setAbbrsOpen] = useState(false);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const openEditor: OpenEditor = setEditor;
  /** Graph node to reveal in the attachments card (e.g. a lot from the side panel). */
  const [focusNode, setFocusNode] = useState<string | null>(null);

  const input = useCompoundInput(rd, rxn, setRxn, notify);
  const save = useSaveReaction({ rxn, setRxn, doc, suggestedCode, remote, notify });
  const { building, fileBase, exportOffice, exportScheme } = useExports({ rxn, shown, units, rd, labels, reportLook, notify });
  const confirmDiscard = (what: string) => !dirty || confirm(t.unsaved + ' — ' + what + '?');

  const selectedC = rxn.components.find((c) => c.id === selected);
  const hasComponents = rxn.components.length > 0;

  return (
    <div className="shell">
      <AppBar
        storage={storage}
        doc={doc}
        confirmDiscard={confirmDiscard}
        onSwitched={() => setSelected(null)}
        onNotify={notify}
        onOpenInventory={() => setInventoryOpen(true)}
        onOpenAbbrs={() => setAbbrsOpen(true)}
        newReaction={emptyReaction}
      />

      <main className="app">
        <DocHead
          rxn={rxn}
          setRxn={setRxn}
          suggestedCode={suggestedCode}
          dirty={dirty}
          savedId={savedId}
          busy={doc.busy}
          onSave={save}
          onDownload={() => download(`${fileBase}.reaction.json`, reactionToFile(rxn), 'application/json')}
        />

        <RunBar rxn={rxn} setRxn={setRxn} onNotify={notify} suggestedCode={suggestedCode} />

        <SchemeCard
          rxn={rxn}
          shown={shown}
          rd={rd}
          rdError={rdError}
          look={look}
          onLook={setLook}
          labels={labels}
          onLabels={setLabels}
          onExport={exportScheme}
          onSelect={setSelected}
          openEditor={openEditor}
          onApply={input.applyInput}
          onDrawn={input.importDrawing}
          onAdd={input.add}
          onAddLot={input.addLot}
        />

        {hasComponents && (
          <TableCard
            rxn={rxn}
            setRxn={setRxn}
            units={units}
            onUnits={setUnits}
            abbrs={abbrMap}
            pending={pending}
            selected={selected}
            onSelect={setSelected}
            fileBase={fileBase}
            building={building}
            reportLook={reportLook}
            onOffice={exportOffice}
            onReport={() => setReportOpen(true)}
            onNotify={notify}
          />
        )}

        {hasComponents && (
          <Attachments
            key={savedId ?? 'unsaved'}
            rxn={rxn}
            setRxn={setRxn}
            reactionId={savedId}
            remote={remote}
            onSave={() => save(false)}
            onNotify={notify}
            focusNode={focusNode}
            onFocused={() => setFocusNode(null)}
            onReagentInfo={setSelected}
            onOpenReaction={async (id) => {
              if (!confirmDiscard(t.load)) return;
              if (!(await doc.open(id))) notify(t.notFound);
            }}
          />
        )}

        {hasComponents && (
          <section className="card">
            <div className="card-head">
              <h2>{t.conditionsNotes}</h2>
            </div>
            <div className="notes-grid">
              <label className="field">
                <span>{t.conditions}</span>
                <input
                  value={rxn.conditions ?? ''}
                  placeholder={t.conditionsPh}
                  onChange={(e) => setRxn({ ...rxn, conditions: e.target.value })}
                />
              </label>
              <div className="field">
                <span>{t.notes}</span>
                <Procedure rxn={rxn} setRxn={setRxn} onNotify={notify} />
              </div>
            </div>
          </section>
        )}

        {hasComponents && <References rxn={rxn} setRxn={setRxn} />}

        <footer className="muted small">{t.footer}</footer>
      </main>

      {selectedC && (
        <DetailPanel
          key={selectedC.id}
          c={selectedC}
          rd={rd}
          openEditor={openEditor}
          onUpdate={(p) => setRxn((r) => updateComponent(r, selectedC.id, p))}
          onClose={() => setSelected(null)}
          onNotify={notify}
          currentReactionId={savedId}
          onOpenAbbrs={() => {
            setSelected(null);
            setAbbrsOpen(true);
          }}
          onOpenInventory={() => {
            setSelected(null);
            setInventoryOpen(true);
          }}
          onShowSpectra={(lotId) => {
            setSelected(null);
            setFocusNode(`lot:${lotId}`);
          }}
        />
      )}
      {abbrsOpen && <AbbrTable rd={rd} rxn={rxn} onClose={() => setAbbrsOpen(false)} onNotify={notify} />}
      {inventoryOpen && <Inventory rd={rd} onClose={() => setInventoryOpen(false)} onAdd={input.addLot} onNotify={notify} />}
      {flash && <div className="toast">{flash}</div>}
      {reportOpen && (
        <Report
          rxn={rxn}
          units={units}
          rd={rd}
          labels={labels}
          look={reportLook}
          onLook={setReportLook}
          onWord={() => exportOffice('word')}
          wordBusy={building}
          reactionId={remote ? savedId : undefined}
          onChange={setRxn}
          onClose={() => setReportOpen(false)}
        />
      )}
      {editor && (
        <Suspense fallback={<div className="modal-backdrop"><p className="toast">{t.editorLoading}</p></div>}>
          <StructureEditor
            {...editor}
            onApply={(r) => {
              setEditor(null);
              editor.onApply(r);
            }}
            onClose={() => setEditor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
