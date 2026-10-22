import type { MainModule } from '@rdkit/rdkit';
import { lazy, Suspense, useEffect, useState } from 'react';
import { loadRDKit } from './chem/rdkit';
import { groupFragments, parseInputText } from './chem/parseInput';
import { compoundKey, resolveParsed, type CompoundData, type Resolved } from './chem/resolve';
import {
  addComponent, emptyReaction, mergeComponents, newComponent, planForProduct, removeComponent, scale, updateComponent,
  type Reaction, type Role,
} from './chem/stoich';
import { CompoundSearch } from './components/CompoundSearch';
import { DetailPanel } from './components/DetailPanel';
import Report from './components/Report';
import { NumInput } from './components/NumInput';
import { ReactionInput, type ApplyMode } from './components/ReactionInput';
import { ReactionPreview } from './components/ReactionPreview';
import { SavedMenu } from './components/SavedMenu';
import type { StructureEditorProps } from './components/StructureEditor';
import { StoichTable } from './components/StoichTable';
import { download, drawableEquation, reactionSmiles, toCsv, toMarkdown } from './export';
import { useI18n } from './i18n';
import { loadDraft, reactionToFile, saveDraft, type SavedReaction } from './storage';
import { useSavedDoc } from './storage/useSavedDoc';
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
  const pending = useAutoLookup(rxn, setRxn, rd);

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
    let r = rxn;
    if (asNew) {
      const name = prompt(t.saveAsPrompt, rxn.title ? `${rxn.title} ${t.copySuffix}` : '');
      if (name === null) return;
      r = { ...rxn, title: name.trim() };
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
      if (res.outcome === 'updated') notify(t.savedMsg.replace('{name}', name));
      else if (res.outcome === 'created') notify((asNew ? t.savedAsMsg : t.savedMsg).replace('{name}', name));
      else if (res.outcome === 'copied') notify(t.savedCopyMsg.replace('{name}', name));
    } catch {
      notify(t.saveFailed);
    }
  };

  const confirmDiscard = (what: string) => !dirty || confirm(t.unsaved + ' — ' + what + '?');

  const selectedC = rxn.components.find((c) => c.id === selected);
  const product = rxn.components.find((c) => c.role === 'product');
  const exportLabels = { roles: t.roles, col: t.col, yield: t.yield, actualMass: t.actualMass, conditions: t.conditions, liquid: t.forms.liquid, notes: t.notes };
  const fileBase = (rxn.title || 'reaction').replace(/[\\/:*?"<>|]/g, '_');

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
            <SavedMenu
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
          <input
            className="title-input"
            value={rxn.title}
            placeholder={t.reactionTitlePh}
            aria-label={t.reactionTitle}
            onChange={(e) => setRxn({ ...rxn, title: e.target.value })}
          />
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

        <section className="card">
          <div className="card-head">
            <h2>{t.preview}</h2>
          </div>
          <ReactionPreview rxn={rxn} rd={rd} rdError={rdError} onSelect={setSelected} />
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
              <CompoundSearch rd={rd} onAdd={add} openEditor={openEditor} />
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
                </div>
                <button onClick={() => setReportOpen(true)}>{t.exportReport}</button>
              </div>
            </div>
            <StoichTable
              rxn={rxn}
              units={units}
              onUnits={setUnits}
              pending={pending}
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
              <label className="field">
                <span>{t.notes}</span>
                <textarea rows={3} value={rxn.notes ?? ''} onChange={(e) => setRxn({ ...rxn, notes: e.target.value })} />
              </label>
            </div>
          </section>
        )}

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
        />
      )}
      {flash && <div className="toast">{flash}</div>}
      {reportOpen && <Report rxn={rxn} units={units} rd={rd} onChange={setRxn} onClose={() => setReportOpen(false)} />}
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
