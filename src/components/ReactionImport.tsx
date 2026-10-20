import type { MainModule } from '@rdkit/rdkit';
import { useState } from 'react';
import { resolveOne, splitNameReaction, splitReactionSmiles, type CompoundData } from '../chem/resolve';
import type { Role } from '../chem/stoich';
import { useI18n } from '../i18n';

interface Props {
  rd: MainModule | null;
  onImport: (items: { data: CompoundData; role: Role }[]) => void;
}

export function ReactionImport({ rd, onImport }: Props) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  const run = async () => {
    const s = text.trim();
    if (!s) return;
    const sm = splitReactionSmiles(s);
    const groups: [string, Role][] = sm
      ? [
          ...sm.reactants.map((x) => [x, 'reactant'] as [string, Role]),
          ...sm.agents.map((x) => [x, 'reagent'] as [string, Role]),
          ...sm.products.map((x) => [x, 'product'] as [string, Role]),
        ]
      : (() => {
          const nm = splitNameReaction(s);
          return nm
            ? [...nm.reactants.map((x) => [x, 'reactant'] as [string, Role]), ...nm.products.map((x) => [x, 'product'] as [string, Role])]
            : [];
        })();
    if (!groups.length) {
      setFailed([s]);
      return;
    }
    setBusy(true);
    setFailed([]);
    const items: { data: CompoundData; role: Role }[] = [];
    const bad: string[] = [];
    for (const [q, role] of groups) {
      const data = await resolveOne(q, rd, lang);
      if (data) items.push({ data, role });
      else bad.push(q);
    }
    setBusy(false);
    setFailed(bad);
    if (items.length) {
      onImport(items);
      if (!bad.length) setText('');
    }
  };

  return (
    <div className="import">
      <div className="row">
        <input
          className="grow mono"
          value={text}
          placeholder={t.importPh}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          spellCheck={false}
        />
        <button onClick={run} disabled={busy}>{busy ? t.importing : t.importBtn}</button>
      </div>
      <p className="hint">{t.importHint}</p>
      {failed.length > 0 && <p className="warn">{t.importFailed}{failed.join('、')}</p>}
    </div>
  );
}
