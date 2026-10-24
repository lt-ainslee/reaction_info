// "Reagent used in this run": supplier / grade / catalog / lot number, measured
// purity or titrated concentration (fed into the calculation), identity check,
// and the reusable lot library (pick a previous bottle, or save this one).
import { useEffect, useState } from 'react';
import {
  applyLot, compoundKey, lotFromComponent, lotInfo, lotLabel, VERIFICATIONS, type LotSnapshot, type ReagentLot, type Verification,
} from '../chem/lots';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';
import { newId, repo, type SavedSummary } from '../storage';
import { lotRepo } from '../storage/lots';

interface Props {
  c: Component;
  onUpdate: (p: Partial<Component>) => void;
  onNotify: (msg: string) => void;
  /** The reaction being edited (excluded from "made in"). */
  currentReactionId?: string;
  /** Show this lot's spectra in the node graph. */
  onShowSpectra?: (lotId: string) => void;
}

export function LotEditor({ c, onUpdate, onNotify, currentReactionId, onShowSpectra }: Props) {
  const { t } = useI18n();
  const L = t.lots;
  const lot: LotSnapshot = c.lot ?? {};
  const [library, setLibrary] = useState<ReagentLot[] | null>(null);
  const [reactions, setReactions] = useState<SavedSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const key = compoundKey(c);

  useEffect(() => {
    let cancelled = false;
    lotRepo.list(key).then(
      (l) => !cancelled && setLibrary(l),
      () => !cancelled && setLibrary([]),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (lot.source !== 'made' || reactions) return;
    repo.list().then(setReactions, () => setReactions([]));
  }, [lot.source, reactions]);

  const set = (p: Partial<LotSnapshot>, extra: Partial<Component> = {}) => {
    const next = { ...lot, ...p };
    onUpdate({ lot: Object.keys(lotInfo(next)).length || next.lotId ? next : undefined, ...extra });
  };
  const linked = library?.find((l) => l.id === lot.lotId);

  const use = (l: ReagentLot) => {
    onUpdate(applyLot(c, l, l.id));
    onNotify(L.used.replace('{lot}', lotLabel(l, L.made) || l.name));
  };

  /** Save the current snapshot to the library (new lot, or update the linked one). */
  const store = async () => {
    setBusy(true);
    try {
      const base = lotFromComponent(c, lot.lotId ?? newId());
      const saved = await lotRepo.save(linked ? { ...base, createdAt: linked.createdAt } : base);
      onUpdate({ lot: { ...lotInfo(saved), lotId: saved.id } });
      setLibrary((ls) => [saved, ...(ls ?? []).filter((l) => l.id !== saved.id)]);
      onNotify(linked ? L.updatedLib : L.savedLib);
    } catch {
      onNotify(t.saveFailed);
    } finally {
      setBusy(false);
    }
  };

  const changedFromLib =
    !!linked && JSON.stringify(lotInfo(linked)) !== JSON.stringify(lotInfo(lot));
  const text = (k: 'supplier' | 'spec' | 'catalogNumber' | 'lotNumber' | 'note' | 'verificationNote', label: string, ph = '') => (
    <label className="field">
      <span>{label}</span>
      <input value={lot[k] ?? ''} placeholder={ph} onChange={(e) => set({ [k]: e.target.value || undefined })} />
    </label>
  );

  return (
    <section className="lot-editor">
      <h4>
        {L.title}
        {lot.verification && <span className={'lot-ver v-' + lot.verification}>{L.verifications[lot.verification]}</span>}
      </h4>

      <div className="seg lot-source" role="group">
        <button className={lot.source !== 'made' ? 'on' : ''} onClick={() => set({ source: undefined, sourceReactionId: undefined, sourceLabel: undefined })}>
          {L.commercial}
        </button>
        <button className={lot.source === 'made' ? 'on' : ''} onClick={() => set({ source: 'made' })}>{L.made}</button>
      </div>

      {library && library.length > 0 && (
        <div className="lot-library">
          <span className="lot-lib-title">{L.fromLibrary}</span>
          {library.map((l) => (
            <div key={l.id} className={'lot-lib-item' + (l.id === lot.lotId ? ' on' : '')}>
              <div>
                <strong>{lotLabel(l, L.made) || L.unnamed}</strong>
                <small>
                  {[l.spec, l.purity && `${l.purity}%`, l.molarity && `${l.molarity} M`, l.receivedAt].filter(Boolean).join(' · ')}
                  {l.verification && l.verification !== 'unverified' && <span className={'lot-ver v-' + l.verification}>{L.verifications[l.verification]}</span>}
                  {!!l.attachments && <span className="lot-files">{L.files.replace('{n}', String(l.attachments))}</span>}
                </small>
              </div>
              {l.id === lot.lotId ? (
                <span className="muted small">{L.inUse}</span>
              ) : (
                <button className="ghost small" onClick={() => use(l)}>{L.use}</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="lot-grid">
        {lot.source === 'made' ? (
          <>
            <label className="field lot-wide">
              <span>{L.madeIn}</span>
              <select
                value={lot.sourceReactionId ?? ''}
                onChange={(e) => {
                  const r = reactions?.find((x) => x.id === e.target.value);
                  set({ sourceReactionId: r?.id, sourceLabel: r ? [r.meta?.code, r.title].filter(Boolean).join(' ') : undefined });
                }}
              >
                <option value="">{reactions ? L.pickReaction : t.loading}</option>
                {reactions
                  ?.filter((r) => r.id !== currentReactionId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>{[r.meta?.code, r.title || '—'].filter(Boolean).join(' · ')}</option>
                  ))}
              </select>
            </label>
            {text('lotNumber', L.batch, L.batchPh)}
          </>
        ) : (
          <>
            {text('supplier', L.supplier, 'Adamas / Sigma / TCI…')}
            {text('spec', L.spec, L.specPh)}
            {text('catalogNumber', L.catalog)}
            {text('lotNumber', L.lot)}
          </>
        )}
        <label className="field">
          <span>{L.purity}</span>
          <input
            type="number"
            min={0}
            max={100}
            step="any"
            value={lot.purity ?? ''}
            placeholder={L.purityPh}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              set({ purity: v }, v && v > 0 && c.form === 'neat' ? { purity: Math.min(v, 100) } : {});
            }}
          />
        </label>
        {c.form === 'solutionM' && (
          <label className="field">
            <span>{L.molarity}</span>
            <input
              type="number"
              min={0}
              step="any"
              value={lot.molarity ?? ''}
              placeholder={L.molarityPh}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                set({ molarity: v }, v && v > 0 ? { molarity: v } : {});
              }}
            />
          </label>
        )}
        <label className="field">
          <span>{L.received}</span>
          <input type="date" value={lot.receivedAt ?? ''} onChange={(e) => set({ receivedAt: e.target.value || undefined })} />
        </label>
        <label className="field">
          <span>{L.verification}</span>
          <select
            className={'v-' + (lot.verification ?? 'unverified')}
            value={lot.verification ?? 'unverified'}
            onChange={(e) => set({ verification: e.target.value === 'unverified' ? undefined : (e.target.value as Verification) })}
          >
            {VERIFICATIONS.map((v) => (
              <option key={v} value={v}>{L.verifications[v]}</option>
            ))}
          </select>
        </label>
        <div className="lot-wide">{text('verificationNote', L.verificationNote, L.verificationNotePh)}</div>
        <div className="lot-wide">{text('note', t.att.noteLabel)}</div>
        <label className="field lot-wide">
          <span>{L.actualNote}</span>
          <input value={c.actualNote ?? ''} placeholder={L.actualNotePh} onChange={(e) => onUpdate({ actualNote: e.target.value || undefined })} />
        </label>
      </div>
      {(lot.purity || lot.molarity) && <p className="hint">{L.feedsCalc}</p>}

      <div className="row lot-actions">
        <button className="small" disabled={busy || (!!linked && !changedFromLib)} onClick={store}>
          {linked ? (changedFromLib ? L.updateLib : L.inLib) : L.saveLib}
        </button>
        {lot.lotId && onShowSpectra && (
          <button className="ghost small" onClick={() => onShowSpectra(lot.lotId!)}>
            {L.spectra}
            {linked?.attachments ? ` (${linked.attachments})` : ''}
          </button>
        )}
        {(lot.lotId || Object.keys(lotInfo(lot)).length > 0) && (
          <button className="ghost small" onClick={() => onUpdate({ lot: undefined })}>{L.clear}</button>
        )}
      </div>
      {!lot.lotId && <p className="hint">{L.libHint}</p>}
    </section>
  );
}
