import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useState } from 'react';
import { loadRDKit } from '../chem/rdkit';

/** The RDKit module once loaded (null before), and whether loading failed. */
export function useRDKit(): { rd: MainModule | null; rdError: boolean } {
  const [rd, setRd] = useState<MainModule | null>(null);
  const [rdError, setRdError] = useState(false);
  useEffect(() => {
    loadRDKit().then(setRd, () => setRdError(true));
  }, []);
  return { rd, rdError };
}
