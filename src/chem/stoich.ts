// Stoichiometry engine. Pure functions, no UI.
//
// Internal units: amount in mmol, mass in mg, volume in µL, density in g/mL
// (= mg/µL), molarity in mol/L (= mmol/mL), percentages 0–100.
//
// Every non-solvent component's amount is `refMmol × equiv`; the reference
// (usually the limiting reagent) has equiv 1. Editing any amount, mass or
// volume is translated back into an equiv (or into refMmol for the reference).

export type Role = 'reactant' | 'reagent' | 'catalyst' | 'solvent' | 'product';
/** neat = pure solid/liquid; solutionM = molar solution; solutionWt = wt% solution (e.g. 37% HCl). */
export type Form = 'neat' | 'solutionM' | 'solutionWt';
/** Physical state of a neat compound at room temperature. */
export type Phase = 'solid' | 'liquid' | 'gas';

export interface Component {
  id: string;
  name: string;
  role: Role;
  smiles?: string;
  formula?: string;
  cas?: string;
  cid?: number;
  mw?: number;
  /** Density of the neat compound, g/mL. */
  density?: number;
  /** Where the density came from (shown next to the value). */
  densitySource?: 'library' | 'pubchem' | 'manual';
  /** State at room temperature; liquids are dispensed by volume. Unknown = undefined. */
  phase?: Phase;
  /** Result of the background PubChem lookup of phase/density (absent = not tried yet). */
  lookup?: 'done' | 'failed';
  /** Purity / assay in %, default 100. */
  purity: number;
  form: Form;
  /** mol/L, for form = solutionM. */
  molarity?: number;
  /** wt%, for form = solutionWt. */
  wtPercent?: number;
  /** Density of the solution, g/mL (solutionM / solutionWt). */
  solutionDensity?: number;
  equiv: number;
  /** Product only: isolated mass in mg. */
  actualMass?: number;
  /** Solvent only: fixed volume in µL… */
  solventVolume?: number;
  /** …or concentration of the reference compound in mol/L. */
  solventConc?: number;
}

export interface Reaction {
  title: string;
  refId: string | null;
  /** Amount of the reference compound, mmol. */
  refMmol: number;
  components: Component[];
  /** Free-text conditions, e.g. "90 °C, 12 h, N2". */
  conditions?: string;
  notes?: string;
}

export interface Computed {
  mmol?: number;
  mass?: number;
  volume?: number;
  /** Product: theoretical yield mass, mg. */
  theoMass?: number;
  /** Product: yield %. */
  yieldPct?: number;
}

const pos = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x) && x > 0;

export function compute(rxn: Reaction, c: Component): Computed {
  if (c.role === 'solvent') return computeSolvent(rxn, c);
  const mmol = rxn.refMmol * c.equiv;
  if (c.role === 'product') {
    const theoMass = pos(c.mw) ? mmol * c.mw : undefined;
    const yieldPct = pos(theoMass) && pos(c.actualMass) ? (c.actualMass / theoMass) * 100 : undefined;
    return { mmol, theoMass, mass: c.actualMass, yieldPct };
  }
  return { mmol, ...amountToMassVolume(c, mmol) };
}

function computeSolvent(rxn: Reaction, c: Component): Computed {
  let volume: number | undefined;
  if (pos(c.solventConc)) volume = (rxn.refMmol / c.solventConc) * 1000;
  else if (pos(c.solventVolume)) volume = c.solventVolume;
  const mass = pos(volume) && pos(c.density) ? volume * c.density : undefined;
  return { volume, mass };
}

/** mass/volume that must be dispensed to deliver `mmol` of active compound. */
export function amountToMassVolume(c: Component, mmol: number): { mass?: number; volume?: number } {
  const mw = c.mw;
  switch (c.form) {
    case 'neat': {
      if (!pos(mw)) return {};
      const mass = (mmol * mw) / (purityOf(c) / 100);
      return { mass, volume: byVolume(c) && pos(c.density) ? mass / c.density : undefined };
    }
    case 'solutionM': {
      if (!pos(c.molarity)) return {};
      const volume = (mmol / c.molarity) * 1000;
      return { volume, mass: pos(c.solutionDensity) ? volume * c.solutionDensity : undefined };
    }
    case 'solutionWt': {
      if (!pos(mw) || !pos(c.wtPercent)) return {};
      const mass = (mmol * mw) / (c.wtPercent / 100);
      return { mass, volume: pos(c.solutionDensity) ? mass / c.solutionDensity : undefined };
    }
  }
}

/** Neat solids and gases are not dispensed by volume. */
const byVolume = (c: Component) => c.phase !== 'solid' && c.phase !== 'gas';

