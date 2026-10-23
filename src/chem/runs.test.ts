import { describe, expect, it } from 'vitest';
import { normalizeReaction } from '../storage/schema';
import { addRun, canonicalJson, nextCode, reactionMeta, removeRun, runCode, runsOf, switchRun, updateRun, withRuns } from './runs';
import { compute, effectiveRefMmol, newComponent, type Reaction } from './stoich';

const base = (): Reaction => {
  const a = { ...newComponent({ name: 'A', role: 'reactant', mw: 100 }), id: 'a' };
  const b = { ...newComponent({ name: 'B', role: 'reagent', mw: 50, equiv: 2 }), id: 'b' };
  const p = { ...newComponent({ name: 'P', role: 'product', mw: 120 }), id: 'p', actualMass: 96 };
  return { title: 'T', code: 'LT-042', refId: 'a', refMmol: 1, components: [a, b, p], conditions: '90 °C', notebook: undefined };
};

describe('runs', () => {
  it('turns old data into run #1', () => {
    const r = normalizeReaction(base())!;
    expect(r.runs).toHaveLength(1);
    expect(r.activeRunId).toBe('r1');
    expect(r.runs![0].status).toBe('done');
    expect(runCode(r, runsOf(r)[0])).toBe('LT-042-1');
  });

  it('copies the active run without results and switches back and forth', () => {
    let r = withRuns(base());
    r = addRun(r);
    const runs = runsOf(r);
    expect(runs).toHaveLength(2);
    expect(runs[1].active).toBe(true);
    expect(r.components.find((c) => c.id === 'p')!.actualMass).toBeUndefined();
    expect(r.conditions).toBe('90 °C');
    r = { ...r, refMmol: 10, conditions: '100 °C' };
    r = switchRun(r, 'r1');
    expect(r.refMmol).toBe(1);
    expect(r.conditions).toBe('90 °C');
    expect(r.components.find((c) => c.id === 'p')!.actualMass).toBe(96);
    r = switchRun(r, runs[1].id);
    expect(r.refMmol).toBe(10);
    expect(runCode(r, runsOf(r)[1])).toBe('LT-042-2');
  });

  it('ignores the active run when checking for unsaved changes', () => {
    const r = normalizeReaction(addRun(withRuns(base())))!;
    const saved = normalizeReaction(JSON.parse(JSON.stringify(r)))!;
    expect(canonicalJson(switchRun(saved, 'r1'))).toBe(canonicalJson(r));
    expect(canonicalJson({ ...r, refMmol: 3 })).not.toBe(canonicalJson(r));
  });

  it('survives a save round trip with several runs', () => {
    let r = addRun(withRuns(base()), { copyProcedure: false });
    r = updateRun(r, r.activeRunId!, { status: 'failed', conclusion: 'no conversion' });
    const back = normalizeReaction(JSON.parse(JSON.stringify(r)))!;
    expect(runsOf(back).map((x) => [x.seq, x.status, x.active])).toEqual([[1, 'done', false], [2, 'failed', true]]);
    expect(reactionMeta(back)).toEqual({ code: 'LT-042', runs: 2, bestYield: 80, lastDate: back.runs![1].date });
  });

  it('removes runs, never the last one', () => {
    let r = addRun(withRuns(base()));
    r = removeRun(r, r.activeRunId!);
    expect(runsOf(r)).toHaveLength(1);
    expect(r.activeRunId).toBe('r1');
    expect(r.components.find((c) => c.id === 'p')!.actualMass).toBe(96);
    expect(runsOf(removeRun(r, 'r1'))).toHaveLength(1);
  });

  it('suggests the next reaction code', () => {
    expect(nextCode([])).toBe('RXN-001');
    expect(nextCode(['LT-042', 'LT-007', 'BH-100'])).toBe('LT-043');
    expect(nextCode([undefined, 'LT-2026-009'])).toBe('LT-2026-010');
  });
});

describe('actual amounts', () => {
  it('derives actual equiv, deviation and the yield basis', () => {
    const r = base();
    r.components[0] = { ...r.components[0], actualAmount: { mass: 95 } }; // 0.95 mmol of the reference
    r.components[1] = { ...r.components[1], actualAmount: { mass: 105 } }; // 2.1 mmol
    expect(effectiveRefMmol(r)).toBeCloseTo(0.95);
    const b = compute(r, r.components[1]);
    expect(b.actualEquiv).toBeCloseTo(2.1 / 0.95);
    expect(b.deviation).toBeCloseTo(0.05);
    expect(compute(r, r.components[2]).yieldPct).toBeCloseTo((96 / (0.95 * 120)) * 100);
  });
});
