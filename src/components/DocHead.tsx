// Reaction title and code, save state, save / save as / download.
import type { Reaction } from '../chem/stoich';
import { useI18n } from '../i18n';

interface Props {
  rxn: Reaction;
  setRxn: (r: Reaction) => void;
  suggestedCode: string;
  dirty: boolean;
  savedId?: string;
  busy: boolean;
  onSave: (asNew: boolean) => void;
  onDownload: () => void;
}

export function DocHead({ rxn, setRxn, suggestedCode, dirty, savedId, busy, onSave, onDownload }: Props) {
  const { t } = useI18n();
  return (
    <div className="doc-head">
      <div className="title-block">
        <input
          className="title-input"
          value={rxn.title}
          placeholder={t.reactionTitlePh}
          aria-label={t.reactionTitle}
          onChange={(e) => setRxn({ ...rxn, title: e.target.value })}
        />
        <span className="code-field">
          <span className="code-label">{t.runs.code}</span>
          <input
            className="code-input"
            value={rxn.code ?? ''}
            placeholder={t.runs.codePh.replace('{code}', suggestedCode)}
            aria-label={t.runs.code}
            onChange={(e) => setRxn({ ...rxn, code: e.target.value || undefined })}
          />
          {!rxn.code && (
            <button className="link small no-print" onClick={() => setRxn({ ...rxn, code: suggestedCode })}>{t.runs.autoCode}</button>
          )}
        </span>
      </div>
      <div className="doc-actions no-print">
        <span className={'save-state ' + (dirty ? 'dirty' : '')}>
          {dirty ? t.unsaved : savedId ? t.savedState : ''}
        </span>
        <button onClick={() => onSave(false)} disabled={busy || (!dirty && !!savedId)}>
          {t.save}
        </button>
        {savedId && (
          <button className="ghost" onClick={() => onSave(true)} title={t.saveAsTip}>
            {t.saveAs}
          </button>
        )}
        <button className="ghost" title={t.downloadTip} disabled={!rxn.components.length} onClick={onDownload}>
          {t.download}
        </button>
      </div>
    </div>
  );
}