/** A neat liquid whose volume can't be computed yet (density missing). */
export const needsDensity = (c: Component) =>
  c.role !== 'product' && c.form === 'neat' && c.phase === 'liquid' && !pos(c.density);

function purityOf(c: Component) {
  return pos(c.purity) ? Math.min(c.purity, 100) : 100;
}

/** Inverse of amountToMassVolume for a given dispensed mass (mg). */
export function massToMmol(c: Component, mass: number): number | undefined {
  switch (c.form) {
    case 'neat':
      return pos(c.mw) ? (mass * purityOf(c)) / 100 / c.mw : undefined;
    case 'solutionWt':
      return pos(c.mw) && pos(c.wtPercent) ? (mass * c.wtPercent) / 100 / c.mw : undefined;
    case 'solutionM':
      return pos(c.solutionDensity) ? volumeToMmol(c, mass / c.solutionDensity) : undefined;
  }
}

/** Inverse of amountToMassVolume for a given dispensed volume (µL). */
export function volumeToMmol(c: Component, volume: number): number | undefined {
  switch (c.form) {
    case 'neat':
      return byVolume(c) && pos(c.density) ? massToMmol(c, volume * c.density) : undefined;
    case 'solutionM':
      return pos(c.molarity) ? (volume / 1000) * c.molarity : undefined;
    case 'solutionWt':
      return pos(c.solutionDensity) ? massToMmol(c, volume * c.solutionDensity) : undefined;
  }
}

// ---- state updates (return a new Reaction) ----

function patch(rxn: Reaction, id: string, p: Partial<Component>): Reaction {
  return { ...rxn, components: rxn.components.map((c) => (c.id === id ? { ...c, ...p } : c)) };
}

export function updateComponent(rxn: Reaction, id: string, p: Partial<Component>): Reaction {
  return patch(rxn, id, p);
}

/** Set the delivered amount (mmol) of a non-solvent component. */
export function setMmol(rxn: Reaction, id: string, mmol: number): Reaction {
  const c = rxn.components.find((x) => x.id === id);
  if (!c || !pos(mmol) || c.role === 'solvent') return rxn;
  // The reference drives every other amount.
  if (id === rxn.refId) return { ...rxn, refMmol: mmol };
  if (!pos(rxn.refMmol)) return rxn;
  return patch(rxn, id, { equiv: mmol / rxn.refMmol });
}

/** The reference is fixed at 1 equiv; change it with setReference instead. */
export function setEquiv(rxn: Reaction, id: string, equiv: number): Reaction {
  if (!pos(equiv) || id === rxn.refId) return rxn;
  return patch(rxn, id, { equiv });
}

export function setMass(rxn: Reaction, id: string, mass: number): Reaction {
  const c = rxn.components.find((x) => x.id === id);
  if (!c || !pos(mass)) return rxn;
  if (c.role === 'product') return patch(rxn, id, { actualMass: mass });
  if (c.role === 'solvent') {
    return pos(c.density) ? setVolume(rxn, id, mass / c.density) : rxn;
  }
  const mmol = massToMmol(c, mass);
  return mmol === undefined ? rxn : setMmol(rxn, id, mmol);
}

export function setVolume(rxn: Reaction, id: string, volume: number): Reaction {
  const c = rxn.components.find((x) => x.id === id);
  if (!c || !pos(volume)) return rxn;
  if (c.role === 'solvent') return patch(rxn, id, { solventVolume: volume, solventConc: undefined });
  if (c.role === 'product') return rxn;
  const mmol = volumeToMmol(c, volume);
  return mmol === undefined ? rxn : setMmol(rxn, id, mmol);
}

/** Make `id` the reference (1 equiv) while keeping every current amount unchanged. */
export function setReference(rxn: Reaction, id: string): Reaction {
  const target = rxn.components.find((c) => c.id === id);
  if (!target || target.role === 'solvent' || target.role === 'product') return rxn;
  const newRefMmol = rxn.refMmol * target.equiv;
  if (!pos(newRefMmol)) return { ...rxn, refId: id };
  return {
    ...rxn,
    refId: id,
    refMmol: newRefMmol,
    components: rxn.components.map((c) =>
      c.role === 'solvent' ? c : { ...c, equiv: c.id === id ? 1 : (c.equiv * rxn.refMmol) / newRefMmol },
    ),
  };
}

/** Scale the whole reaction (amounts and fixed solvent volumes) by `factor`. */
export function scale(rxn: Reaction, factor: number): Reaction {
  if (!pos(factor)) return rxn;
  return {
    ...rxn,
    refMmol: rxn.refMmol * factor,
    components: rxn.components.map((c) =>
      c.role === 'solvent' && pos(c.solventVolume)
        ? { ...c, solventVolume: c.solventVolume * factor }
        : c.role === 'product'
          ? { ...c, actualMass: undefined } // an isolated mass no longer matches the new scale
          : c,
    ),
  };
}

