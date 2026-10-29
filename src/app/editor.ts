// Opening the structure editor (Ketcher) from anywhere in the app.
import type { StructureEditorProps } from '../components/StructureEditor';

export type EditorRequest = Omit<StructureEditorProps, 'onClose'>;
export type OpenEditor = (req: EditorRequest) => void;
