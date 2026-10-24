// Literature of the route: paste a DOI / link / citation; DOIs are completed
// from Crossref. Each entry notes how it relates to this reaction.
import { useState, type Dispatch, type SetStateAction } from 'react';
import { doiUrl, extractDoi, formatReference, lookupDoi, type Reference } from '../chem/refs';
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';
import { newId } from '../storage';

interface Props {
  rxn: Reaction;
  setRxn: Dispatch<SetStateAction<Reaction>>;
}

export function References({ rxn, setRxn }: Props) {
  const { t } = useI18n();
  const R = t.refs;
  const refs = rxn.references ?? [];
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const update = (f: (list: Reference[]) => Reference[]) =>
    setRxn((r) => {
      const next = f(r.references ?? []);
      return { ...r, references: next.length ? next : undefined };
    });
  const patch = (id: string, p: Partial<Reference>) => update((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const fill = async (id: string, doi: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const data = await lookupDoi(doi);
      patch(id, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    } catch {
      setMsg(R.notFound);
      setEditing(id);
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    const text = input.trim();
    if (!text) return;
    const doi = extractDoi(text);
    const url = !doi && /^https?:\/\/\S+$/i.test(text) ? text : undefined;
    const ref: Reference = { id: newId(), ...(doi ? { doi } : url ? { url } : { citation: text }) };
    update((list) => [...list, ref]);
    setInput('');
    if (doi) fill(ref.id, doi);
    else setEditing(ref.id);
  };

  const field = (r: Reference, k: 'title' | 'authors' | 'journal' | 'volume' | 'issue' | 'pages' | 'url' | 'citation' | 'doi', label: string, wide = false) => (
    <label className={'field' + (wide ? ' ref-wide' : '')}>
      <span>{label}</span>
      <input value={r[k] ?? ''} onChange={(e) => patch(r.id, { [k]: e.target.value || undefined })} />
    </label>
  );

  return (
    <section className="card refs-card">
      <div className="card-head">
        <h2>{R.title}</h2>
      </div>
      {refs.length === 0 && <p className="hint">{R.empty}</p>}
      <ol className="ref-list">
        {refs.map((r, i) => {
          const text = formatReference(r);
          const link = r.doi ? doiUrl(r.doi) : r.url;
          return (
            <li key={r.id} className="ref-item">
              <span className="ref-n">[{i + 1}]</span>
              <div className="ref-body">
                <div className="ref-text">
                  {text || <span className="muted">—</span>}
                  {busy === r.id && <span className="muted small"> · {R.looking}</span>}
                </div>
                <div className="ref-meta small">
                  {r.doi && (
                    <a href={doiUrl(r.doi)} target="_blank" rel="noreferrer">
                      doi:{r.doi}
                    </a>
                  )}
                  {!r.doi && link && (
                    <a href={link} target="_blank" rel="noreferrer">{R.open}</a>
                  )}
                </div>
                <input
                  className="ref-note"
                  value={r.note ?? ''}
                  placeholder={R.notePh}
                  aria-label={R.note}
                  onChange={(e) => patch(r.id, { note: e.target.value || undefined })}
                />
                {editing === r.id && (
                  <div className="ref-edit">
                    {field(r, 'title', R.titleF, true)}
                    {field(r, 'authors', R.authors, true)}
                    {field(r, 'journal', R.journal)}
                    <label className="field">
                      <span>{R.year}</span>
                      <input
                        type="number"
                        value={r.year ?? ''}
                        onChange={(e) => patch(r.id, { year: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </label>
                    {field(r, 'volume', R.volume)}
                    {field(r, 'issue', R.issue)}
                    {field(r, 'pages', R.pages)}
                    {field(r, 'doi', 'DOI')}
                    {field(r, 'url', R.url, true)}
                    {field(r, 'citation', R.citation, true)}
                  </div>
                )}
              </div>
              <div className="ref-actions no-print">
                {r.doi && !r.title && busy !== r.id && (
                  <button className="ghost small" onClick={() => fill(r.id, r.doi!)}>{R.lookup}</button>
                )}
                <button className="ghost small" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  {editing === r.id ? R.done : R.edit}
                </button>
                <button className="icon" aria-label={t.delete} title={t.delete} onClick={() => update((list) => list.filter((x) => x.id !== r.id))}>
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {msg && <p className="warn small">{msg}</p>}
      <div className="ref-add no-print">
        <input
          value={input}
          placeholder={R.inputPh}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!input.trim()}>{R.add}</button>
      </div>
    </section>
  );
}