/**
 * Reverse planning: set the scale so that `targetMass` mg of product is obtained
 * at the expected yield (%).
 */
export function planForProduct(rxn: Reaction, productId: string, targetMass: number, expectedYield: number): Reaction {
  const p = rxn.components.find((c) => c.id === productId);
  if (!p || !pos(p.mw) || !pos(targetMass) || !pos(expectedYield) || !pos(p.equiv)) return rxn;
  const productMmol = targetMass / p.mw / (expectedYield / 100);
  return scale(rxn, productMmol / p.equiv / rxn.refMmol);
}

/** Change a role, keeping a valid reference (solvents and products can't be the reference). */
export function setRole(rxn: Reaction, id: string, role: Role): Reaction {
  let next = patch(rxn, id, { role });
  const canRef = (c: Component) => c.role === 'reactant' || c.role === 'reagent' || c.role === 'catalyst';
  const ref = next.components.find((c) => c.id === next.refId);
  if (!ref || !canRef(ref)) {
    const candidate = next.components.find((c) => c.role === 'reactant' || c.role === 'reagent');
    next = candidate ? setReference({ ...next, refId: null }, candidate.id) : { ...next, refId: null };
  }
  return next;
}

export function addComponent(rxn: Reaction, c: Component): Reaction {
  const components = [...rxn.components, c];
  const needsRef = rxn.refId === null && (c.role === 'reactant' || c.role === 'reagent');
  return { ...rxn, components, refId: needsRef ? c.id : rxn.refId };
}

export function removeComponent(rxn: Reaction, id: string): Reaction {
  const components = rxn.components.filter((c) => c.id !== id);
  if (rxn.refId !== id) return { ...rxn, components };
  const next = components.find((c) => c.role === 'reactant' || c.role === 'reagent');
  return next ? setReference({ ...rxn, components }, next.id) : { ...rxn, components, refId: null };
}

const AGENT_ROLES: Role[] = ['reagent', 'catalyst', 'solvent'];

/**
 * Add compounds, or (replace = true) update the reaction to a new equation.
 * When replacing, compounds that match an existing one by `key` keep their
 * data (amount, form, purity…); unmatched reactants/products are dropped, and
 * existing agents are dropped only if the new input lists agents itself and
 * the agent has a structure to compare (text-only catalysts like Pd(PPh3)4
 * typed by hand are kept).
 */
export function mergeComponents(
  rxn: Reaction,
  incoming: Component[],
  key: (c: Component) => string,
  /** explicitEquiv: ids of incoming compounds whose equiv was given in the input (e.g. "2 equiv"). */
  opts: { replace: boolean; hasAgents: boolean; explicitEquiv?: Set<string> },
): Reaction {
  if (!opts.replace) return incoming.reduce(addComponent, rxn);

  const pool = new Map<string, Component[]>();
  for (const c of rxn.components) pool.set(key(c), [...(pool.get(key(c)) ?? []), c]);

  const result: Component[] = [];
  const kept = new Set<string>();
  for (const inc of incoming) {
    const match = pool.get(key(inc))?.find((c) => !kept.has(c.id));
    if (match) {
      kept.add(match.id);
      const equiv = opts.explicitEquiv?.has(inc.id) ? inc.equiv : match.equiv;
      result.push({ ...match, role: inc.role, equiv });
    } else result.push(inc);
  }
  for (const c of rxn.components) {
    if (kept.has(c.id)) continue;
    const keep = AGENT_ROLES.includes(c.role) && (!opts.hasAgents || !c.smiles);
    if (keep) result.push(c);
  }

  let next: Reaction = { ...rxn, components: result };
  const ref = result.find((c) => c.id === rxn.refId);
  if (!ref || ref.role === 'solvent' || ref.role === 'product') {
    const candidate = result.find((c) => c.role === 'reactant') ?? result.find((c) => c.role === 'reagent');
    next = candidate
      ? { ...next, refId: candidate.id, components: result.map((c) => (c.id === candidate.id ? { ...c, equiv: 1 } : c)) }
      : { ...next, refId: null };
  }
  return next;
}

export function newComponent(p: Partial<Component> & { name: string; role: Role }): Component {
  const isProduct = p.role === 'product';
  return {
    id: Math.random().toString(36).slice(2, 10),
    purity: 100,
    form: 'neat',
    equiv: p.role === 'catalyst' ? 0.05 : 1,
    ...p,
    ...(isProduct ? { form: 'neat' as Form } : {}),
  };
}

export function emptyReaction(): Reaction {
  return { title: '', refId: null, refMmol: 1, components: [] };
}
