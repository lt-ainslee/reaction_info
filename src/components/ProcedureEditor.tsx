// Rich-text procedure editor (Tiptap, lazy-loaded): formatting toolbar,
// tables, chemistry auto-formatting, full screen and "copy as SI".
import { EditorState } from '@tiptap/pm/state';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChemTypography } from '../procedure/ChemTypography';
import { Observation } from '../procedure/Observation';
import { toHtml, toPlainText, type ProcDoc } from '../procedure/doc';
import { useI18n } from '../i18n';

export interface ProcedureEditorProps {
  value: ProcDoc;
  onChange: (doc: ProcDoc, text: string) => void;
  onNotify: (msg: string) => void;
}

/** Put a procedure on the clipboard as HTML (keeps sub/superscripts in Word) plus plain text. */
export async function copyProcedure(doc: ProcDoc, observation?: string) {
  const html = toHtml(doc, { observation });
  const text = toPlainText(doc, { observation });
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
    ]);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

function Btn({ on, disabled, title, onClick, children }: { on?: boolean; disabled?: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={'pe-btn' + (on ? ' on' : '')}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      // Keep the editor's selection when clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, full, setFull, onCopy }: { editor: Editor; full: boolean; setFull: (f: boolean) => void; onCopy: () => void }) {
  const { t } = useI18n();
  const p = t.proc;
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      heading: e.isActive('heading'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      obs: e.isActive('observation'),
      table: e.isActive('table'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="pe-toolbar" role="toolbar">
      <div className="pe-group">
        <Btn title={p.bold} on={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
        <Btn title={p.italic} on={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
        <Btn title={p.underline} on={s.underline} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
        <Btn title={p.strike} on={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
        <Btn title={p.sub} on={s.sub} onClick={() => c().unsetSuperscript().toggleSubscript().run()}>x<sub>2</sub></Btn>
        <Btn title={p.sup} on={s.sup} onClick={() => c().unsetSubscript().toggleSuperscript().run()}>x<sup>2</sup></Btn>
      </div>
      <div className="pe-group">
        <Btn title={p.heading} on={s.heading} onClick={() => c().toggleHeading({ level: 3 }).run()}>H</Btn>
        <Btn title={p.ordered} on={s.ordered} onClick={() => c().toggleOrderedList().run()}>1.</Btn>
        <Btn title={p.bullet} on={s.bullet} onClick={() => c().toggleBulletList().run()}>•</Btn>
        <Btn title={p.observationTip} on={s.obs} onClick={() => c().toggleObservation().run()}>{p.observation}</Btn>
        <Btn title={p.quote} on={s.quote} onClick={() => c().toggleBlockquote().run()}>❝</Btn>
        <Btn title={p.hr} onClick={() => c().setHorizontalRule().run()}>—</Btn>
        <Btn title={p.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
      </div>
      {s.table && (
        <div className="pe-group">
          <Btn title={p.addRow} onClick={() => c().addRowAfter().run()}>{p.rowShort[0]}</Btn>
          <Btn title={p.addCol} onClick={() => c().addColumnAfter().run()}>{p.rowShort[1]}</Btn>
          <Btn title={p.delRow} onClick={() => c().deleteRow().run()}>{p.rowShort[2]}</Btn>
          <Btn title={p.delCol} onClick={() => c().deleteColumn().run()}>{p.rowShort[3]}</Btn>
          <Btn title={p.delTable} onClick={() => c().deleteTable().run()}>✕▦</Btn>
        </div>
      )}
      <div className="pe-group">
        <Btn title={p.undo} disabled={!s.undo} onClick={() => c().undo().run()}>↺</Btn>
        <Btn title={p.redo} disabled={!s.redo} onClick={() => c().redo().run()}>↻</Btn>
        <Btn title={p.clear} onClick={() => c().unsetAllMarks().clearNodes().run()}>⌫</Btn>
      </div>
      <div className="pe-group pe-right">
        <button type="button" className="ghost small" onClick={onCopy}>{p.copySi}</button>
        <Btn title={full ? p.collapse : p.expand} on={full} onClick={() => setFull(!full)}>{full ? '⤡' : '⤢'}</Btn>
      </div>
    </div>
  );
}

export default function ProcedureEditor({ value, onChange, onNotify }: ProcedureEditorProps) {
  const { t } = useI18n();
  const [full, setFull] = useState(false);
  // The last document this editor emitted (or loaded), to tell our own updates from outside ones.
  const last = useRef<ProcDoc>(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, code: false, codeBlock: false, link: { openOnClick: false, autolink: true } }),
      Subscript,
      Superscript,
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: t.proc.ph }),
      Observation.configure({ label: t.proc.observation }),
      ChemTypography,
    ],
    content: value,
    editorProps: { attributes: { class: 'pe-content', spellcheck: 'false' } },
    onUpdate: ({ editor: e }) => {
      const doc = e.getJSON() as ProcDoc;
      last.current = doc;
      onChangeRef.current(doc, toPlainText(doc));
    },
  });

  // Another reaction was opened (or the draft restored): load it and drop the undo history.
  useEffect(() => {
    if (!editor || value === last.current) return;
    last.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
    editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
  }, [value, editor]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    document.body.classList.add('pe-full-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('pe-full-open');
    };
  }, [full]);

  if (!editor) return null;
  const copy = () =>
    copyProcedure(editor.getJSON() as ProcDoc, t.proc.observation).then(
      () => onNotify(t.proc.copied),
      () => onNotify(t.loadFailed),
    );

  return (
    <div className={'pe' + (full ? ' pe-full' : '')}>
      <Toolbar editor={editor} full={full} setFull={setFull} onCopy={copy} />
      <EditorContent editor={editor} className="pe-body" />
      <p className="hint pe-hint">{t.proc.autoHint}</p>
    </div>
  );
}
