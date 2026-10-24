// Several experiments ("runs") of one reaction. Each run has its own amounts,
// conditions, procedure and result. The active run's data lives at the top
// level of the Reaction — where the calculator, table, report and editor
// already read it — and the other runs keep theirs in `runs[i].data`.
// Switching runs swaps the two.
import { compute, type Reaction } from './stoich';

export type RunStatus = 'planned' | 'running' | 'done' | 'failed';
export const RUN_STATUSES: RunStatus[] = ['planned', 'running', 'done', 'failed'];

/** Reaction fields that belong to one run. `notebook` is the run's own code. */
export const RUN_FIELDS = ['refId', 'refMmol', 'components', 'conditions', 'notes', 'procedure', 'operator', 'notebook'] as const;
export type RunField = (typeof RUN_FIELDS)[number];
export type RunData = Pick<Reaction, RunField>;

export interface Run {
  id: string;
  /** 1, 2, 3… in creation order; part of the automatic run code. */
  seq: number;
  status: RunStatus;
  /** Date of the experiment, YYYY-MM-DD. */
  date?: string;
  createdAt: number;
  /** Product appearance, e.g. "white solid". */
  appearance?: string;
  /** One-line takeaway. */
  conclusion?: string;
  /** This run's data — absent for the active run (it is at the top level). */
  data?: RunData;
}

/** Summary shown in the saved list. */
export interface ReactionMeta {
  code?: string;
  runs: number;
  bestYield?: number;
  lastDate?: string;
}

/** Run id given to the single run of data saved before runs existed. */
export const FIRST_RUN_ID = 'r1';

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const newRunId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function pick(r: Reaction): RunData {
  const out: Record<string, unknown> = {};
  for (const k of RUN_FIELDS) if (r[k] !== undefined) out[k] = r[k];
  return out as unknown as RunData;
}

function put(r: Reaction, data: RunData): Reaction {
  const out: Record<string, unknown> = { ...r };
  for (const k of RUN_FIELDS) delete out[k];
  return { ...(out as unknown as Reaction), ...data };
}

/** Product yield of a run (best of its products). */
export function runYield(data: RunData): number | undefined {
  const r = data as Reaction;
  const ys = r.components.filter((c) => c.role === 'product').map((c) => compute(r, c).yieldPct).filter((y): y is number => y !== undefined);
  return ys.length ? Math.max(...ys) : undefined;
}

/** Status for data saved before runs existed. */
const inferStatus = (r: Reaction): RunStatus => (r.components.some((c) => c.role === 'product' && c.actualMass) ? 'done' : 'planned');

/** Make sure the reaction has a runs list with exactly one active run. */
export function withRuns(r: Reaction): Reaction {
  // createdAt 0 = unknown; keeps the result deterministic for unsaved-change checks.
  const runs = r.runs?.length ? r.runs : [{ id: FIRST_RUN_ID, seq: 1, status: inferStatus(r), createdAt: 0 }];
  let activeRunId = r.activeRunId;
  if (!runs.some((x) => x.id === activeRunId && !x.data)) activeRunId = runs.find((x) => !x.data)?.id;
  if (!activeRunId) {
    // Every run has stored data (hand-edited file): the top level becomes one more run.
    const seq = Math.max(...runs.map((x) => x.seq)) + 1;
    const extra: Run = { id: newRunId(), seq, status: inferStatus(r), createdAt: Date.now() };
    return { ...r, runs: [...runs, extra], activeRunId: extra.id };
  }
  // Only the active run may lack data.
  return { ...r, runs: runs.map((x) => (x.id === activeRunId || x.data ? x : { ...x, data: pick(r) })), activeRunId };
}

export interface FullRun extends Run {
  data: RunData;
  active: boolean;
}

/** All runs with their data, in order. */
export function runsOf(r: Reaction): FullRun[] {
  const rr = withRuns(r);
  return rr.runs!.map((x) => (x.id === rr.activeRunId ? { ...x, data: pick(rr), active: true } : { ...x, data: x.data!, active: false }));
}

export const activeRun = (r: Reaction): FullRun => runsOf(r).find((x) => x.active)!;

export function switchRun(r: Reaction, id: string): Reaction {
  const rr = withRuns(r);
  if (id === rr.activeRunId) return rr;
  const target = rr.runs!.find((x) => x.id === id);
  if (!target?.data) return rr;
  const current = pick(rr);
  const runs = rr.runs!.map((x) => (x.id === rr.activeRunId ? { ...x, data: current } : x.id === id ? { ...x, data: undefined } : x));
  return { ...put(rr, target.data), runs, activeRunId: id };
}

