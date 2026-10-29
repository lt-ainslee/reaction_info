import { useCallback, useState } from 'react';

/** A short message shown as a toast for a few seconds. */
export function useNotify(): { flash: string | null; notify: (msg: string) => void } {
  const [flash, setFlash] = useState<string | null>(null);
  const notify = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3500);
  }, []);
  return { flash, notify };
}
