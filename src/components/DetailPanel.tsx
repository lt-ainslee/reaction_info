import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useState } from 'react';
import { getDetailsCached, pubchemUrl, searchByName, searchBySmiles, type PubChemDetails } from '../chem/pubchem';
import { formulaMass } from '../chem/formula';
import { parseInputText } from '../chem/parseInput';
import { isValidSmiles, smilesInfo, smilesToSvg } from '../chem/rdkit';
import type { Component } from '../chem/stoich';
import type { OpenEditor } from '../App';
import { useI18n } from '../i18n';
import { fmt } from '../units';

const GHS: Record<string, [string, string]> = {
  Explosive: ['GHS01', '爆炸物'],
  Flammable: ['GHS02', '易燃'],
  Oxidizer: ['GHS03', '氧化性'],
  'Compressed Gas': ['GHS04', '压缩气体'],
  Corrosive: ['GHS05', '腐蚀性'],
  'Acute Toxic': ['GHS06', '急性毒性'],
  Irritant: ['GHS07', '刺激性/有害'],
  'Health Hazard': ['GHS08', '健康危害'],
  'Environmental Hazard': ['GHS09', '环境危害'],
};

interface Props {
  c: Component;
  rd: MainModule | null;
  openEditor: OpenEditor;
  onUpdate: (p: Partial<Component>) => void;
  onClose: () => void;
}