/** A run's data as the starting point of a new run: same compounds, plan and procedure; no results. */
export function freshCopy(data: RunData, copyProcedure: boolean): RunData {
  return {
    ...data,
    // Same bottles (lot) as the source run; what was weighed and obtained starts empty.
    components: data.components.map((c) => ({ ...c, actualMass: undefined, actualAmount: undefined, actualNote: undefined })),
    notebook: undefined,
    ...(copyProcedure ? {} : { procedure: undefined, notes: undefined }),
  };
}

/** Add a run copied from `sourceId` (default: the active one) and make it active. */
export function addRun(r: Reaction, opts: { sourceId?: string; copyProcedure?: boolean } = {}): Reaction {
  const all = runsOf(r);
  const source = all.find((x) => x.id === opts.sourceId) ?? all.find((x) => x.active)!;
  const rr = withRuns(r);
  const run: Run = { id: newRunId(), seq: Math.max(...all.map((x) => x.seq)) + 1, status: 'planned', date: today(), createdAt: Date.now() };
  const runs = rr.runs!.map((x) => (x.id === rr.activeRunId ? { ...x, data: pick(rr) } : x));
  return { ...put(rr, freshCopy(source.data, opts.copyProcedure ?? true)), runs: [...runs, run], activeRunId: run.id };
}

/** Delete a run (not the last one); deleting the active run switches to its neighbour. */
export function removeRun(r: Reaction, id: string): Reaction {
  let rr = withRuns(r);
  const runs = rr.runs!;
  if (runs.length < 2) return rr;
  if (id === rr.activeRunId) {
    const i = runs.findIndex((x) => x.id === id);
    rr = switchRun(rr, (runs[i + 1] ?? runs[i - 1]).id);
  }
  return { ...rr, runs: rr.runs!.filter((x) => x.id !== id) };
}

export function updateRun(r: Reaction, id: string, p: Partial<Pick<Run, 'status' | 'date' | 'appearance' | 'conclusion'>>): Reaction {
  const rr = withRuns(r);
  return { ...rr, runs: rr.runs!.map((x) => (x.id === id ? { ...x, ...p } : x)) };
}

/** The run's code: its own (notebook) if set, else "<reaction code>-<seq>". */
export function runCode(r: Pick<Reaction, 'code'>, run: Pick<FullRun, 'seq' | 'data'>): string {
  return run.data.notebook?.trim() || (r.code?.trim() ? `${r.code.trim()}-${run.seq}` : `#${run.seq}`);
}

export function reactionMeta(r: Reaction): ReactionMeta {
  const all = runsOf(r);
  const yields = all.map((x) => runYield(x.data)).filter((y): y is number => y !== undefined);
  const dates = all.map((x) => x.date).filter((d): d is string => !!d).sort();
  return {
    ...(r.code?.trim() ? { code: r.code.trim() } : {}),
    runs: all.length,
    ...(yields.length ? { bestYield: Math.round(Math.max(...yields) * 10) / 10 } : {}),
    ...(dates.length ? { lastDate: dates[dates.length - 1] } : {}),
  };
}

/**
 * JSON for "unsaved changes" checks: independent of which run is active,
 * so switching runs alone doesn't count as an edit.
 */
export function canonicalJson(r: Reaction): string {
  const all = runsOf(r);
  const { activeRunId: _a, runs: _r, ...rest } = r;
  const base: Record<string, unknown> = { ...rest };
  for (const k of RUN_FIELDS) delete base[k];
  const runs = all.map((x) => ({
    id: x.id, seq: x.seq, status: x.status, date: x.date, createdAt: x.createdAt, appearance: x.appearance, conclusion: x.conclusion,
    data: pick(x.data as Reaction),
  }));
  return JSON.stringify({ ...base, runs });
}

/**
 * Next code after the saved ones: same prefix as the most recent code,
 * number one higher than the highest with that prefix ("LT-042" → "LT-043").
 */
export function nextCode(recentFirst: (string | undefined)[], fallbackPrefix = 'RXN-'): string {
  const parsed = recentFirst
    .map((c) => c?.trim())
    .filter((c): c is string => !!c)
    .map((c) => /^(.*?)(\d+)$/.exec(c))
    .filter((m): m is RegExpExecArray => !!m);
  if (!parsed.length) return `${fallbackPrefix}001`;
  const prefix = parsed[0][1];
  const same = parsed.filter((m) => m[1] === prefix);
  const width = Math.max(...same.map((m) => m[2].length));
  const n = Math.max(...same.map((m) => Number(m[2]))) + 1;
  return prefix + String(n).padStart(width, '0');
}
