// Literature references of a reaction (route): DOI / URL / citation text,
// with Crossref look-up of DOI metadata.

export interface Reference {
  id: string;
  doi?: string;
  url?: string;
  /** Free citation text, used when there is no structured data. */
  citation?: string;
  title?: string;
  /** "Smith, J.; Wang, L." */
  authors?: string;
  journal?: string;
  year?: number;
  volume?: string;
  issue?: string;
  pages?: string;
  /** How it relates to this reaction / page or SI entry. */
  note?: string;
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)\]])/i;

/** A DOI from "10.1021/…", "doi:10.…" or a doi.org URL; undefined if none. */
export function extractDoi(text: string): string | undefined {
  const m = DOI_RE.exec(decodeURIComponentSafe(text.trim()));
  return m ? m[1] : undefined;
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const doiUrl = (doi: string) => `https://doi.org/${encodeURI(doi)}`;

/** ACS-like: "Smith, J.; Wang, L. Title. J. Am. Chem. Soc. 2020, 142 (3), 1234–1240." */
export function formatReference(r: Reference): string {
  if (!r.title && !r.journal && r.citation) return r.citation;
  const parts: string[] = [];
  if (r.authors) parts.push(r.authors.replace(/\.?$/, '.'));
  if (r.title) parts.push(r.title.replace(/\.?$/, '.'));
  const src = [
    r.journal,
    r.year && String(r.year),
    r.volume && (r.issue ? `${r.volume} (${r.issue})` : r.volume),
    r.pages?.replace(/-/g, '–'),
  ].filter(Boolean);
  if (src.length) parts.push(src.join(', ').replace(/^([^,]+), (\d{4})/, '$1 $2') + '.');
  return parts.join(' ') || r.citation || r.doi || r.url || '';
}

interface CrossrefWork {
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  'container-title'?: string[];
  'short-container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
  published?: { 'date-parts'?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  'article-number'?: string;
  DOI?: string;
  URL?: string;
}

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0].toUpperCase()}.`)
    .join(' ');

/** Reference fields from a Crossref /works response. */
export function fromCrossref(msg: CrossrefWork): Partial<Reference> {
  const authors = (msg.author ?? [])
    .map((a) => (a.family ? `${a.family}${a.given ? `, ${initials(a.given)}` : ''}` : a.name))
    .filter(Boolean);
  const year = (msg.issued ?? msg.published)?.['date-parts']?.[0]?.[0];
  return {
    title: msg.title?.[0]?.replace(/\s+/g, ' ').replace(/<[^>]+>/g, ''),
    authors: authors.length > 10 ? `${authors.slice(0, 10).join('; ')}; et al.` : authors.join('; ') || undefined,
    journal: msg['short-container-title']?.[0] || msg['container-title']?.[0],
    year: typeof year === 'number' ? year : undefined,
    volume: msg.volume,
    issue: msg.issue,
    pages: msg.page ?? msg['article-number'],
    doi: msg.DOI,
  };
}

export async function lookupDoi(doi: string, signal?: AbortSignal): Promise<Partial<Reference>> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { message?: CrossrefWork };
  if (!body.message) throw new Error('no data');
  return fromCrossref(body.message);
}

const s = (x: unknown, max = 2000) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);

export function normalizeReferences(raw: unknown): Reference[] {
  if (!Array.isArray(raw)) return [];
  const out: Reference[] = [];
  for (const x of raw.slice(0, 200)) {
    if (typeof x !== 'object' || x === null) continue;
    const r = x as Record<string, unknown>;
    const id = s(r.id, 64);
    if (!id) continue;
    const ref: Reference = { id };
    for (const k of ['doi', 'url', 'citation', 'title', 'authors', 'journal', 'volume', 'issue', 'pages', 'note'] as const) {
      const v = s(r[k]);
      if (v) ref[k] = v;
    }
    if (typeof r.year === 'number' && r.year > 1600 && r.year < 3000) ref.year = r.year;
    if (ref.url && !/^https?:\/\//i.test(ref.url)) delete ref.url;
    out.push(ref);
  }
  return out;
}
