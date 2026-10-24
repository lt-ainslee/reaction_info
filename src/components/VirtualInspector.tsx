// Inspector for the compound and reagent-lot nodes of the attachment graph.
import { lotLabel, VERIFICATIONS, type LotSnapshot, type ReagentLot, type Verification } from '../chem/lots';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';

interface CompoundProps {
  c: Component;
  files: number;
  onUpload: (folder: boolean) => void;
  onReagentInfo: () => void;
}

export function CompoundInspector({ c, files, onUpload, onReagentInfo }: CompoundProps) {
  const { t } = useI18n();
  const product = c.role === 'product';
  return (
    <div className="inspector">
      <div className={'insp-type t-c-' + c.role}>{t.roles[c.role]}</div>
      <div className="insp-name">{c.name}</div>
      <div className="insp-meta">{[c.formula, c.cas && `CAS ${c.cas}`].filter(Boolean).join(' · ')}</div>
      {!product && c.lot && <div className="insp-meta">{lotLabel(c.lot, t.lots.made)}</div>}
      <p className="hint">{product ? t.att.hint : t.att.compoundHint}</p>
      <div className="insp-actions">
        <button className="ghost small" onClick={() => onUpload(false)}>+ {t.att.uploadHere}</button>
        <button className="ghost small" onClick={() => onUpload(true)}>+ {t.att.uploadFolder}</button>
        {!product && <button className="ghost small" onClick={onReagentInfo}>{t.att.reagentInfo}</button>}
        {files > 0 && <span className="muted small">{t.lots.files.replace('{n}', String(files))}</span>}
      </div>
    </div>
  );
}

interface LotProps {
  snapshot: LotSnapshot;
  lot?: ReagentLot;
  compoundName: string;
  files: number;
  onUpload: (folder: boolean) => void;
  onVerification: (v: Verification | undefined, note: string | undefined) => void;
  onReagentInfo: () => void;
  onOpenSource?: () => void;
}

export function LotInspector({ snapshot, lot, compoundName, files, onUpload, onVerification, onReagentInfo, onOpenSource }: LotProps) {
  const { t } = useI18n();
  const L = t.lots;
  const info = { ...snapshot, ...(lot ?? {}) };
  const ver = info.verification ?? 'unverified';
  return (
    <div className="inspector">
      <div className="insp-type t-lot">{t.att.lotNode}</div>
      <div className="insp-name">{lotLabel(info, L.made) || L.unnamed}</div>
      <div className="insp-meta">
        {[compoundName, info.spec, info.purity && `${info.purity}%`, info.molarity && `${info.molarity} M`, info.receivedAt].filter(Boolean).join(' · ')}
      </div>
      <label className="field">
        <span>{L.verification}</span>
        <select
          className={'v-' + ver}
          value={ver}
          disabled={!lot}
          onChange={(e) => onVerification(e.target.value === 'unverified' ? undefined : (e.target.value as Verification), info.verificationNote)}
        >
          {VERIFICATIONS.map((v) => (
            <option key={v} value={v}>{L.verifications[v]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{L.verificationNote}</span>
        <input
          key={lot?.updatedAt ?? 0}
          defaultValue={info.verificationNote ?? ''}
          placeholder={L.verificationNotePh}
          disabled={!lot}
          onBlur={(e) => e.target.value !== (info.verificationNote ?? '') && onVerification(info.verification, e.target.value || undefined)}
        />
      </label>
      <p className="hint">{lot ? t.att.lotHint : L.noLotForUpload}</p>
      <div className="insp-actions">
        <button className="ghost small" disabled={!lot} onClick={() => onUpload(false)}>+ {t.att.uploadToLot}</button>
        <button className="ghost small" disabled={!lot} onClick={() => onUpload(true)}>+ {t.att.uploadFolder}</button>
        <button className="ghost small" onClick={onReagentInfo}>{t.att.reagentInfo}</button>
        {onOpenSource && <button className="ghost small" onClick={onOpenSource}>{t.att.openSource}</button>}
        {files > 0 && <span className="muted small">{L.files.replace('{n}', String(files))}</span>}
      </div>
    </div>
  );
}
