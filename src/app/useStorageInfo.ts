import { useEffect, useState } from 'react';
import { repoReady } from '../storage';

/** Where saved reactions live (null until known). */
export function useStorageInfo() {
  const [storage, setStorage] = useState<'local' | 'remote' | null>(null);
  useEffect(() => {
    repoReady.then(setStorage);
  }, []);
  return { storage, remote: storage === 'remote' };
}
