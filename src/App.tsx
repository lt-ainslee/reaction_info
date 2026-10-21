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
import { NumInput } from './components/NumInput';
import { ReactionInput, type ApplyMode } from './components/ReactionInput';
import { ReactionPreview } from './components/ReactionPreview';
import { SavedMenu } from './components/SavedMenu';
import type { StructureEditorProps } from './components/StructureEditor';
import { StoichTable } from './components/StoichTable';
import { download, reactionSmiles, toCsv, toMarkdown } from './export';
import { useI18n } from './i18n';
import { listSaved, loadCurrent, reactionToFile, saveCurrent, saveReaction } from './storage';
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
  const [rxn, setRxn] = useState<Reaction>(() => loadCurrent() ?? emptyReaction());
  const [savedId, setSavedId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem('current-saved-id') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [units, setUnits] = useState<Units>(loadUnits);
  const [rd, setRd] = useState<MainModule | null>(null);
  const [rdError, setRdError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [planTarget, setPlanTarget] = useState<number | undefined>();
  const [planYield, setPlanYield] = useState<number | undefined>(80);
  const [editor, setEditor] = useState<Omit<StructureEditorProps, 'onClose'> | null>(null);
  // Snapshot of the reaction as last saved, to show unsaved changes.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() => {
    const entry = savedId ? listSaved().find((x) => x.id === savedId) : undefined;
    return entry ? JSON.stringify(entry.reaction) : null;
  });
  const pending = useAutoLookup(rxn, setRxn, rd);
  const dirty = savedSnapshot === null ? rxn.components.length > 0 : JSON.stringify(rxn) !== savedSnapshot;

  useEffect(() => {
    loadRDKit().then(setRd, () => setRdError(true));
  }, []);
  useEffect(() => saveCurrent(rxn), [rxn]);
  useEffect(() => {
    try {
      localStorage.setItem('units', JSON.stringify(units));
      if (savedId) localStorage.setItem('current-saved-id', savedId);
      else localStorage.removeItem('current-saved-id');
    } catch {
      /* ignore */
    }
  }, [units, savedId]);

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

  /** Save to this browser's list; "save as" asks for a new name and keeps the original. */
  const save = (asNew: boolean) => {
    let r = rxn;
    if (asNew) {
      const name = prompt(t.saveAsPrompt, rxn.title ? `${rxn.title} ${t.copySuffix}` : '');
      if (name === null) return;
      r = { ...rxn, title: name.trim() };
      setRxn(r);
    }
    const list = saveReaction(r, asNew ? undefined : savedId);
    setSavedId(list[0].id);
    setSavedSnapshot(JSON.stringify(r));
    notify((asNew ? t.savedAsMsg : t.savedMsg).replace('{name}', r.title || '—'));
  };

  const selectedC = rxn.components.find((c) => c.id === selected);
  const product = rxn.components.find((c) => c.role === 'product');
  const exportLabels = { roles: t.roles, col: t.col, yield: t.yield, actualMass: t.actualMass, conditions: t.conditions, liquid: t.forms.liquid, notes: t.notes };
  const fileBase = (rxn.title || 'reaction').replace(/[\\/:*?"<>|]/g, '_');

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>{t.appTitle}</h1>
          <p className="subtitle">{t.appSubtitle}</p>
        </div>
        <div className="top-actions no-print">
          <SavedMenu
            currentId={savedId}
            onLoad={(s) => {
              setRxn(s.reaction);
              setSavedId(s.id);
              setSavedSnapshot(JSON.stringify(s.reaction));
              setSelected(null);
            }}
            onOpenFile={(r) => {
              if (dirty && !confirm(t.unsaved + ' — ' + t.openFromFile + '?')) return;
              setRxn(r);
              setSavedId(undefined);
              setSavedSnapshot(null);
              setSelected(null);
              notify(t.openedFile.replace('{name}', r.title || '—'));
            }}
            onDeleted={(id) => {
              if (id === savedId) {
                setSavedId(undefined);
                setSavedSnapshot(null);
              }
            }}
          />
          <button
            className="ghost"
            onClick={() => {
              if (dirty && !confirm(t.unsaved + ' — ' + t.newReaction + '?')) return;
              setRxn(emptyReaction());
              setSavedId(undefined);
              setSavedSnapshot(null);
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
      </header>

      <main>
        <section className="card">
          <div className="row title-row">
            <input
              className="grow title-input"
              value={rxn.title}
              placeholder={t.reactionTitlePh}
              aria-label={t.reactionTitle}
              onChange={(e) => setRxn({ ...rxn, title: e.target.value })}
            />
            <span className={'save-state no-print ' + (dirty ? 'dirty' : '')}>
              {dirty ? t.unsaved : savedId ? t.savedState : ''}
            </span>
            <button className="no-print" onClick={() => save(false)} disabled={!dirty && !!savedId}>
              {t.save}
            </button>
            {savedId && (
              <button className="ghost no-print" onClick={() => save(true)} title={t.saveAsTip}>
                {t.saveAs}
              </button>
            )}
            <button
              className="ghost no-print"
              title={t.downloadTip}
              disabled={!rxn.components.length}
              onClick={() => download(`${fileBase}.reaction.json`, reactionToFile(rxn), 'application/json')}
            >
              ⬇ {t.download}
            </button>
          </div>
          <div className="no-print">
            <h2>{t.importLabel}</h2>
            <ReactionInput
              rd={rd}
              hasComponents={rxn.components.length > 0}
              currentEquation={() => reactionSmiles(rxn)}
              onApply={applyInput}
              onDraw={() =>
                openEditor({
                  mode: 'reaction',
                  initial: rxn.components.some((c) => c.smiles) ? reactionSmiles(rxn) : undefined,
                  onApply: importDrawing,
                })
              }
            />
            <h2>{t.addCompound}</h2>
            <CompoundSearch rd={rd} onAdd={add} openEditor={openEditor} />
          </div>
        </section>

        <section className="card">
          <h2>{t.preview}</h2>
          <ReactionPreview rxn={rxn} rd={rd} rdError={rdError} onSelect={setSelected} />
          {rxn.components.some((c) => c.smiles) && <p className="mono small muted break">{reactionSmiles(rxn)}</p>}
        </section>

        {rxn.components.length > 0 && (
          <section className="card">
            <div className="row spread">
              <h2>{t.table}</h2>
              <div className="row toolbar no-print">
                <span className="muted">{t.scale}</span>
                {[0.5, 2, 5, 10].map((f) => (
                  <button key={f} className="ghost small" onClick={() => setRxn(scale(rxn, f))}>×{f}</button>
                ))}
                <button
                  className="ghost small"
                  onClick={() => navigator.clipboard.writeText(toMarkdown(rxn, units, exportLabels)).then(() => notify(t.copied))}
                >
                  {t.exportMd}
                </button>
                <button className="ghost small" onClick={() => download(`${fileBase}.csv`, toCsv(rxn, units, exportLabels))}>
                  {t.exportCsv}
                </button>
                <button className="ghost small" onClick={() => window.print()}>{t.print}</button>
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
              <div className="row plan no-print">
                <span className="muted">{t.plan}:</span>
                <label>
                  {t.planTarget} ({units.mass})
                  <NumInput value={planTarget} onCommit={setPlanTarget} onClear={() => setPlanTarget(undefined)} />
                </label>
                <label>
                  {t.planYield}
                  <NumInput value={planYield} sig={3} onCommit={setPlanYield} />
                </label>
                <button
                  className="small"
                  disabled={!planTarget || !planYield}
                  onClick={() => setRxn(planForProduct(rxn, product.id, planTarget! * MASS_UNITS[units.mass], planYield!))}
                >
                  {t.planApply}
                </button>
              </div>
            )}
            <label className="field notes">
              <span>{t.conditions}</span>
              <input
                value={rxn.conditions ?? ''}
                placeholder={t.conditionsPh}
                onChange={(e) => setRxn({ ...rxn, conditions: e.target.value })}
              />
            </label>
            <label className="field notes">
              <span>{t.notes}</span>
              <textarea rows={3} value={rxn.notes ?? ''} onChange={(e) => setRxn({ ...rxn, notes: e.target.value })} />
            </label>
          </section>
        )}
      </main>

      <footer className="muted small">{t.footer}</footer>

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
