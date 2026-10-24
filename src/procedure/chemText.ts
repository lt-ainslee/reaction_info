// Typing helpers for procedures: which digits of a typed word are formula
// subscripts (CH2Cl2 → CH₂Cl₂), and plain symbol shortcuts (-> → →).

const ELEMENTS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd ' +
    'In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U ' +
    // common group abbreviations
    'Ph Me Et Bu Bn Bz Ts Ms Tf Cy R X L').split(' '),
);

/**
 * Indices of the characters in `token` that should be subscripts, or null
 * when the token doesn't read as a formula (every letter must belong to an
 * element / group symbol, and a subscript must follow a symbol or ")").
 */
export function formulaSubscripts(token: string): number[] | null {
  const out: number[] = [];
  let depth = 0;
  let prev: 'sym' | 'close' | 'open' | 'digit' | null = null;
  for (let i = 0; i < token.length; ) {
    const ch = token[i];
    if (/[A-Z]/.test(ch)) {
      const two = token.slice(i, i + 2);
      if (/^[A-Z][a-z]$/.test(two) && ELEMENTS.has(two)) i += 2;
      else if (ELEMENTS.has(ch)) i += 1;
      else return null;
      prev = 'sym';
    } else if (/\d/.test(ch)) {
      if (prev !== 'sym' && prev !== 'close' && prev !== 'digit') return null;
      out.push(i++);
      prev = 'digit';
    } else if (ch === '(') {
      depth++;
      prev = 'open';
      i++;
    } else if (ch === ')') {
      if (prev === 'open' || prev === null) return null;
      depth--;
      prev = 'close';
      i++;
    } else {
      return null;
    }
  }
  return out.length && depth >= 0 ? out : null;
}

/** Typed word (after a boundary) ending with a trigger character. */
export const FORMULA_FIND = /(?:^|[\s(（，,;；、:：/])([A-Z][A-Za-z0-9()]*\d[A-Za-z0-9()]*)([\s,.;:)）。，；、/])$/;

/** Plain shortcuts: [pattern matched at the cursor, replacement for the whole match]. */
export const SYMBOL_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/->$/, () => '→'],
  [/<=>$/, () => '⇌'],
  [/\+-$/, () => '±'],
  [/(\d ?)oC$/, (m) => `${m[1]}°C`],
  [/(\d ?)u(L|mol|M|g)$/, (m) => `${m[1]}µ${m[2]}`],
  [/(\d )x $/, (m) => `${m[1]}× `],
];

/** "[M+H]+", "[M+Na]+" — the trailing charge typed after "]" becomes a superscript. */
export const CHARGE_FIND = /\[M[+\-−][A-Za-z0-9]{1,6}\]([+\-])$/;
