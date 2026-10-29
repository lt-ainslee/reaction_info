// The abbreviation table: SM-1, Boc2O, 1a… → compound. Entries are made from
// a compound's properties panel or here (from the current reaction, or by
// looking up a name / CAS / SMILES), and edited or deleted in place.
import type { MainModule } from '@rdkit/rdkit';
import { useMemo, useState } from 'react';
import type { AbbrEntry } from '../chem/abbr';
import { smilesToSvg } from '../chem/rdkit';
import { resolveOne, type CompoundData } from '../chem/resolve';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { AbbrTakenError, assignAbbr, removeAbbr, saveAbbr, useAbbrs } from '../storage/abbrs';

interface Props {
  rd: MainModule | null;
  /** Current reaction, to pick compounds from. */
  rxn: Reaction;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

type Draft = Pick<CompoundData, 'name' | 'smiles' | 'cas' | 'formula' | 'mw'>;

export function AbbrTable({ rd, rxn, onClose, onNotify }: Props) {
  const { t, lang } = useI18n();
  const A = t.abbr;
  const list = useAbbrs();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [abbr, setAbbr] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (list ?? [])
      .filter((e) => words.every((w) => [e.abbr, e.name, e.cas, e.formula, e.note].join(' ').toLowerCase().includes(w)))
      .sort((a, b) => a.abbr.localeCompare(b.abbr, 'en', { numeric: true, sensitivity: 'base' }));
  }, [list, q]);

  const ask = (a: string) => (other: AbbrEntry) => confirm(A.conflict.replace('{a}', a).replace('{name}', other.name));

  const lookup = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const d = await resolveOne(query.trim(), rd, lang);
      if (!d) onNotify(A.notFound);
      setFound(d ?? { name: query.trim() });
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const a = abbr.trim();
    const c = found ?? (query.trim() ? { name: query.trim() } : null);
    if (!a || !c) return;
    try {
      const saved = await assignAbbr(rd, c, a, ask(a));
      if (!saved) return;
      onNotify(A.saved.replace('{a}', a).replace('{name}', c.name));
      setAbbr('');
      setQuery('');
      setFound(null);
      setAdding(false);
    } catch (e) {
      onNotify(e instanceof AbbrTakenError ? A.taken.replace('{a}', e.abbr) : t.saveFailed);
    }
  };

  const update = (e: AbbrEntry, p: Partial<AbbrEntry>) => saveAbbr({ ...e, ...p }).catch(() => onNotify(t.saveFailed));
  const rename = async (e: AbbrEntry, a: string) => {
    if (!a || a === e.abbr) return;
    try {
      await assignAbbr(rd, e, a, ask(a), e);
    } catch (e) {
      onNotify(e instanceof AbbrTakenError ? A.taken.replace('{a}', e.abbr) : t.saveFailed);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={A.title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal inv-modal abbr-modal">
        <header className="inv-head">
          <h3>{A.title}</h3>
          <span className="muted small">{A.count.replace('{n}', String(list?.length ?? 0))}</span>
          <span className="grow" />
          <button className="small" onClick={() => setAdding((x) => !x)}>{A.add}</button>
          <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <div className="inv-filters">
          <input className="grow" value={q} placeholder={A.searchPh} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <p className="hint abbr-hint">{A.hint}</p>

        {adding && (
          <div className="abbr-add">
            <input className="abbr-input" value={abbr} placeholder={A.fieldPh} onChange={(e) => setAbbr(e.target.value)} aria-label={A.field} />
            <span className="abbr-eq">=</span>
            <select
              value=""
              aria-label={A.fromReaction}
              onChange={(e) => {
                const c = rxn.components.find((x) => x.id === e.target.value);
                if (!c) return;
                setFound({ name: c.name, smiles: c.smiles, cas: c.cas, formula: c.formula, mw: c.mw });
                setQuery(c.name);
              }}
            >
              <option value="">{A.fromReaction}</option>
              {rxn.components.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              className="grow"
              value={query}
              placeholder={A.compoundPh}
              aria-label={A.compound}
              onChange={(e) => {
                setQuery(e.target.value);
                setFound(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
            />
            <button className="small ghost" onClick={lookup} disabled={busy || !query.trim()}>{busy ? t.searching : A.lookup}</button>
            <button className="small" onClick={add} disabled={!abbr.trim() || !query.trim()}>{t.add}</button>
            {found && (
              <span className="muted small abbr-found">
                {[found.name, found.formula, found.cas && `CAS ${found.cas}`].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        )}

        <div className="inv-body">
          {list && !list.length ? (
            <p className="muted center">{A.empty}</p>
          ) : (
            <table className="inv-table abbr-table">
              <thead>
                <tr>
                  <th />
                  <th>{A.field}</th>
                  <th>{A.compound}</th>
                  <th>{t.formula} / CAS</th>
                  <th>{A.note}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <Row key={e.id} e={e} rd={rd} onRename={(a) => rename(e, a)} onUpdate={(p) => update(e, p)} onRemove={async () => {
                    if (!confirm(A.confirmRemove.replace('{a}', e.abbr))) return;
                    await removeAbbr(e.id).catch(() => onNotify(t.saveFailed));
                  }} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ e, rd, onRename, onUpdate, onRemove }: {
  e: AbbrEntry;
  rd: MainModule | null;
  onRename: (a: string) => void;
  onUpdate: (p: Partial<AbbrEntry>) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const svg = useMemo(() => (rd && e.smiles ? smilesToSvg(rd, e.smiles, 120, 80) : null), [rd, e.smiles]);
  // Inputs are keyed by the stored value so a rejected rename snaps back.
  const commit = (v: string, prev: string | undefined, save: (v: string) => void) => v.trim() !== (prev ?? '') && save(v.trim());
  return (
    <tr>
      <td className="abbr-thumb">
        {svg && <img alt="" src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />}
      </td>
      <td>
        <input key={e.abbr} className="abbr-input" defaultValue={e.abbr} aria-label={t.abbr.field}
          onBlur={(ev) => commit(ev.target.value, e.abbr, onRename)}
          onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} />
      </td>
      <td>
        <input key={e.name} defaultValue={e.name} aria-label={t.abbr.compound}
          onBlur={(ev) => commit(ev.target.value, e.name, (name) => name && onUpdate({ name }))} />
      </td>
      <td className="inv-sub">
        {e.formula}
        {e.cas && <div>CAS {e.cas}</div>}
      </td>
      <td>
        <input key={e.note ?? ''} defaultValue={e.note ?? ''} aria-label={t.abbr.note}
          onBlur={(ev) => commit(ev.target.value, e.note, (note) => onUpdate({ note: note || undefined }))} />
      </td>
      <td className="inv-actions">
        <button className="small ghost" onClick={onRemove}>{t.abbr.remove}</button>
      </td>
    </tr>
  );
}
