import type { MainModule } from '@rdkit/rdkit';
import { useMemo, useState } from 'react';
import { entryToData } from '../chem/abbr';
import { libraryToComponent } from '../chem/library';
import { available, lotLabel, lotSearchText, type ReagentLot } from '../chem/lots';
import { hitToData, resolveOne, searchAll, smilesToData, type CompoundData, type SearchResults } from '../chem/resolve';
import type { OpenEditor } from '../App';
import { formulaMass } from '../chem/formula';
import type { Role } from '../chem/stoich';
import { useI18n } from '../i18n';
import { useInventory } from '../storage/inventory';
import { fmt } from '../units';

const ROLES: Role[] = ['reactant', 'reagent', 'catalyst', 'solvent', 'product'];

interface Props {
  rd: MainModule | null;
  onAdd: (data: CompoundData, role: Role) => void;
  /** Add a bottle from the inventory. */
  onAddLot: (lot: ReagentLot, role: Role) => void;
  openEditor: OpenEditor;
}

export function CompoundSearch({ rd, onAdd, onAddLot, openEditor }: Props) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role>('reactant');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SearchResults | null>(null);
  const [manual, setManual] = useState(false);
  const [mName, setMName] = useState('');
  const [mFormula, setMFormula] = useState('');
  const [mMw, setMMw] = useState('');
  const inventory = useInventory();
  // Bottles in the lab matching what is typed (shown before any web search).
  const stock = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !inventory) return [];
    return inventory.filter((l) => available(l) && words.every((w) => lotSearchText(l).includes(w))).slice(0, 8);
  }, [q, inventory]);

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setRes(await searchAll(q, rd));
    } finally {
      setBusy(false);
    }
  };

  const add = (d: CompoundData) => {
    onAdd(d, role);
    setRes(null);
    setQ('');
  };

  const addManual = () => {
    const mw = Number(mMw) || formulaMass(mFormula) || undefined;
    if (!mName.trim() && !mFormula.trim()) return;
    onAdd({ name: mName.trim() || mFormula.trim(), formula: mFormula.trim() || undefined, mw, purity: 100, form: 'neat' }, role);
    setMName('');
    setMFormula('');
    setMMw('');
    setManual(false);
  };

  const derivedMw = formulaMass(mFormula);
  const empty = res && !res.abbrs.length && !res.local.length && !res.pubchem.length && !res.smiles;

  return (
    <div className="search">
      <div className="row">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t.addAs}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{t.roles[r]}</option>
          ))}
        </select>
        <input
          className="grow"
          value={q}
          placeholder={t.searchPh}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button onClick={run} disabled={busy}>{busy ? t.searching : t.search}</button>
        <button
          className="ghost"
          onClick={() =>
            openEditor({
              mode: 'molecule',
              onApply: async ({ text }) => {
                const d = (await resolveOne(text, rd, lang)) ?? (rd ? smilesToData(rd, text, undefined, lang) : null);
                if (d) onAdd(d, role);
              },
            })
          }
        >
          ✏️ {t.draw}
        </button>
        <button className="ghost" onClick={() => setManual((m) => !m)}>{t.manualAdd}</button>
      </div>

      {manual && (
        <div className="row manual">
          <input placeholder={t.manualName} value={mName} onChange={(e) => setMName(e.target.value)} />
          <input placeholder={t.manualFormula} value={mFormula} onChange={(e) => setMFormula(e.target.value)} />
          <input
            placeholder={derivedMw ? fmt(derivedMw, 6) : t.manualMw}
            value={mMw}
            inputMode="decimal"
            onChange={(e) => setMMw(e.target.value)}
          />
          <button onClick={addManual}>{t.add}</button>
        </div>
      )}

      {stock.length > 0 && (
        <div className="results stock-results">
          <h4>{t.inv.inStock}</h4>
          {stock.map((l) => (
            <ResultItem
              key={l.id}
              title={l.name}
              sub={[
                lotLabel(l, t.lots.made),
                l.spec,
                (l.molarity ?? l.compound?.molarity) && `${l.molarity ?? l.compound?.molarity} M`,
                l.location && `📍 ${l.location}`,
                l.remaining,
                l.status === 'low' ? t.inv.statuses.low : '',
                l.verification === 'ok' ? `✓ ${t.lots.verifications.ok}` : l.verification === 'issue' ? `⚠ ${t.lots.verifications.issue}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => {
                onAddLot(l, role);
                setQ('');
                setRes(null);
              }}
            />
          ))}
        </div>
      )}

      {res && (
        <div className="results">
          {res.error && <p className="warn">{t.networkError}</p>}
          {res.smiles && rd && (
            <ResultItem
              title={res.smiles}
              sub="SMILES"
              onClick={() => add(smilesToData(rd, res.smiles!, res.pubchem[0]?.title, lang))}
            />
          )}
          {res.abbrs.length > 0 && <h4>{t.abbr.tableResults}</h4>}
          {res.abbrs.map((e) => (
            <ResultItem
              key={e.id}
              title={`${e.abbr} — ${e.name}`}
              sub={[e.formula, e.cas && `CAS ${e.cas}`, e.smiles && !e.cas && e.smiles].filter(Boolean).join(' · ') || t.abbr.title}
              onClick={() => add(entryToData(e))}
            />
          ))}
          {res.local.length > 0 && <h4>{t.localResults}</h4>}
          {res.local.map((e) => (
            <ResultItem
              key={e.cas + e.en}
              title={lang === 'zh' ? e.zh : e.en}
              sub={`${lang === 'zh' ? e.en : e.zh} · ${e.formula} · CAS ${e.cas}`}
              onClick={() => add(libraryToComponent(e, lang))}
            />
          ))}
          {res.pubchem.length > 0 && <h4>{t.pubchemResults}</h4>}
          {res.pubchem.map((h) => (
            <ResultItem
              key={h.cid}
              title={h.title}
              sub={`${h.formula} · MW ${fmt(h.mw, 6)} · CID ${h.cid}`}
              onClick={() => add(hitToData(h, rd, lang))}
            />
          ))}
          {empty && !res.error && <p className="muted">{t.noResults}</p>}
        </div>
      )}
    </div>
  );
}

function ResultItem({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button className="result" onClick={onClick}>
      <span className="result-title">{title}</span>
      <span className="result-sub">{sub}</span>
    </button>
  );
}
