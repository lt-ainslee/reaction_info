import type { MainModule } from '@rdkit/rdkit';
import { useEffect, useMemo, useRef, useState } from 'react';
import { detectFormat, parseInputText, type ParsedInput } from '../chem/parseInput';
import { resolveParsed, type Resolved } from '../chem/resolve';
import { useI18n } from '../i18n';

export type ApplyMode = 'add' | 'replace';

interface Props {
  rd: MainModule | null;
  hasComponents: boolean;
  /** Current equation as editable text (reaction SMILES). */
  currentEquation: () => string;
  onApply: (r: Resolved, mode: ApplyMode) => void;
}

const STRUCTURED = new Set(['cdxml', 'rxn', 'molfile']);
const isEditable = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

export function ReactionInput({ rd, hasComponents, currentEquation, onApply }: Props) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  /** Large structured payloads (CDXML, molfiles) are kept out of the textarea. */
  const [payload, setPayload] = useState<{ text: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const source = payload?.text ?? text;
  const parsed: ParsedInput | null = useMemo(() => (source.trim() ? parseInputText(rd, source) : null), [rd, source]);

  const takeText = (raw: string, label?: string) => {
    const fmt = detectFormat(raw);
    setMessage(null);
    if (STRUCTURED.has(fmt)) {
      setPayload({ text: raw, label: label ?? t.formats[fmt as 'cdxml'] });
      setText('');
    } else {
      setPayload(null);
      setText(raw.trim());
    }
  };

  const handleClipboard = (data: DataTransfer | null): boolean => {
    if (!data) return false;
    const plain = data.getData('text/plain');
    const html = data.getData('text/html');
    const cdxmlInHtml = /<CDXML[\s>]/i.test(html) ? html.slice(html.search(/<\?xml|<CDXML/i)) : '';
    if (plain.trim() || cdxmlInHtml) {
      takeText(cdxmlInHtml || plain);
      return true;
    }
    if ([...data.items].some((i) => i.type.startsWith('image/'))) {
      setMessage({ kind: 'warn', text: t.pasteImage });
      return true;
    }
    return false;
  };

  // Ctrl+V anywhere on the page (outside other inputs) goes to this box.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(document.activeElement)) return;
      if (handleClipboard(e.clipboardData)) {
        e.preventDefault();
        boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const readFile = async (f: File) => {
    if (/\.cdx$/i.test(f.name)) {
      setMessage({ kind: 'warn', text: t.cdxBinary });
      return;
    }
    takeText(await f.text(), f.name);
  };

  const apply = async (mode: ApplyMode) => {
    if (!parsed) {
      setMessage({ kind: 'warn', text: t.importFailed + source.slice(0, 60) });
      return;
    }
    setBusy(true);
    try {
      const r = await resolveParsed(parsed, rd, lang);
      if (r.items.length || r.conditions.length) onApply(r, mode);
      const parts = [t.importedN.replace('{n}', String(r.items.length))];
      if (r.conditions.length) parts.push(`${t.conditions}: ${r.conditions.join(', ')}`);
      if (r.failed.length) parts.push(t.importFailed + r.failed.join('、'));
      setMessage({ kind: r.failed.length || !r.items.length ? 'warn' : 'ok', text: parts.join(' · ') });
      if (r.items.length && !r.failed.length) {
        setText('');
        setPayload(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = parsed && (
    <p className="hint">
      {t.detected}: {t.formats[parsed.source]}
      {parsed.isReaction
        ? ` · ${t.roles.reactant} ${parsed.reactants.length} · ${t.agentsLabel} ${parsed.agents.length} · ${t.roles.product} ${parsed.products.length}`
        : ` · ${t.molecules} ${parsed.molecules.length}`}
    </p>
  );

  return (
    <div
      ref={boxRef}
      className={'import' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) readFile(f);
        else handleClipboard(e.dataTransfer);
      }}
    >
      {payload ? (
        <div className="payload">
          <span className="chip">📄 {payload.label} · {(payload.text.length / 1024).toFixed(1)} KB</span>
          <button className="icon" aria-label={t.clear} onClick={() => setPayload(null)}>×</button>
        </div>
      ) : (
        <textarea
          className="mono"
          rows={2}
          value={text}
          placeholder={t.importPh}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const raw = e.clipboardData.getData('text/plain');
            if (STRUCTURED.has(detectFormat(raw)) || (!raw && handleClipboard(e.clipboardData))) {
              e.preventDefault();
              if (raw) takeText(raw);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply(hasComponents ? 'replace' : 'add');
          }}
        />
      )}
      {summary}
      <div className="row">
        <button onClick={() => apply('add')} disabled={busy || !source.trim()}>
          {busy ? t.importing : hasComponents ? t.addToReaction : t.importBtn}
        </button>
        {hasComponents && (
          <button onClick={() => apply('replace')} disabled={busy || !source.trim()} title={t.replaceTip}>
            {t.replaceEquation}
          </button>
        )}
        {hasComponents && (
          <button
            className="ghost"
            onClick={() => {
              setPayload(null);
              setText(currentEquation());
              setMessage({ kind: 'ok', text: t.editHint });
            }}
          >
            {t.editEquation}
          </button>
        )}
        <button className="ghost" onClick={() => fileRef.current?.click()}>{t.openFile}</button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".cdxml,.cdx,.mol,.sdf,.sd,.rxn,.smi,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <details className="hint">
        <summary>{t.chemdrawHowTo}</summary>
        <ol>
          {t.chemdrawSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
      {message && <p className={message.kind === 'warn' ? 'warn' : 'ok'}>{message.text}</p>}
    </div>
  );
}
