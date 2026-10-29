import { useEffect, useState } from 'react';
import { nextCode } from '../chem/runs';
import { repo, repoReady } from '../storage';

/**
 * Where saved reactions live (null until known), and the next free reaction
 * code from the saved list (offered when the code is empty).
 */
export function useStorageInfo(savedId: string | undefined) {
  const [storage, setStorage] = useState<'local' | 'remote' | null>(null);
  useEffect(() => {
    repoReady.then(setStorage);
  }, []);

  const [suggestedCode, setSuggestedCode] = useState('RXN-001');
  useEffect(() => {
    if (!storage) return;
    repo.list().then(
      (list) => setSuggestedCode(nextCode(list.filter((s) => s.id !== savedId).map((s) => s.meta?.code))),
      () => undefined,
    );
  }, [storage, savedId]);

  return { storage, remote: storage === 'remote', suggestedCode };
}
