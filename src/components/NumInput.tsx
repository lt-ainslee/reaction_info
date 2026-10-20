import { useState } from 'react';
import { fmt } from '../units';

interface Props {
  value: number | undefined;
  onCommit: (v: number) => void;
  sig?: number;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  /** Allow committing an empty field (calls onClear). */
  onClear?: () => void;
}

/**
 * Numeric cell: shows the formatted value; while focused it keeps the raw
 * text, and commits on blur / Enter (Escape reverts).
 */
export function NumInput({ value, onCommit, sig = 4, placeholder, title, disabled, className, onClear }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim().replace(/[,，\s]/g, '');
    setDraft(null);
    if (text === '') {
      onClear?.();
      return;
    }
    const v = Number(text);
    if (Number.isFinite(v) && v > 0) onCommit(v);
  };

  return (
    <input
      className={'num ' + (className ?? '')}
      inputMode="decimal"
      value={draft ?? fmt(value, sig)}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      onFocus={(e) => {
        setDraft(fmt(value, 8));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
