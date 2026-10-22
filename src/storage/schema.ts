// Validation and upgrade of stored reaction data. Everything read back —
// browser storage, downloaded files, later the server — goes through
// normalizeReaction, so old or hand-edited data is repaired in one place.
import { REACTION_SCHEMA, type Component, type Form, type Reaction, type Role } from '../chem/stoich';
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
  return {
    ...(raw as unknown as Component),
    id: str(raw.id) || newId(),
    name,
    role,
    form: FORMS.includes(raw.form as Form) ? (raw.form as Form) : 'neat',
    purity: num(raw.purity) ?? 100,
    equiv: num(raw.equiv) ?? (role === 'catalyst' ? 0.05 : 1),
  };
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
  // Future: `if ((raw.schemaVersion ?? 1) < 2) r = migrateV1toV2(r)` etc.
  return r;
}
