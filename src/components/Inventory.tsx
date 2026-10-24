// The lab's reagent inventory: every bottle on the shelf (structure and
// physical data for the calculator, supplier / catalog / lot, location,
// pack and remaining amount, status, identity check). Bottles can be added
// to the current reaction from here or from the compound search.
import type { MainModule } from '@rdkit/rdkit';
import { useMemo, useRef, useState } from 'react';
import { saveBlob } from '../attachments/pack';
import {
  available, compoundKey, lotSearchText, STOCK_STATUSES, VERIFICATIONS, type ReagentLot, type StockStatus, type Verification,
} from '../chem/lots';
import { resolveOne } from '../chem/resolve';
import type { Form, Phase, Role } from '../chem/stoich';
import { useI18n } from '../i18n';
import { parseCsv, parseXlsx, rowsToLots, type Field } from '../inventory/importTable';
import { buildXlsx } from '../office/xlsx';
import { newId } from '../storage';
import { removeFromInventory, saveToInventory, useInventory } from '../storage/inventory';
import { fmt } from '../units';

interface Props {
  rd: MainModule | null;
  onClose: () => void;
  onAdd: (lot: ReagentLot, role: Role) => void;
  onNotify: (msg: string) => void;
}

type Filter = 'available' | 'all' | 'unavailable';
const ROLES: Role[] = ['reactant', 'reagent', 'catalyst', 'solvent'];

const blank = (): ReagentLot => ({ id: newId(), key: '', name: '', status: 'in_stock', createdAt: Date.now(), updatedAt: Date.now(), compound: { form: 'neat' } });

