import type { MainModule } from '@rdkit/rdkit';
import { lazy, Suspense, useEffect, useState } from 'react';
import { loadRDKit } from './chem/rdkit';
import { componentFromLot, type ReagentLot } from './chem/lots';
import { activeRun, nextCode, runCode, runsOf } from './chem/runs';
import { groupFragments, parseInputText } from './chem/parseInput';
import { compoundKey, resolveParsed, type CompoundData, type Resolved } from './chem/resolve';
import {
  addComponent, emptyReaction, mergeComponents, newComponent, planForProduct, removeComponent, scale, updateComponent,
  type Reaction, type Role,
} from './chem/stoich';
import { CompoundSearch } from './components/CompoundSearch';
import { DetailPanel } from './components/DetailPanel';
import Report from './components/Report';
import { Attachments } from './components/Attachments';
import { Inventory } from './components/Inventory';
import { NumInput } from './components/NumInput';
import { Procedure } from './components/Procedure';
import { ReactionInput, type ApplyMode } from './components/ReactionInput';
import { ReactionPreview, type SchemeLook } from './components/ReactionPreview';
import { References } from './components/References';
import { RunBar } from './components/RunBar';
import { SavedMenu } from './components/SavedMenu';
import type { StructureEditorProps } from './components/StructureEditor';
import { StoichTable } from './components/StoichTable';
import { download, drawableEquation, reactionSmiles, toCsv, toMarkdown } from './export';
import { useI18n } from './i18n';
import { loadDraft, reactionToFile, repo, repoReady, saveDraft, type SavedReaction } from './storage';
import { useSavedDoc } from './storage/useSavedDoc';
import { saveBlob } from './attachments/pack';
import { lotRepo } from './storage/lots';
import { useAutoLookup } from './useAutoLookup';
import { DEFAULT_UNITS, MASS_UNITS, type Units } from './units';

const StructureEditor = lazy(() => import('./components/StructureEditor'));

export type OpenEditor = (req: Omit<StructureEditorProps, 'onClose'>) => void;

function loadUnits(): Units {
  try {
    return { ...DEFAULT_UNITS, ...JSON.parse(localStorage.getItem('units') ?? '{}') };
  } catch {
    return DEFAULT_UNITS;
  }
}

