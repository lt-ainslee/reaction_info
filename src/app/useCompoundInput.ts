// Adding compounds to the reaction: from the search, an inventory bottle,
// pasted / typed / file input, or a drawing.
import type { MainModule } from '@rdkit/rdkit';
import type { Dispatch, SetStateAction } from 'react';
import { componentFromLot, type ReagentLot } from '../chem/lots';
import { groupFragments, parseInputText } from '../chem/parseInput';
import { compoundKey, resolveParsed, type CompoundData, type Resolved } from '../chem/resolve';
import { addComponent, mergeComponents, newComponent, type Reaction, type Role } from '../chem/stoich';
import type { ApplyMode } from '../components/ReactionInput';
import { useI18n } from '../i18n';

export function useCompoundInput(rd: MainModule | null, rxn: Reaction, setRxn: Dispatch<SetStateAction<Reaction>>, notify: (msg: string) => void) {
  const { t, lang } = useI18n();

  const add = (data: CompoundData, role: Role) => setRxn((r) => addComponent(r, newComponent({ ...data, role })));

  /** A bottle from the inventory: structure, physical data, purity / concentration and the lot link. */
  const addLot = (lot: ReagentLot, role: Role) => setRxn((r) => addComponent(r, newComponent({ ...componentFromLot(lot), role })));

  const applyInput = (res: Resolved, mode: ApplyMode) =>
    setRxn((r) => {
      const explicitEquiv = new Set<string>();
      const incoming = res.items.map(({ data, role, equiv }) => {
        const c = newComponent({ ...data, role, ...(equiv ? { equiv } : {}) });
        if (equiv) explicitEquiv.add(c.id);
        return c;
      });
      const next = mergeComponents(r, incoming, (c) => compoundKey(rd, c), {
        replace: mode === 'replace',
        hasAgents: res.hasAgents,
        explicitEquiv,
      });
      const cond = res.conditions.join(', ');
      const conditions = !cond ? r.conditions : mode === 'replace' || !r.conditions ? cond : `${r.conditions}, ${cond}`;
      return { ...next, conditions };
    });

  /** Import a drawn reaction (or a set of drawn compounds). */
  const importDrawing = async ({ text, isReaction }: { text: string; isReaction: boolean }) => {
    // Unconnected drawn compounds come as one dotted SMILES: one compound per line instead.
    const input = isReaction ? text : groupFragments(text).join('\n');
    const parsed = parseInputText(rd, input);
    if (!parsed) return;
    const res = await resolveParsed(parsed, rd, lang);
    applyInput(res, isReaction && rxn.components.length ? 'replace' : 'add');
    notify(t.importedN.replace('{n}', String(res.items.length)));
  };

  return { add, addLot, applyInput, importDrawing };
}
