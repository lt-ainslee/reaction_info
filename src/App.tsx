import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useState } from 'react';
import { loadRDKit } from './chem/rdkit';
import type { CompoundData } from './chem/resolve';
import {
  addComponent, emptyReaction, newComponent, planForProduct, removeComponent, scale, updateComponent,
  type Reaction, type Role,
} from './chem/stoich';
import { CompoundSearch } from './components/CompoundSearch';
import { DetailPanel } from './components/DetailPanel';
import { NumInput } from './components/NumInput';
import { ReactionImport } from './components/ReactionImport';
import { ReactionPreview } from './components/ReactionPreview';
import { SavedMenu } from './components/SavedMenu';
import { StoichTable } from './components/StoichTable';
import { download, reactionSmiles, toCsv, toMarkdown } from './export';
import { useI18n } from './i18n';
import { loadCurrent, saveCurrent, saveReaction } from './storage';
import { DEFAULT_UNITS, MASS_UNITS, type Units } from './units';

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
    setTimeout(() => setFlash(null), 1800);
  };

  const add = (data: CompoundData, role: Role) => setRxn((r) => addComponent(r, newComponent({ ...data, role })));
  const addMany = (items: { data: CompoundData; role: Role }[]) =>
    setRxn((r) => items.reduce((acc, { data, role }) => addComponent(acc, newComponent({ ...data, role })), r));

  const selectedC = rxn.components.find((c) => c.id === selected);
  const product = rxn.components.find((c) => c.role === 'product');
  const exportLabels = { roles: t.roles, col: t.col, yield: t.yield, actualMass: t.actualMass, notes: t.notes };
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
            onLoad={(s) => {
              setRxn(s.reaction);
              setSavedId(s.id);
              setSelected(null);
            }}
          />
          <button
            className="ghost"
            onClick={() => {
              setRxn(emptyReaction());
              setSavedId(undefined);
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
            <button
              className="no-print"
              onClick={() => {
                const list = saveReaction(rxn, savedId);
                setSavedId(list[0].id);
                notify(t.save + ' ✓');
              }}
            >
              {t.save}
            </button>
          </div>
          <div className="no-print">
            <h2>{t.importLabel}</h2>
            <ReactionImport rd={rd} onImport={addMany} />
            <h2>{t.addCompound}</h2>
            <CompoundSearch rd={rd} onAdd={add} />
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
          onUpdate={(p) => setRxn((r) => updateComponent(r, selectedC.id, p))}
          onClose={() => setSelected(null)}
        />
      )}
      {flash && <div className="toast">{flash}</div>}
    </div>
  );
}