export function Inventory({ rd, onClose, onAdd, onNotify }: Props) {
  const { t } = useI18n();
  const I = t.inv;
  const lots = useInventory();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('available');
  const [loc, setLoc] = useState('');
  const [editing, setEditing] = useState<ReagentLot | null>(null);
  const [importing, setImporting] = useState(false);

  const locations = useMemo(() => [...new Set((lots ?? []).map((l) => l.location).filter((x): x is string => !!x))].sort(), [lots]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (lots ?? [])
      .filter((l) => (filter === 'all' ? true : filter === 'available' ? available(l) : !available(l)))
      .filter((l) => !loc || l.location === loc)
      .filter((l) => words.every((w) => lotSearchText(l).includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh') || b.updatedAt - a.updatedAt);
  }, [lots, q, filter, loc]);
  const inStock = (lots ?? []).filter(available).length;

  const setStatus = (l: ReagentLot, status: StockStatus) => saveToInventory({ ...l, status }).catch(() => onNotify(t.saveFailed));

  const exportXlsx = () => {
    const rows = [
      [I.name, 'CAS', I.formula, I.mw, t.lots.supplier, t.lots.spec, t.lots.catalog, t.lots.lot, I.quantity, I.remaining, I.location, I.status,
        t.lots.received, I.expires, t.lots.purity, t.lots.molarity, I.owner, t.lots.verification, t.att.noteLabel],
      ...(lots ?? []).map((l) => [
        l.name, l.cas, l.compound?.formula, l.compound?.mw, l.supplier, l.spec, l.catalogNumber, l.lotNumber, l.quantity, l.remaining, l.location,
        I.statuses[l.status ?? 'in_stock'], l.receivedAt, l.expiresAt, l.purity, l.molarity ?? l.compound?.molarity, l.owner,
        t.lots.verifications[l.verification ?? 'unverified'], l.note,
      ]),
    ];
    saveBlob(buildXlsx([{ name: I.title, rows, widths: [24, 12, 12, 9, 12, 16, 12, 12, 10, 10, 16, 9, 11, 11, 8, 8, 9, 9, 24] }]), `${I.title}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="modal-backdrop inv-backdrop" role="dialog" aria-modal="true" aria-label={I.title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal inv-modal">
        <header className="inv-head">
          <h3>{I.title}</h3>
          <span className="muted small">{I.count.replace('{n}', String(lots?.length ?? 0)).replace('{m}', String(inStock))}</span>
          <span className="grow" />
          <button className="ghost small" onClick={() => setImporting(true)}>{I.import}</button>
          <button className="ghost small" disabled={!lots?.length} onClick={exportXlsx}>{I.export}</button>
          <button className="small" onClick={() => setEditing(blank())}>{I.add}</button>
          <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
        </header>

        <div className="inv-filters">
          <input className="grow" value={q} placeholder={I.searchPh} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="seg" role="group">
            {(['available', 'all', 'unavailable'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{I[f]}</button>
            ))}
          </div>
          {locations.length > 0 && (
            <select value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={I.location}>
              <option value="">{I.allLocations}</option>
              {locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
        </div>

        <div className="inv-body">
          {lots === null && <p className="muted">{t.loading}</p>}
          {lots?.length === 0 && <p className="att-empty">{I.empty}</p>}
          {!!lots?.length && !shown.length && <p className="muted">{I.noMatch}</p>}
          {shown.length > 0 && (
            <table className="inv-table">
              <thead>
                <tr>
                  <th>{I.name}</th>
                  <th>{t.lots.spec}</th>
                  <th>{t.lots.supplier} · {t.lots.catalog} · {t.lots.lot}</th>
                  <th>{I.location}</th>
                  <th>{I.remaining}</th>
                  <th>{I.status}</th>
                  <th>{t.lots.verification}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const ver = l.verification ?? 'unverified';
                  return (
                    <tr key={l.id} className={available(l) ? '' : 'inv-gone'}>
                      <td>
                        <button className="link inv-name" onClick={() => setEditing(l)}>{l.name}</button>
                        <div className="inv-sub">
                          {[l.cas && `CAS ${l.cas}`, l.compound?.formula, l.compound?.mw && `MW ${fmt(l.compound.mw, 5)}`].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="inv-sub">
                        {[l.spec, l.purity && `${l.purity}%`, (l.molarity ?? l.compound?.molarity) && `${l.molarity ?? l.compound?.molarity} M`].filter(Boolean).join(' · ')}
                      </td>
                      <td className="inv-sub">
                        {l.source === 'made' ? `${t.lots.made}${l.sourceLabel ? ` · ${l.sourceLabel}` : ''}` : [l.supplier, l.catalogNumber, l.lotNumber].filter(Boolean).join(' · ')}
                      </td>
                      <td className="inv-sub">{l.location}</td>
                      <td className="inv-sub">{[l.remaining, l.quantity && `/ ${l.quantity}`].filter(Boolean).join(' ')}</td>
                      <td>
                        <select className={'stock-select s-' + (l.status ?? 'in_stock')} value={l.status ?? 'in_stock'} onChange={(e) => setStatus(l, e.target.value as StockStatus)}>
                          {STOCK_STATUSES.map((s) => (
                            <option key={s} value={s}>{I.statuses[s]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={'lot-ver v-' + ver}>{t.lots.verifications[ver]}</span>
                        {!!l.attachments && <span className="lot-files"> · {l.attachments} {I.files}</span>}
                      </td>
                      <td className="inv-actions">
                        {available(l) && (
                          <select
                            className="inv-add"
                            value=""
                            title={I.addTo}
                            onChange={(e) => {
                              if (!e.target.value) return;
                              onAdd(l, e.target.value as Role);
                              onNotify(I.added.replace('{name}', l.name));
                            }}
                          >
                            <option value="">{I.addTo} ▾</option>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{I.addToAs.replace('{role}', t.roles[r])}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {editing && <LotForm key={editing.id} initial={editing} rd={rd} onClose={() => setEditing(null)} onNotify={onNotify} />}
        {importing && <ImportDialog rd={rd} onClose={() => setImporting(false)} onNotify={onNotify} />}
      </div>
    </div>
  );
}

function LotForm({ initial, rd, onClose, onNotify }: { initial: ReagentLot; rd: MainModule | null; onClose: () => void; onNotify: (m: string) => void }) {
  const { t, lang } = useI18n();
  const I = t.inv;
  const L = t.lots;
  const [l, setL] = useState<ReagentLot>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = !initial.name;
  const set = (p: Partial<ReagentLot>) => setL((x) => ({ ...x, ...p }));
  const setC = (p: Partial<NonNullable<ReagentLot['compound']>>) => setL((x) => ({ ...x, compound: { ...x.compound, ...p } }));
  const c = l.compound ?? {};
  const choice: Phase | 'solutionM' | 'solutionWt' = c.form && c.form !== 'neat' ? c.form : c.phase ?? 'solid';

  const lookup = async () => {
    const qy = l.cas || l.name || l.smiles;
    if (!qy) return;
    setMsg(I.lookingUp);
    try {
      const d = await resolveOne(qy, rd, lang);
      if (!d) return setMsg(I.lookupFailed);
      setL((x) => ({
        ...x,
        name: x.name || d.name,
        cas: x.cas || d.cas,
        smiles: d.smiles ?? x.smiles,
        compound: {
          ...x.compound,
          formula: d.formula ?? x.compound?.formula,
          mw: d.mw ?? x.compound?.mw,
          cid: d.cid ?? x.compound?.cid,
          density: x.compound?.density ?? d.density,
          phase: x.compound?.phase ?? d.phase,
          ...(d.form && d.form !== 'neat' && !x.compound?.form ? { form: d.form, molarity: d.molarity, wtPercent: d.wtPercent } : {}),
        },
      }));
      setMsg(null);
    } catch {
      setMsg(I.lookupFailed);
    }
  };

  const save = async () => {
    if (!l.name.trim()) return;
    setBusy(true);
    try {
      await saveToInventory({ ...l, name: l.name.trim(), key: compoundKey(l) });
      onClose();
    } catch {
      onNotify(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(I.confirmDelete.replace('{name}', l.name))) return;
    try {
      await removeFromInventory(l.id);
      onClose();
    } catch {
      onNotify(t.saveFailed);
    }
  };

  const text = (k: 'name' | 'cas' | 'smiles' | 'supplier' | 'spec' | 'catalogNumber' | 'lotNumber' | 'quantity' | 'remaining' | 'location' | 'owner' | 'note' | 'verificationNote', label: string, ph = '', wide = false) => (
    <label className={'field' + (wide ? ' inv-wide' : '')}>
      <span>{label}</span>
      <input value={(l[k] as string | undefined) ?? ''} placeholder={ph} onChange={(e) => set({ [k]: e.target.value || undefined })} />
    </label>
  );
  const numIn = (label: string, value: number | undefined, onChange: (v: number | undefined) => void, step = 'any') => (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} min={0} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  );

  return (
    <aside className="inv-form" aria-label={isNew ? I.add : I.edit}>
      <header>
        <h4>{isNew ? I.add.replace('+ ', '') : l.name}</h4>
        <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      <div className="inv-grid">
        {text('name', I.name, '', true)}
        {text('cas', 'CAS')}
        <div className="field inv-lookup">
          <span>&nbsp;</span>
          <button className="ghost small" disabled={!rd || !(l.cas || l.name || l.smiles)} onClick={lookup}>{I.lookup}</button>
        </div>
        {msg && <p className="hint inv-wide">{msg}</p>}
        {text('smiles', I.structure, '', true)}
        <label className="field">
          <span>{I.formula}</span>
          <input value={c.formula ?? ''} onChange={(e) => setC({ formula: e.target.value || undefined })} />
        </label>
        {numIn(I.mw, c.mw, (mw) => setC({ mw }))}
        <label className="field">
          <span>{I.form}</span>
          <select
            value={choice}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'solutionM' || v === 'solutionWt') setC({ form: v as Form });
              else setC({ form: 'neat', phase: v as Phase });
            }}
          >
            {(['solid', 'liquid', 'gas', 'solutionM', 'solutionWt'] as const).map((f) => (
              <option key={f} value={f}>{t.forms[f]}</option>
            ))}
          </select>
        </label>
        {choice === 'solutionM' && numIn(I.labelConc, c.molarity, (molarity) => setC({ molarity }))}
        {choice === 'solutionWt' && numIn(I.wtPercent, c.wtPercent, (wtPercent) => setC({ wtPercent }))}
        {(choice === 'liquid' || choice === 'solutionM' || choice === 'solutionWt') &&
          numIn(I.density, choice === 'liquid' ? c.density : c.solutionDensity, (v) => setC(choice === 'liquid' ? { density: v } : { solutionDensity: v }))}

        <div className="inv-sep inv-wide" />
        {text('supplier', L.supplier, 'Adamas / Sigma / TCI…')}
        {text('spec', L.spec, L.specPh)}
        {text('catalogNumber', L.catalog)}
        {text('lotNumber', L.lot)}
        {text('quantity', I.quantity, I.quantityPh)}
        {text('remaining', I.remaining, I.remainingPh)}
        {text('location', I.location, I.locationPh, true)}
        <label className="field">
          <span>{I.status}</span>
          <select value={l.status ?? 'in_stock'} onChange={(e) => set({ status: e.target.value as StockStatus })}>
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>{I.statuses[s]}</option>
            ))}
          </select>
        </label>
        {text('owner', I.owner)}
        <label className="field">
          <span>{L.received}</span>
          <input type="date" value={l.receivedAt ?? ''} onChange={(e) => set({ receivedAt: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>{I.expires}</span>
          <input type="date" value={l.expiresAt ?? ''} onChange={(e) => set({ expiresAt: e.target.value || undefined })} />
        </label>
        {numIn(L.purity, l.purity, (purity) => set({ purity }))}
        {choice === 'solutionM' && numIn(L.molarity, l.molarity, (molarity) => set({ molarity }))}
        <label className="field">
          <span>{L.verification}</span>
          <select className={'v-' + (l.verification ?? 'unverified')} value={l.verification ?? 'unverified'} onChange={(e) => set({ verification: e.target.value === 'unverified' ? undefined : (e.target.value as Verification) })}>
            {VERIFICATIONS.map((v) => (
              <option key={v} value={v}>{L.verifications[v]}</option>
            ))}
          </select>
        </label>
        {text('verificationNote', L.verificationNote, L.verificationNotePh, true)}
        {text('note', t.att.noteLabel, '', true)}
      </div>
      <footer className="row">
        {!isNew && <button className="ghost small danger" onClick={remove}>{I.delete}</button>}
        <span className="grow" />
        <button className="ghost" onClick={onClose}>{I.cancel}</button>
        <button onClick={save} disabled={busy || !l.name.trim()}>{I.save}</button>
      </footer>
    </aside>
  );
}

const FIELD_LABEL = (t: ReturnType<typeof useI18n>['t'], f: Field): string =>
  ({
    name: t.inv.name, cas: 'CAS', smiles: 'SMILES', formula: t.inv.formula, mw: t.inv.mw, supplier: t.lots.supplier, spec: t.lots.spec,
    catalogNumber: t.lots.catalog, lotNumber: t.lots.lot, quantity: t.inv.quantity, remaining: t.inv.remaining, location: t.inv.location,
    status: t.inv.status, receivedAt: t.lots.received, expiresAt: t.inv.expires, purity: t.lots.purity, molarity: t.inv.labelConc,
    density: t.inv.density, owner: t.inv.owner, note: t.att.noteLabel,
  })[f];

function ImportDialog({ rd, onClose, onNotify }: { rd: MainModule | null; onClose: () => void; onNotify: (m: string) => void }) {
  const { t, lang } = useI18n();
  const I = t.inv;
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ header: string[]; result: ReturnType<typeof rowsToLots> } | null>(null);
  const [error, setError] = useState(false);
  const [withLookup, setWithLookup] = useState(true);
  const [progress, setProgress] = useState<[number, number] | null>(null);

  const read = async (f: File) => {
    setError(false);
    try {
      const rows = /\.xlsx$/i.test(f.name) ? parseXlsx(new Uint8Array(await f.arrayBuffer())) : parseCsv(await f.text());
      if (rows.length < 2) throw new Error('empty');
      setParsed({ header: rows[0], result: rowsToLots(rows, newId) });
    } catch {
      setError(true);
      setParsed(null);
    }
  };

  const go = async () => {
    if (!parsed) return;
    const list = parsed.result.lots;
    let done = 0;
    setProgress([0, list.length]);
    for (const lot of list) {
      let l = lot;
      if (withLookup && !l.compound?.mw && (l.cas || l.name)) {
        try {
          const d = await resolveOne(l.cas || l.name, rd, lang);
          if (d)
            l = {
              ...l,
              smiles: l.smiles ?? d.smiles,
              cas: l.cas ?? d.cas,
              compound: { ...l.compound, formula: l.compound?.formula ?? d.formula, mw: d.mw, cid: d.cid, density: l.compound?.density ?? d.density, phase: d.phase },
            };
        } catch {
          /* keep what the sheet has */
        }
        l = { ...l, key: compoundKey(l) };
      }
      try {
        await saveToInventory(l);
      } catch {
        /* skip the row */
      }
      setProgress([++done, list.length]);
    }
    onNotify(I.imported.replace('{n}', String(done)));
    onClose();
  };

  return (
    <aside className="inv-form inv-import" aria-label={I.importTitle}>
      <header>
        <h4>{I.importTitle}</h4>
        <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      <p className="hint">{I.importHint}</p>
      <button onClick={() => fileRef.current?.click()}>{I.import}…</button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) read(f);
        }}
      />
      {error && <p className="warn small">{I.badFile}</p>}
      {parsed && (
        <>
          <h5>{I.importCols}</h5>
          <div className="inv-cols">
            {parsed.header.map((h, i) => {
              const f = parsed.result.fields[i];
              return (
                <span key={i} className={'inv-col' + (f ? '' : ' off')}>
                  {h || '—'} → {f ? FIELD_LABEL(t, f) : I.unmapped}
                </span>
              );
            })}
          </div>
          <table className="inv-table inv-preview">
            <tbody>
              {parsed.result.lots.slice(0, 5).map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="inv-sub">{l.cas}</td>
                  <td className="inv-sub">{[l.supplier, l.catalogNumber, l.lotNumber].filter(Boolean).join(' · ')}</td>
                  <td className="inv-sub">{l.location}</td>
                  <td className="inv-sub">{I.statuses[l.status ?? 'in_stock']}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">{I.importRows.replace('{n}', String(parsed.result.lots.length)).replace('{k}', String(parsed.result.skipped))}</p>
          <label className="check small">
            <input type="checkbox" checked={withLookup} onChange={(e) => setWithLookup(e.target.checked)} />
            {I.importLookup}
          </label>
          <footer className="row">
            {progress && <span className="muted small">{I.importing.replace('{a}', String(progress[0])).replace('{b}', String(progress[1]))}</span>}
            <span className="grow" />
            <button className="ghost" onClick={onClose}>{I.cancel}</button>
            <button onClick={go} disabled={!!progress || !parsed.result.lots.length}>{I.importGo}</button>
          </footer>
        </>
      )}
    </aside>
  );
}
