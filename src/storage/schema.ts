// Validation and upgrade of stored reaction data. Everything read back —
// browser storage, downloaded files, later the server — goes through
// normalizeReaction, so old or hand-edited data is repaired in one place.
import { REACTION_SCHEMA, type Component, type Form, type Reaction, type Role } from '../chem/stoich';
import { RUN_STATUSES, withRuns, type Run, type RunData, type RunStatus } from '../chem/runs';
import { normalizeSnapshot } from '../chem/lots';
import { normalizeReferences } from '../chem/refs';
import { asProcDoc } from '../procedure/doc';
import { newId } from './ids';

const ROLES: Role[] = ['reactant', 'reagent', 'catalyst', 'solvent', 'product'];
const FORMS: Form[] = ['neat', 'solutionM', 'solutionWt'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);

function normalizeComponent(raw: unknown): Component | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name);
  const role = ROLES.includes(raw.role as Role) ? (raw.role as Role) : null;
  if (name === undefined || !role) return null;
  const c: Component = {
    ...(raw as unknown as Component),
    id: str(raw.id) || newId(),
    name,
    role,
    form: FORMS.includes(raw.form as Form) ? (raw.form as Form) : 'neat',
    purity: num(raw.purity) ?? 100,
    equiv: num(raw.equiv) ?? (role === 'catalyst' ? 0.05 : 1),
  };
  const lot = normalizeSnapshot(raw.lot);
  if (lot) c.lot = lot;
  else delete c.lot;
  if (c.actualNote !== undefined && typeof c.actualNote !== 'string') delete c.actualNote;
  return c;
}

/**
 * Return a valid, current-version Reaction, or null if `raw` is not a
 * reaction at all. Unknown extra fields are kept.
 */
export function normalizeReaction(raw: unknown): Reaction | null {
  if (!isObj(raw) || !Array.isArray(raw.components)) return null;
  const components = raw.components.map(normalizeComponent);
  if (components.some((c) => c === null)) return null;
  const list = components as Component[];
  const refMmol = num(raw.refMmol);
  const refId = str(raw.refId) ?? null;
  const r: Reaction = {
    ...(raw as unknown as Reaction),
    title: str(raw.title) ?? '',
    refMmol: refMmol !== undefined && refMmol > 0 ? refMmol : 1,
    refId: refId && list.some((c) => c.id === refId) ? refId : null,
    components: list,
    procedure: asProcDoc(raw.procedure),
    schemaVersion: REACTION_SCHEMA,
  };
  if (!r.procedure) delete r.procedure;
  if (r.code !== undefined && typeof r.code !== 'string') delete r.code;
  const refs = normalizeReferences(raw.references);
  if (refs.length) r.references = refs;
  else delete r.references;
  r.runs = normalizeRuns(raw.runs);
  if (!r.runs.length) delete r.runs;
  return withRuns(r);
}

/** Stored data of an inactive run; null if unusable. */
function normalizeRunData(raw: unknown): RunData | null {
  if (!isObj(raw) || !Array.isArray(raw.components)) return null;
  const comps = raw.components.map(normalizeComponent);
  if (comps.some((c) => c === null)) return null;
  const list = comps as Component[];
  const refMmol = num(raw.refMmol);
  const refId = str(raw.refId) ?? null;
  const d: RunData = {
    refId: refId && list.some((c) => c.id === refId) ? refId : null,
    refMmol: refMmol !== undefined && refMmol > 0 ? refMmol : 1,
    components: list,
  };
  for (const k of ['conditions', 'notes', 'operator', 'notebook'] as const) {
    const v = str(raw[k]);
    if (v !== undefined) d[k] = v;
  }
  const procedure = asProcDoc(raw.procedure);
  if (procedure) d.procedure = procedure;
  return d;
}

function normalizeRuns(raw: unknown): Run[] {
  if (!Array.isArray(raw)) return [];
  const out: Run[] = [];
  const ids = new Set<string>();
  for (const x of raw) {
    if (!isObj(x)) continue;
    const id = str(x.id);
    if (!id || ids.has(id)) continue;
    const run: Run = {
      id,
      seq: num(x.seq) ?? out.length + 1,
      status: RUN_STATUSES.includes(x.status as RunStatus) ? (x.status as RunStatus) : 'planned',
      createdAt: num(x.createdAt) ?? 0,
    };
    const date = str(x.date);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) run.date = date;
    for (const k of ['appearance', 'conclusion'] as const) {
      const v = str(x[k]);
      if (v) run[k] = v;
    }
    if (x.data !== undefined) {
      const data = normalizeRunData(x.data);
      if (!data) continue; // a broken inactive run is dropped rather than failing the whole reaction
      run.data = data;
    }
    ids.add(id);
    out.push(run);
  }
  return out;
  // Future: `if ((raw.schemaVersion ?? 1) < 2) r = migrateV1toV2(r)` etc.
}
