import type { MainModule } from '@rdkit/rdkit';
import { SYMBOL_BY_Z } from './elements';
import { hillFormula, molarMass, type Composition } from './formula';

declare global {
  interface Window {
    initRDKitModule?: (opts: { locateFile: () => string }) => Promise<MainModule>;
  }
}

let loading: Promise<MainModule> | null = null;

/** Lazily load the self-hosted RDKit WASM build (public/rdkit). */
export function loadRDKit(): Promise<MainModule> {
  if (loading) return loading;
  const base = import.meta.env.BASE_URL + 'rdkit/';
  loading = new Promise<MainModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = base + 'RDKit_minimal.js';
    script.onload = () => {
      window.initRDKitModule!({ locateFile: () => base + 'RDKit_minimal.wasm' }).then(resolve, reject);
    };
    script.onerror = () => reject(new Error('Failed to load RDKit'));
    document.head.appendChild(script);
  });
  loading.catch(() => (loading = null));
  return loading;
}

export function isValidSmiles(rd: MainModule, smiles: string): boolean {
  const mol = rd.get_mol(smiles);
  if (!mol) return false;
  mol.delete();
  return true;
}

/** Canonical SMILES (null when RDKit can't read it). */
export function canonicalSmiles(rd: MainModule, smiles: string): string | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}

export function smilesToSvg(rd: MainModule, smiles: string, width = 180, height = 130): string | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    return mol.get_svg_with_highlights(
      JSON.stringify({ width, height, clearBackground: false, bondLineWidth: 1.5, fixedFontSize: 13 }),
    );
  } finally {
    mol.delete();
  }
}

interface MolJson {
  defaults: { atom: { z: number; impHs: number } };
  molecules: { atoms: { z?: number; impHs?: number; isotope?: number }[] }[];
}

/** Molecular formula (Hill) and MW computed from a SMILES string. */
export function smilesInfo(rd: MainModule, smiles: string): { formula: string; mw: number } | null {
  const mol = rd.get_mol(smiles);
  if (!mol) return null;
  try {
    const json = JSON.parse(mol.get_json()) as MolJson;
    const comp: Composition = {};
    const d = json.defaults.atom;
    for (const m of json.molecules) {
      for (const a of m.atoms) {
        const z = a.z ?? d.z;
        let sym = SYMBOL_BY_Z[z];
        if (z === 1 && a.isotope === 2) sym = 'D';
        if (z === 1 && a.isotope === 3) sym = 'T';
        if (!sym) continue; // dummy atoms
        comp[sym] = (comp[sym] ?? 0) + 1;
        const h = a.impHs ?? d.impHs;
        if (h) comp.H = (comp.H ?? 0) + h;
      }
    }
    if (!Object.keys(comp).length) return null;
    return { formula: hillFormula(comp), mw: molarMass(comp) };
  } finally {
    mol.delete();
  }
}
