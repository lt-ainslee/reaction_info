// Physical / safety data of a compound: the online (PubChem) record or the
// custom data entered for a bottle in the inventory, and a switch between them.
import { Fragment, type ReactNode } from 'react';
import { GHS } from '../chem/ghs';
import { PHYS_TEXT_FIELDS, physProps, type PhysProps, type PropsSource } from '../chem/lots';
import type { PubChemDetails } from '../chem/pubchem';
import { useI18n } from '../i18n';

type Dict = ReturnType<typeof useI18n>['t'];
type TextField = (typeof PHYS_TEXT_FIELDS)[number];

const fieldLabel = (t: Dict, k: TextField): string =>
  ({
    appearance: t.phys.appearance,
    densityText: t.phys.density,
    meltingPoint: t.meltingPoint,
    boilingPoint: t.boilingPoint,
    flashPoint: t.flashPoint,
    solubility: t.solubility,
    storage: t.phys.storage,
  })[k];

/** Custom data pre-filled from an online record (to edit from there). */
export function propsFromDetails(d: PubChemDetails, keep: PhysProps = {}): PhysProps {
  const join = (xs: string[] | undefined) => xs?.slice(0, 2).join('; ') || undefined;
  return (
    physProps({
      ...keep,
      densityText: keep.densityText ?? d.densityText,
      meltingPoint: keep.meltingPoint ?? join(d.meltingPoint),
      boilingPoint: keep.boilingPoint ?? join(d.boilingPoint),
      flashPoint: keep.flashPoint ?? join(d.flashPoint),
      solubility: keep.solubility ?? join(d.solubility),
      ghsPictograms: keep.ghsPictograms ?? d.ghsPictograms,
      hazards: keep.hazards ?? d.hazards,
    }) ?? {}
  );
}

export function SourceToggle({ value, onChange, customLabel }: { value: PropsSource; onChange: (v: PropsSource) => void; customLabel?: string }) {
  const { t } = useI18n();
  return (
    <div className="seg phys-source" role="group" aria-label={t.phys.title} title={t.phys.sourceTip}>
      <button type="button" className={value === 'online' ? 'on' : ''} aria-pressed={value === 'online'} onClick={() => onChange('online')}>
        {t.phys.online}
      </button>
      <button type="button" className={value === 'custom' ? 'on' : ''} aria-pressed={value === 'custom'} onClick={() => onChange('custom')}>
        {customLabel ?? t.phys.custom}
      </button>
    </div>
  );
}

export function GhsIcons({ pictograms }: { pictograms: string[] }) {
  const { lang } = useI18n();
  if (!pictograms.length) return null;
  return (
    <div className="ghs">
      {pictograms.map((p) => {
        const [code, zhName] = GHS[p] ?? ['', p];
        return (
          <figure key={p}>
            {code && <img src={`https://pubchem.ncbi.nlm.nih.gov/images/ghs/${code}.svg`} alt={p} width={48} height={48} />}
            <figcaption>{lang === 'zh' ? zhName : p}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** Read-only view of custom data. */
export function PhysView({ props, footer }: { props: PhysProps; footer?: ReactNode }) {
  const { t } = useI18n();
  const rows = PHYS_TEXT_FIELDS.filter((k) => props[k]);
  return (
    <>
      {rows.length > 0 && (
        <dl>
          {rows.map((k) => (
            <Fragment key={k}>
              <dt>{fieldLabel(t, k)}</dt>
              <dd className="phys-text">{props[k]}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {(props.ghsPictograms?.length || props.hazards?.length) && (
        <>
          <h4>{t.ghs}</h4>
          <GhsIcons pictograms={props.ghsPictograms ?? []} />
          {props.hazards?.length ? (
            <ul>
              {props.hazards.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {footer}
    </>
  );
}

/** Editor for custom data (kept raw while typing; cleaned with physProps on save). */
export function PhysForm({ value, onChange }: { value: PhysProps; onChange: (p: PhysProps) => void }) {
  const { t, lang } = useI18n();
  const set = (p: Partial<PhysProps>) => onChange({ ...value, ...p });
  const ghs = value.ghsPictograms ?? [];
  return (
    <>
      {PHYS_TEXT_FIELDS.map((k) => (
        <label key={k} className={'field' + (k === 'solubility' || k === 'storage' || k === 'appearance' ? ' inv-wide' : '')}>
          <span>{fieldLabel(t, k)}</span>
          <input value={value[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} />
        </label>
      ))}
      <fieldset className="field inv-wide phys-ghs">
        <span>{t.ghs}</span>
        <div className="phys-ghs-list">
          {Object.entries(GHS).map(([key, [code, zh]]) => (
            <label key={key} className="check small" title={code}>
              <input
                type="checkbox"
                checked={ghs.includes(key)}
                onChange={(e) => set({ ghsPictograms: e.target.checked ? [...ghs, key] : ghs.filter((g) => g !== key) })}
              />
              {lang === 'zh' ? zh : key}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field inv-wide">
        <span>{t.phys.hazards}</span>
        <textarea
          rows={3}
          value={(value.hazards ?? []).join('\n')}
          placeholder={t.phys.hazardsPh}
          onChange={(e) => set({ hazards: e.target.value ? e.target.value.split('\n') : undefined })}
        />
      </label>
    </>
  );
}
