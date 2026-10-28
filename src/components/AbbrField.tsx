// Abbreviation of a compound in its properties panel: typed for this
// reaction, or taken automatically from the abbreviation table / library;
// "Add to table" makes it the default for the compound everywhere.
import type { MainModule } from '@rdkit/rdkit';
import { autoAbbr, entryFor } from '../chem/abbr';
import type { Component } from '../chem/stoich';
import { useI18n } from '../i18n';
import { assignAbbr, useAbbrs } from '../storage/abbrs';

interface Props {
  c: Component;
  rd: MainModule | null;
  onUpdate: (p: Partial<Component>) => void;
  onNotify: (msg: string) => void;
  onOpenAbbrs?: () => void;
}

export function AbbrField({ c, rd, onUpdate, onNotify, onOpenAbbrs }: Props) {
  const { t } = useI18n();
  const A = t.abbr;
  const table = useAbbrs() ?? [];
  const auto = autoAbbr(rd, c);
  const entry = entryFor(rd, c, table);
  const typed = c.abbr?.trim();

  const addToTable = async () => {
    if (!typed) return;
    try {
      const saved = await assignAbbr(rd, c, typed, (other) => confirm(A.conflict.replace('{a}', typed).replace('{name}', other.name)));
      if (!saved) return;
      // From now on it follows the table.
      onUpdate({ abbr: undefined });
      onNotify(A.saved.replace('{a}', typed).replace('{name}', c.name));
    } catch {
      onNotify(t.saveFailed);
    }
  };

  return (
    <div className="field abbr-field">
      <span>{A.field}</span>
      <div className="row">
        <input
          className="grow"
          value={c.abbr ?? ''}
          title={A.autoTip}
          placeholder={c.abbr === '' ? A.noneSet : auto ? A.auto.replace('{a}', auto) : A.fieldPh}
          onChange={(e) => onUpdate({ abbr: e.target.value || undefined })}
        />
        {c.abbr === '' ? (
          <button className="small ghost" onClick={() => onUpdate({ abbr: undefined })}>{A.restore}</button>
        ) : (
          !typed && auto && <button className="small ghost" onClick={() => onUpdate({ abbr: '' })}>{A.none}</button>
        )}
        {typed && typed !== entry?.abbr && (
          <button className="small" title={A.saveTip} onClick={addToTable}>{A.save}</button>
        )}
      </div>
      <p className="hint">
        {entry && <>{A.inTable.replace('{a}', entry.abbr)} · </>}
        {onOpenAbbrs && (
          <button className="link" onClick={onOpenAbbrs}>{A.manage}</button>
        )}
      </p>
    </div>
  );
}
