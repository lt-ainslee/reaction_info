import { ATOMIC_WEIGHT } from './elements';

export type Composition = Record<string, number>;

/**
 * Parse a molecular formula such as "C6H5Br", "Ca(OH)2", "[Cu(NH3)4]SO4" or
 * hydrates "CuSO4·5H2O" / "CuSO4.5H2O" / "CuSO4*5H2O".
 * Returns null if the formula is malformed or contains unknown elements.
 */
export function parseFormula(input: string): Composition | null {
  const formula = input.replace(/\s+/g, '');
  if (!formula) return null;
  const total: Composition = {};
  for (const part of formula.split(/[·•.*]/)) {
    if (!part) return null;
    const m = /^(\d+)(.*)$/.exec(part);
    const mult = m ? Number(m[1]) : 1;
    const comp = parseGroup(m ? m[2] : part);
    if (!comp) return null;
    addInto(total, comp, mult);
  }
  return total;
}

function parseGroup(s: string): Composition | null {
  const stack: Composition[] = [{}];
  let i = 0;
  const readCount = () => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(' || ch === '[') {
      stack.push({});
      i++;
    } else if (ch === ')' || ch === ']') {
      if (stack.length < 2) return null;
      i++;
      const group = stack.pop()!;
      addInto(stack[stack.length - 1], group, readCount());
    } else {
      const m = /^[A-Z][a-z]?/.exec(s.slice(i));
      if (!m || !(m[0] in ATOMIC_WEIGHT)) return null;
      i += m[0].length;
      const top = stack[stack.length - 1];
      top[m[0]] = (top[m[0]] ?? 0) + readCount();
    }
  }
  if (stack.length !== 1 || Object.keys(stack[0]).length === 0) return null;
  return stack[0];
}

function addInto(target: Composition, src: Composition, mult: number) {
  for (const [el, n] of Object.entries(src)) target[el] = (target[el] ?? 0) + n * mult;
}

export function molarMass(comp: Composition): number {
  let sum = 0;
  for (const [el, n] of Object.entries(comp)) sum += ATOMIC_WEIGHT[el] * n;
  return sum;
}

export function formulaMass(formula: string): number | null {
  const comp = parseFormula(formula);
  return comp ? molarMass(comp) : null;
}

/** Hill-system formula string: C first, H second, then alphabetical (alphabetical if no C). */
export function hillFormula(comp: Composition): string {
  const els = Object.keys(comp).filter((e) => comp[e] > 0);
  const hasC = 'C' in comp && comp.C > 0;
  els.sort((a, b) => {
    if (hasC) {
      const rank = (e: string) => (e === 'C' ? 0 : e === 'H' ? 1 : 2);
      const d = rank(a) - rank(b);
      if (d) return d;
    }
    return a.localeCompare(b);
  });
  return els.map((e) => (comp[e] === 1 ? e : `${e}${comp[e]}`)).join('');
}
