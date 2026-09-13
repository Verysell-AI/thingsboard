import { useEffect, useState } from 'react';

function read(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/** A boolean UI preference that survives reloads (falls back silently when storage is unavailable). */
export function useStoredFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => read(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0');
    } catch {
      // private mode or blocked storage: the preference simply does not persist
    }
  }, [key, value]);
  return [value, setValue] as const;
}