export function DetailPanel({ c, rd, openEditor, onUpdate, onClose }: Props) {
  const { t, lang } = useI18n();
  const [details, setDetails] = useState<PubChemDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [structure, setStructure] = useState(c.smiles ?? '');
  const [structMsg, setStructMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** Accept a SMILES, or a pasted ChemDraw molfile / CDXML (first structure). */
  const applyStructure = (input = structure) => {
    if (!rd) return;
    const raw = input.trim();
    let smiles: string | undefined;
    if (raw && isValidSmiles(rd, raw) && !/\s/.test(raw)) smiles = raw;
    else {
      const p = parseInputText(rd, raw);
      const all = p ? [...p.molecules, ...p.reactants, ...p.products, ...p.agents] : [];
      smiles = all.find((x) => x.smiles)?.smiles;
    }
    const info = smiles ? smilesInfo(rd, smiles) : null;
    if (!smiles || !info) {
      setStructMsg({ ok: false, text: t.structureInvalid });
      return;
    }
    setStructure(smiles);
    // A new structure invalidates the PubChem record of the old one.
    // Re-run the phase/density lookup unless the user entered the density.
    const keepDensity = c.densitySource === 'manual';
    onUpdate({
      smiles,
      formula: info.formula,
      mw: info.mw,
      cid: undefined,
      lookup: undefined,
      phase: undefined,
      ...(keepDensity ? {} : { density: undefined, densitySource: undefined }),
    });
    setStructMsg({ ok: true, text: t.structureUpdated });
  };

  useEffect(() => {
    setDetails(null);
    setError(false);
    if (!c.cid) return;
    let cancelled = false;
    setLoading(true);
    getDetailsCached(c.cid)
      .then((d) => {
        if (cancelled) return;
        setDetails(d);
        if (!c.cas && d.cas) onUpdate({ cas: d.cas });
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.cid]);

  const lookup = async () => {
    setLoading(true);
    setError(false);
    try {
      const hits = c.smiles ? await searchBySmiles(c.smiles) : await searchByName(c.cas ?? c.name);
      if (hits[0]) onUpdate({ cid: hits[0].cid, formula: c.formula ?? hits[0].formula, mw: c.mw ?? hits[0].mw, smiles: c.smiles ?? hits[0].smiles });
      else setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    }
  };

  const svg = rd && c.smiles ? smilesToSvg(rd, c.smiles, 260, 190) : null;
  const list = (items: string[] | undefined) =>
    items?.length ? <ul>{items.map((s) => <li key={s}>{s}</li>)}</ul> : <span className="muted">{t.noData}</span>;

  return (
    <aside className="panel" role="dialog" aria-label={t.details}>
      <header>
        <h3>{t.details}</h3>
        <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      <label className="field">
        <span>{t.rename}</span>
        <input value={c.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </label>
      {svg && <img className="panel-mol" alt={c.name} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />}
      <label className="field">
        <span>{t.structure}</span>
        <textarea
          className="mono"
          rows={2}
          value={structure}
          placeholder={t.structurePh}
          spellCheck={false}
          onChange={(e) => {
            setStructure(e.target.value);
            setStructMsg(null);
          }}
        />
      </label>
      <div className="row">
        <button className="small" onClick={() => applyStructure()} disabled={!rd || !structure.trim() || structure.trim() === c.smiles}>
          {t.updateStructure}
        </button>
        <button
          className="small ghost"
          onClick={() => openEditor({ mode: 'molecule', initial: c.smiles, onApply: ({ text }) => applyStructure(text) })}
        >
          ✏️ {t.draw}
        </button>
        {structMsg && <span className={structMsg.ok ? 'ok small' : 'warn small'}>{structMsg.text}</span>}
      </div>
      <dl>
        <dt>{t.formula}</dt>
        <dd>
          <input
            key={c.formula ?? ''}
            defaultValue={c.formula ?? ''}
            onBlur={(e) => {
              const formula = e.target.value.trim();
              if (formula === (c.formula ?? '')) return;
              const mw = formulaMass(formula);
              onUpdate(mw ? { formula, mw } : { formula: formula || undefined });
            }}
          />
        </dd>
        <dt>{t.col.mw}</dt>
        <dd>{fmt(c.mw, 6) || '—'}</dd>
        <dt>CAS</dt>
        <dd>
          <input
            key={c.cas ?? details?.cas ?? ''}
            defaultValue={c.cas ?? details?.cas ?? ''}
            onBlur={(e) => e.target.value.trim() !== (c.cas ?? '') && onUpdate({ cas: e.target.value.trim() || undefined })}
          />
        </dd>
        {c.cid && (
          <>
            <dt>PubChem</dt>
            <dd>
              <a href={pubchemUrl(c.cid)} target="_blank" rel="noreferrer">CID {c.cid}</a>
            </dd>
          </>
        )}
      </dl>

      {!c.cid && !loading && (
        <button onClick={lookup}>{t.fetchFromPubchem}</button>
      )}
      {loading && <p className="muted">{t.loadingDetails}</p>}
      {error && <p className="warn">{t.networkError}</p>}

      {details && (
        <>
          <dl>
            <dt>{t.col.density}</dt>
            <dd>
              {details.densityText ?? <span className="muted">{t.noData}</span>}
              {details.density && details.density !== c.density && (
                <button className="small" onClick={() => onUpdate({ density: details.density, densitySource: 'pubchem' })}>
                  {t.useDensity} ({details.density})
                </button>
              )}
            </dd>
            <dt>{t.meltingPoint}</dt>
            <dd>{list(details.meltingPoint)}</dd>
            <dt>{t.boilingPoint}</dt>
            <dd>{list(details.boilingPoint)}</dd>
            <dt>{t.flashPoint}</dt>
            <dd>{list(details.flashPoint)}</dd>
            <dt>{t.solubility}</dt>
            <dd>{list(details.solubility)}</dd>
          </dl>
          <h4>{t.ghs}</h4>
          {details.ghsPictograms.length > 0 && (
            <div className="ghs">
              {details.ghsPictograms.map((p) => {
                const [code, zhName] = GHS[p] ?? ['', p];
                return (
                  <figure key={p}>
                    {code && <img src={`https://pubchem.ncbi.nlm.nih.gov/images/ghs/${code}.svg`} alt={p} width={48} height={48} />}
                    <figcaption>{lang === 'zh' ? zhName : p}</figcaption>
                  </figure>
                );
              })}
            </div>
          )}
          {list(details.hazards)}
          <p className="hint">{t.dataSource}</p>
        </>
      )}
    </aside>
  );
}