function loadLook(): SchemeLook {
  try {
    return localStorage.getItem('schemeLook') === 'mono' ? 'mono' : 'color';
  } catch {
    return 'color';
  }
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [rxn, setRxn] = useState<Reaction>(() => loadDraft() ?? emptyReaction());
  const doc = useSavedDoc(rxn, setRxn);
  const { dirty, openId: savedId } = doc;
  const [units, setUnits] = useState<Units>(loadUnits);
  const [rd, setRd] = useState<MainModule | null>(null);
  const [rdError, setRdError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [planTarget, setPlanTarget] = useState<number | undefined>();
  const [planYield, setPlanYield] = useState<number | undefined>(80);
  const [editor, setEditor] = useState<Omit<StructureEditorProps, 'onClose'> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [look, setLook] = useState<SchemeLook>(loadLook);
  /** Graph node to reveal in the attachments card (e.g. a lot from the side panel). */
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const pending = useAutoLookup(rxn, setRxn, rd);
  const [storage, setStorage] = useState<'local' | 'remote' | null>(null);
  useEffect(() => {
    repoReady.then(setStorage);
  }, []);
  const remote = storage === 'remote';

  // Next free reaction code (from the saved list), offered when the code is empty.
  const [suggestedCode, setSuggestedCode] = useState('RXN-001');
  useEffect(() => {
    if (!storage) return;
    repo.list().then(
      (list) => setSuggestedCode(nextCode(list.filter((s) => s.id !== savedId).map((s) => s.meta?.code))),
      () => undefined,
    );
  }, [storage, savedId]);
  const [showActual, setShowActual] = useState(false);
  const run = activeRun(rxn);
  const actualOn = showActual || run.status !== 'planned' || rxn.components.some((c) => c.actualAmount);

  useEffect(() => {
    loadRDKit().then(setRd, () => setRdError(true));
  }, []);
  useEffect(() => saveDraft(rxn), [rxn]);
  useEffect(() => {
    try {
      localStorage.setItem('units', JSON.stringify(units));
    } catch {
      /* ignore */
    }
  }, [units]);

  const notify = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3500);
  };

  const add = (data: CompoundData, role: Role) => setRxn((r) => addComponent(r, newComponent({ ...data, role })));
  /** A bottle from the inventory: structure, physical data, purity / concentration and the lot link. */
  const addLot = (lot: ReagentLot, role: Role) => setRxn((r) => addComponent(r, newComponent({ ...componentFromLot(lot), role })));
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const applyInput = (res: Resolved, mode: ApplyMode) =>
    setRxn((r) => {
      const explicitEquiv = new Set<string>();
      const incoming = res.items.map(({ data, role, equiv }) => {
        const c = newComponent({ ...data, role, ...(equiv ? { equiv } : {}) });
        if (equiv) explicitEquiv.add(c.id);
        return c;
      });
      const next = mergeComponents(r, incoming, (c) => compoundKey(rd, c), {
        replace: mode === 'replace',
        hasAgents: res.hasAgents,
        explicitEquiv,
      });
      const cond = res.conditions.join(', ');
      const conditions = !cond ? r.conditions : mode === 'replace' || !r.conditions ? cond : `${r.conditions}, ${cond}`;
      return { ...next, conditions };
    });

  /** Import a drawn reaction (or a set of drawn compounds). */
  const importDrawing = async ({ text, isReaction }: { text: string; isReaction: boolean }) => {
    // Unconnected drawn compounds come as one dotted SMILES: one compound per line instead.
    const input = isReaction ? text : groupFragments(text).join('\n');
    const parsed = parseInputText(rd, input);
    if (!parsed) return;
    const res = await resolveParsed(parsed, rd, lang);
    applyInput(res, isReaction && rxn.components.length ? 'replace' : 'add');
    notify(t.importedN.replace('{n}', String(res.items.length)));
  };

  const openEditor: OpenEditor = (req) => setEditor(req);

  /** Save; "save as" asks for a new name and keeps the original. */
  const save = async (asNew: boolean) => {
    // A reaction gets the next free code when first saved without one.
    let r = !savedId && !asNew && !rxn.code?.trim() ? { ...rxn, code: suggestedCode } : rxn;
    if (r !== rxn) setRxn(r);
    if (asNew) {
      const name = prompt(t.saveAsPrompt, rxn.title ? `${rxn.title} ${t.copySuffix}` : '');
      if (name === null) return;
      r = { ...r, title: name.trim() };
      setRxn(r);
    }
    try {
      const res = await doc.save(r, {
        asNew,
        copyTitle: (title) => `${title || t.report.untitled} ${t.copySuffix}`,
        resolveConflict: (cur: SavedReaction) =>
          confirm(t.conflictAsk.replace('{time}', new Date(cur.updatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en')))
            ? 'overwrite'
            : 'copy',
      });
      const name = res.saved?.title || '—';
      const msg = remote ? (asNew ? t.savedAsMsgRemote : t.savedMsgRemote) : asNew ? t.savedAsMsg : t.savedMsg;
      if (res.outcome === 'updated') notify((remote ? t.savedMsgRemote : t.savedMsg).replace('{name}', name));
      else if (res.outcome === 'created') notify(msg.replace('{name}', name));
      else if (res.outcome === 'copied') notify(t.savedCopyMsg.replace('{name}', name));
    } catch {
      notify(t.saveFailed);
    }
  };

  const [building, setBuilding] = useState(false);
  /** Word report / Excel workbook of the reaction (generator loaded on demand). */
  const exportOffice = async (kind: 'word' | 'excel') => {
    setBuilding(true);
    try {
      const [m, lib] = await Promise.all([import('./office/report'), lotRepo.list().catch(() => [])]);
      const used = new Set(runsOf(rxn).flatMap((r) => r.data.components.map((c) => c.lot?.lotId).filter(Boolean)));
      const lots = new Map(lib.filter((l) => used.has(l.id)).map((l) => [l.id, l]));
      const input = { rxn, units, t, rd, lots };
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
  const exportScheme = async (f: 'svg' | 'png' | 'cdxml' | 'rxn') => {
    const m = await import('./chem/scheme');
    if (f === 'svg' || f === 'png') {
      const out = m.schemeSvg(rd, rxn, { background: f === 'png' });
      if (!out) return;
      if (f === 'svg') return saveBlob(new Blob([out.svg], { type: 'image/svg+xml' }), `${fileBase}.svg`);
      const png = await m.svgToPng(out.svg, out.width, out.height).catch(() => null);
      return png ? saveBlob(png, `${fileBase}.png`) : notify(t.saveFailed);
    }
    if (!rd) return notify(t.rdkitLoading);
    const text = f === 'cdxml' ? m.schemeCdxml(rd, rxn) : m.schemeRxnfile(rd, rxn);
    if (!text) return notify(t.scheme.noStructures);
    saveBlob(new Blob([text], { type: f === 'cdxml' ? 'chemical/x-cdxml' : 'chemical/x-mdl-rxnfile' }), `${fileBase}.${f}`);
  };

  const confirmDiscard = (what: string) => !dirty || confirm(t.unsaved + ' — ' + what + '?');

  const selectedC = rxn.components.find((c) => c.id === selected);
  const product = rxn.components.find((c) => c.role === 'product');
  const exportLabels = { roles: t.roles, col: t.col, yield: t.yield, actualMass: t.actualMass, actual: t.runs.actual, conditions: t.conditions, liquid: t.forms.liquid, notes: t.notes };
  const fileBase = ([runCode(rxn, run), rxn.title].filter(Boolean).join(' ') || 'reaction').replace(/[\\/:*?"<>|]/g, '_');

  return (
    <div className="shell">
      <header className="appbar no-print">
        <div className="appbar-inner">
          <div className="brand">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
              <rect width="32" height="32" rx="7" fill="var(--accent)" />
              <path d="M12 6h8M14 6v7l-6 11a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="brand-name">{t.appTitle}</span>
            <span className="brand-sub">{t.appSubtitle}</span>
          </div>
          <div className="top-actions">
            {storage && (
              <span className={'storage-chip ' + storage} title={remote ? t.storageTipRemote : t.storageTipLocal}>
                {remote ? t.storageRemote : t.storageLocal}
              </span>
            )}
            <SavedMenu
              onNotify={notify}
              currentId={savedId}
              onOpen={async (id) => {
                if (id !== savedId && !confirmDiscard(t.load)) return false;
                try {
                  const ok = await doc.open(id);
                  if (!ok) notify(t.notFound);
                  setSelected(null);
                  return ok;
                } catch {
                  notify(t.loadFailed);
                  return false;
                }
              }}
              onOpenFile={(r) => {
                if (!confirmDiscard(t.openFromFile)) return;
                doc.detach(r);
                setSelected(null);
                notify(t.openedFile.replace('{name}', r.title || '—'));
              }}
              onDeleted={doc.removed}
            />
            <button className="ghost" onClick={() => setInventoryOpen(true)}>{t.inv.open}</button>
            <button
              className="ghost"
              onClick={() => {
                if (!confirmDiscard(t.newReaction)) return;
                doc.detach(emptyReaction());
                setSelected(null);
              }}
            >
              {t.newReaction}
            </button>
            <div className="lang" role="group" aria-label="Language">
              <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            </div>
          </div>
        </div>
      </header>

      <main className="app">
        <div className="doc-head">
          <div className="title-block">
            <input
              className="title-input"
              value={rxn.title}
              placeholder={t.reactionTitlePh}
              aria-label={t.reactionTitle}
              onChange={(e) => setRxn({ ...rxn, title: e.target.value })}
            />
            <span className="code-field">
              <span className="code-label">{t.runs.code}</span>
              <input
                className="code-input"
                value={rxn.code ?? ''}
                placeholder={t.runs.codePh.replace('{code}', suggestedCode)}
                aria-label={t.runs.code}
                onChange={(e) => setRxn({ ...rxn, code: e.target.value || undefined })}
              />
              {!rxn.code && (
                <button className="link small no-print" onClick={() => setRxn({ ...rxn, code: suggestedCode })}>{t.runs.autoCode}</button>
              )}
            </span>
          </div>
          <div className="doc-actions no-print">
            <span className={'save-state ' + (dirty ? 'dirty' : '')}>
              {dirty ? t.unsaved : savedId ? t.savedState : ''}
            </span>
            <button onClick={() => save(false)} disabled={doc.busy || (!dirty && !!savedId)}>
              {t.save}
            </button>
            {savedId && (
              <button className="ghost" onClick={() => save(true)} title={t.saveAsTip}>
                {t.saveAs}
              </button>
            )}
            <button
              className="ghost"
              title={t.downloadTip}
              disabled={!rxn.components.length}
              onClick={() => download(`${fileBase}.reaction.json`, reactionToFile(rxn), 'application/json')}
            >
              {t.download}
            </button>
          </div>
        </div>

        <RunBar rxn={rxn} setRxn={setRxn} onNotify={notify} suggestedCode={suggestedCode} />

        <section className="card">
          <div className="card-head">
            <h2>{t.preview}</h2>
            <div className="card-tools no-print">
              <div className="seg" role="group" aria-label={t.scheme.look}>
                {(['color', 'mono'] as const).map((v) => (
                  <button
                    key={v}
                    className={look === v ? 'on' : ''}
                    aria-pressed={look === v}
                    title={t.scheme.lookTips[v]}
                    onClick={() => {
                      setLook(v);
                      try {
                        localStorage.setItem('schemeLook', v);
                      } catch {
                        /* not remembered */
                      }
                    }}
                  >
                    {t.scheme.looks[v]}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label={t.scheme.export}>
                <span className="seg-label">{t.scheme.export}</span>
                {(['svg', 'png', 'cdxml', 'rxn'] as const).map((f) => (
                  <button key={f} title={t.scheme.formatTips[f]} disabled={!rxn.components.length} onClick={() => exportScheme(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <ReactionPreview rxn={rxn} rd={rd} rdError={rdError} look={look} onSelect={setSelected} />
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
                rd={rd}
                hasComponents={rxn.components.length > 0}
                currentEquation={() => reactionSmiles(rxn)}
                onApply={applyInput}
                onDraw={() =>
                  openEditor({
                    mode: 'reaction',
                    initial: drawableEquation(rxn),
                    editing: rxn.components.length > 0,
                    onApply: importDrawing,
                  })
                }
              />
            </div>
            <div className="input-block">
              <h3>{t.addCompound}</h3>
              <CompoundSearch rd={rd} onAdd={add} onAddLot={addLot} openEditor={openEditor} />
            </div>
          </div>
        </section>

        {rxn.components.length > 0 && (
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
                  <button onClick={() => navigator.clipboard.writeText(toMarkdown(rxn, units, exportLabels)).then(() => notify(t.copied))}>
                    {t.exportMd}
                  </button>
                  <button onClick={() => download(`${fileBase}.csv`, toCsv(rxn, units, exportLabels))}>{t.exportCsv}</button>
                  <button disabled={building} title={t.office.word} onClick={() => exportOffice('word')}>Word</button>
                  <button disabled={building} title={t.office.excel} onClick={() => exportOffice('excel')}>Excel</button>
                </div>
                {run.status === 'planned' && (
                  <label className="check small" title={t.runs.actualTip}>
                    <input type="checkbox" checked={actualOn} disabled={rxn.components.some((c) => c.actualAmount)} onChange={(e) => setShowActual(e.target.checked)} />
                    {t.runs.actualToggle}
                  </label>
                )}
                <button onClick={() => setReportOpen(true)}>{t.exportReport}</button>
              </div>
            </div>
            <StoichTable
              rxn={rxn}
              units={units}
              onUnits={setUnits}
              pending={pending}
              showActual={actualOn}
              onChange={setRxn}
              onSelect={setSelected}
              onRemove={(id) => {
                setRxn(removeComponent(rxn, id));
                if (selected === id) setSelected(null);
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
        )}

        {rxn.components.length > 0 && (
          <Attachments
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

        {rxn.components.length > 0 && (
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

        {rxn.components.length > 0 && <References rxn={rxn} setRxn={setRxn} />}

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
      {inventoryOpen && <Inventory rd={rd} onClose={() => setInventoryOpen(false)} onAdd={addLot} onNotify={notify} />}
      {flash && <div className="toast">{flash}</div>}
      {reportOpen && (
        <Report rxn={rxn} units={units} rd={rd} reactionId={remote ? savedId : undefined} onChange={setRxn} onClose={() => setReportOpen(false)} />
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
