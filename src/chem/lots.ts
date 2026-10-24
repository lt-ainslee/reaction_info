// Reagent lots ("bottles"): supplier, grade, catalog / lot number, measured
// purity or titrated concentration, and an identity check. Lots live in a
// reusable library; a component keeps a snapshot of the lot it used in a
// run, so later edits to the library don't rewrite old records. Spectra
// that identify a lot are attached to the lot, so every reaction using the
// bottle sees them.
import type { Component } from './stoich';

export type LotSource = 'commercial' | 'made';
export type Verification = 'unverified' | 'ok' | 'issue';
export const VERIFICATIONS: Verification[] = ['unverified', 'ok', 'issue'];

/** Fields describing the bottle (copied into a component's snapshot). */
export interface LotInfo {
  source?: LotSource;
  supplier?: string;
  /** Grade / pack / stated concentration, as on the label. */
  spec?: string;
  catalogNumber?: string;
  lotNumber?: string;
  /** Measured purity / assay, % (e.g. by qNMR). */
  purity?: number;
  /** Titrated concentration, mol/L (e.g. n-BuLi). */
  molarity?: number;
  /** Received or opened, YYYY-MM-DD. */
  receivedAt?: string;
  /** Self-made: the reaction it came from. */
  sourceReactionId?: string;
  sourceLabel?: string;
  verification?: Verification;
  verificationNote?: string;
  note?: string;
}

export interface ReagentLot extends LotInfo {
  id: string;
  /** Compound identity used to offer the lot for the same compound (see compoundKey). */
  key: string;
  name: string;
  cas?: string;
  smiles?: string;
  createdAt: number;
  updatedAt: number;
  /** Number of attached files (from the server). */
  attachments?: number;
}

/** What a component stores: the lot info at the time, plus the library id. */
export interface LotSnapshot extends LotInfo {
  lotId?: string;
}

export const LOT_FIELDS: (keyof LotInfo)[] = [
  'source', 'supplier', 'spec', 'catalogNumber', 'lotNumber', 'purity', 'molarity', 'receivedAt',
  'sourceReactionId', 'sourceLabel', 'verification', 'verificationNote', 'note',
];

/** Identity of a compound across reactions: CAS, else SMILES, else name. */
export function compoundKey(c: Pick<Component, 'cas' | 'smiles' | 'name'>): string {
  if (c.cas?.trim()) return `cas:${c.cas.trim()}`;
  if (c.smiles?.trim()) return `smi:${c.smiles.trim()}`;
  return `name:${c.name.trim().toLowerCase()}`;
}

export function lotInfo(x: LotInfo): LotInfo {
  const out: Record<string, unknown> = {};
  for (const k of LOT_FIELDS) if (x[k] !== undefined && x[k] !== '') out[k] = x[k];
  return out as LotInfo;
}

export const hasLotInfo = (s?: LotSnapshot) => !!s && (!!s.lotId || Object.keys(lotInfo(s)).length > 0);

/** Short label: "Adamas · A12345 · lot 2304" or "self-made · RXN-001-2". */
export function lotLabel(s: LotInfo, madeWord = 'made'): string {
  if (s.source === 'made') return [madeWord, s.sourceLabel, s.lotNumber].filter(Boolean).join(' · ');
  return [s.supplier, s.catalogNumber, s.lotNumber && `lot ${s.lotNumber}`].filter(Boolean).join(' · ');
}

/** Component changes when a lot is used: snapshot + measured purity / titrated concentration. */
export function applyLot(c: Component, lot: ReagentLot | LotSnapshot, lotId?: string): Partial<Component> {
  const p: Partial<Component> = { lot: { ...lotInfo(lot), ...(lotId ? { lotId } : {}) } };
  if (lot.purity && lot.purity > 0 && c.form === 'neat') p.purity = Math.min(lot.purity, 100);
  if (lot.molarity && lot.molarity > 0 && c.form === 'solutionM') p.molarity = lot.molarity;
  return p;
}

/** A library lot from a component's current snapshot. */
export function lotFromComponent(c: Component, id: string, now = Date.now()): ReagentLot {
  return {
    ...lotInfo(c.lot ?? {}),
    id,
    key: compoundKey(c),
    name: c.name,
    ...(c.cas ? { cas: c.cas } : {}),
    ...(c.smiles ? { smiles: c.smiles } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.slice(0, 500) : undefined);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined);

/** Validate lot info from storage / the network. */
export function normalizeLotInfo(raw: unknown): LotInfo {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  return lotInfo({
    source: r.source === 'made' ? 'made' : r.source === 'commercial' ? 'commercial' : undefined,
    supplier: str(r.supplier),
    spec: str(r.spec),
    catalogNumber: str(r.catalogNumber),
    lotNumber: str(r.lotNumber),
    purity: num(r.purity),
    molarity: num(r.molarity),
    receivedAt: typeof r.receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.receivedAt) ? r.receivedAt : undefined,
    sourceReactionId: str(r.sourceReactionId),
    sourceLabel: str(r.sourceLabel),
    verification: VERIFICATIONS.includes(r.verification as Verification) ? (r.verification as Verification) : undefined,
    verificationNote: str(r.verificationNote),
    note: str(r.note),
  });
}

export function normalizeSnapshot(raw: unknown): LotSnapshot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const s: LotSnapshot = normalizeLotInfo(raw);
  const id = (raw as Record<string, unknown>).lotId;
  if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)) s.lotId = id;
  return hasLotInfo(s) ? s : undefined;
}

export function normalizeLot(raw: unknown): ReagentLot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  const name = str(r.name);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name) return null;
  return {
    ...normalizeLotInfo(r),
    id,
    key: str(r.key) ?? `name:${name.toLowerCase()}`,
    name,
    ...(str(r.cas) ? { cas: str(r.cas) } : {}),
    ...(str(r.smiles) ? { smiles: str(r.smiles) } : {}),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    ...(typeof r.attachments === 'number' ? { attachments: r.attachments } : {}),
  };
}

/** Owner key of a lot's attachments (attachments of reactions use the reaction id). */
export const lotOwner = (lotId: string) => `lot:${lotId}`;
