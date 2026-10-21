// Ketcher structure / reaction editor in a modal. Loaded lazily (React.lazy):
// Ketcher plus its Indigo WASM is several MB and only needed when drawing.
import type { Ketcher } from 'ketcher-core';
import { Editor } from 'ketcher-react';
import 'ketcher-react/dist/index.css';
import { StandaloneStructServiceProvider } from 'ketcher-standalone/dist/binaryWasm';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

// One provider (and Indigo worker) for the whole session.
const provider = new StandaloneStructServiceProvider();

export interface StructureEditorProps {
  /** SMILES / reaction SMILES / molfile to start from. */
  initial?: string;
  /** 'molecule': a single compound; 'reaction': a scheme or several compounds. */
  mode: 'molecule' | 'reaction';
  /** Editing the existing reaction (changes labels; the result replaces the scheme). */
  editing?: boolean;
  onApply: (result: { text: string; isReaction: boolean }) => void;
  onClose: () => void;
}

export default function StructureEditor({ initial, mode, editing, onApply, onClose }: StructureEditorProps) {
  const { t } = useI18n();
  const ketcherRef = useRef<Ketcher | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = async () => {
    const k = ketcherRef.current;
    if (!k) return;
    try {
      const isReaction = k.containsReaction();
      const smiles = (await k.getSmiles()).trim();
      if (!smiles) {
        setError(t.editorEmpty);
        return;
      }
      onApply({ text: smiles, isReaction });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t.drawTitle}>
      <div className="modal editor-modal">
        <header>
          <h3>{mode === 'reaction' ? (editing ? t.editReaction : t.drawReaction) : t.drawMolecule}</h3>
          <span className="hint grow">
            {mode === 'reaction' ? (editing ? t.editReactionHint : t.drawReactionHint) : t.drawMoleculeHint}
          </span>
          <button className="icon" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <div className="editor-host">
          {!ready && <p className="muted center editor-loading">{t.editorLoading}</p>}
          <Editor
            staticResourcesUrl={import.meta.env.BASE_URL}
            structServiceProvider={provider}
            errorHandler={(m) => setError(String(m))}
            disableMacromoleculesEditor
            onInit={(k) => {
              ketcherRef.current = k;
              // Handle for scripted (e2e) tests.
              (window as unknown as { __ketcher?: Ketcher }).__ketcher = k;
              setReady(true);
              if (initial) k.setMolecule(initial).catch(() => setError(t.structureInvalid));
            }}
          />
        </div>
        <footer className="row">
          {error && <span className="warn grow">{error}</span>}
          <span className="grow" />
          <button className="ghost" onClick={onClose}>{t.cancel}</button>
          <button onClick={apply} disabled={!ready}>{mode === 'reaction' ? (editing ? t.replaceEquation : t.useDrawing) : t.useStructure}</button>
        </footer>
      </div>
    </div>
  );
}
