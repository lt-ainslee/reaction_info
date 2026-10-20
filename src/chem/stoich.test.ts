import { describe, expect, it } from 'vitest';
import {
  addComponent, compute, emptyReaction, newComponent, planForProduct, removeComponent, scale,
  setMass, setMmol, setReference, setRole, setVolume, type Reaction,
} from './stoich';

// Fischer esterification-like setup: benzoic acid (ref), MeOH (neat liquid),
// n-BuLi (2.5 M), HCl (37 wt%), Pd catalyst, THF solvent, product.
function build(): Reaction {
  let r = emptyReaction();
  r = addComponent(r, newComponent({ id: 'a', name: 'PhCOOH', role: 'reactant', mw: 122.12 }));
  r = addComponent(r, newComponent({ id: 'b', name: 'MeOH', role: 'reactant', mw: 32.04, density: 0.792, equiv: 2 }));
  r = addComponent(r, newComponent({ id: 'c', name: 'BuLi', role: 'reagent', mw: 64.06, form: 'solutionM', molarity: 2.5, equiv: 1.1 }));
  r = addComponent(r, newComponent({ id: 'd', name: 'HCl', role: 'reagent', mw: 36.46, form: 'solutionWt', wtPercent: 37, solutionDensity: 1.19, equiv: 0.5 }));
  r = addComponent(r, newComponent({ id: 'e', name: 'Pd', role: 'catalyst', mw: 1155.59, purity: 50 }));
  r = addComponent(r, newComponent({ id: 'f', name: 'THF', role: 'solvent', density: 0.889, solventConc: 0.2 }));
  r = addComponent(r, newComponent({ id: 'p', name: 'Ester', role: 'product', mw: 136.15 }));
  return setMmol(r, 'a', 10);
}

const get = (r: Reaction, id: string) => compute(r, r.components.find((c) => c.id === id)!);

describe('compute', () => {
  it('uses the first reactant as reference', () => {
    expect(build().refId).toBe('a');
  });

  it('computes mass and volume for every form', () => {
    const r = build();
    expect(get(r, 'a').mass).toBeCloseTo(1221.2); // 10 mmol × 122.12
    expect(get(r, 'b').mmol).toBeCloseTo(20);
    expect(get(r, 'b').volume).toBeCloseTo((20 * 32.04) / 0.792); // µL
    expect(get(r, 'c').volume).toBeCloseTo(4400); // 11 mmol / 2.5 M = 4.4 mL
    expect(get(r, 'd').mass).toBeCloseTo((5 * 36.46) / 0.37);
    expect(get(r, 'd').volume).toBeCloseTo((5 * 36.46) / 0.37 / 1.19);
    expect(get(r, 'e').mmol).toBeCloseTo(0.5); // 5 mol%
    expect(get(r, 'e').mass).toBeCloseTo((0.5 * 1155.59) / 0.5); // purity 50%
    expect(get(r, 'f').volume).toBeCloseTo(50000); // 10 mmol at 0.2 M = 50 mL
    expect(get(r, 'p').theoMass).toBeCloseTo(1361.5);
  });

  it('computes yield from actual mass', () => {
    const r = setMass(build(), 'p', 1089.2);
    expect(get(r, 'p').yieldPct).toBeCloseTo(80, 1);
  });
});

describe('inverse edits', () => {
  it('editing a non-reference mass changes only its equiv', () => {
    const r = setMass(build(), 'b', 32.04 * 30);
    expect(r.components.find((c) => c.id === 'b')!.equiv).toBeCloseTo(3);
    expect(r.refMmol).toBe(10);
  });

  it('editing the reference volume rescales everything', () => {
    let r = build();
    r = setReference(r, 'b'); // MeOH becomes the reference (20 mmol)
    expect(r.refMmol).toBeCloseTo(20);
    expect(get(r, 'a').mmol).toBeCloseTo(10);
    r = setVolume(r, 'b', (40 * 32.04) / 0.792);
    expect(r.refMmol).toBeCloseTo(40);
    expect(get(r, 'a').mmol).toBeCloseTo(20);
  });

  it('solution volume edits map back to mmol', () => {
    const r = setVolume(build(), 'c', 2000); // 2 mL × 2.5 M = 5 mmol
    expect(get(r, 'c').mmol).toBeCloseTo(5);
  });

  it('solvent volume edit overrides concentration', () => {
    const r = setVolume(build(), 'f', 30000);
    expect(get(r, 'f').volume).toBe(30000);
    expect(get(scale(r, 2), 'f').volume).toBe(60000);
  });

  it('ignores non-positive or incomputable input', () => {
    const r = build();
    expect(setMass(r, 'a', 0)).toBe(r);
    expect(setVolume(r, 'a', 100)).toBe(r); // no density for the solid
  });
});

describe('scale / plan / remove', () => {
  it('scales amounts', () => {
    expect(get(scale(build(), 0.5), 'b').mmol).toBeCloseTo(10);
  });

  it('plans scale from a product target', () => {
    const r = planForProduct(build(), 'p', 1361.5, 50); // 10 mmol product at 50% → 20 mmol
    expect(r.refMmol).toBeCloseTo(20);
  });

  it('reassigns the reference when it is removed, keeping amounts', () => {
    const r = removeComponent(build(), 'a');
    expect(r.refId).toBe('b');
    expect(get(r, 'b').mmol).toBeCloseTo(20);
    expect(get(r, 'c').mmol).toBeCloseTo(11);
  });
});

describe('setRole', () => {
  it('moves the reference when the reference becomes a product', () => {
    const r = setRole(build(), 'a', 'product');
    expect(r.refId).toBe('b');
    expect(r.refMmol).toBeCloseTo(20);
  });
});

describe('scaling clears stale results', () => {
  it('drops the isolated product mass on scale and plan', () => {
    const r = setMass(build(), 'p', 1000);
    expect(get(scale(r, 2), 'p').mass).toBeUndefined();
    expect(get(planForProduct(r, 'p', 1361.5, 50), 'p').mass).toBeUndefined();
  });
});
