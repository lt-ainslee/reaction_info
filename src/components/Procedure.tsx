// Procedure field: the rich-text editor (lazy), with a read-only rendering while it loads.
import { lazy, Suspense, useMemo } from 'react';
import type { Reaction } from '../chem/stoich';
import { procedureOf, toHtml } from '../procedure/doc';

const ProcedureEditor = lazy(() => import('./ProcedureEditor'));

interface Props {
  rxn: Reaction;
  setRxn: (r: Reaction) => void;
  onNotify: (msg: string) => void;
}

export function Procedure({ rxn, setRxn, onNotify }: Props) {
  // Stable while unchanged, so the editor can tell outside changes from its own.
  const doc = useMemo(() => procedureOf(rxn), [rxn.procedure, rxn.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Suspense
      fallback={
        <div className="pe pe-loading">
          <div className="pe-toolbar" />
          <div className="pe-body"><div className="pe-content" dangerouslySetInnerHTML={{ __html: toHtml(doc) }} /></div>
        </div>
      }
    >
      <ProcedureEditor value={doc} onChange={(procedure, notes) => setRxn({ ...rxn, procedure, notes })} onNotify={onNotify} />
    </Suspense>
  );
}
