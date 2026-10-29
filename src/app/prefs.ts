// Choices remembered in this browser (display style, units…).
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_UNITS, type Units } from '../units';

function load<T extends string>(key: string, options: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    return options.includes(v as T) ? (v as T) : options[0];
  } catch {
    return options[0];
  }
}

/** One of `options`, remembered under `key` (the first option when unset). */
export function usePref<T extends string>(key: string, options: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState(() => load(key, options));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* not remembered */
      }
    },
    [key],
  );
  return [value, set];
}

function loadUnits(): Units {
  try {
    return { ...DEFAULT_UNITS, ...JSON.parse(localStorage.getItem('units') ?? '{}') };
  } catch {
    return DEFAULT_UNITS;
  }
}

/** Display units of the reagent table. */
export function useUnits(): [Units, (u: Units) => void] {
  const [units, setUnits] = useState<Units>(loadUnits);
  useEffect(() => {
    try {
      localStorage.setItem('units', JSON.stringify(units));
    } catch {
      /* ignore */
    }
  }, [units]);
  return [units, setUnits];
}
