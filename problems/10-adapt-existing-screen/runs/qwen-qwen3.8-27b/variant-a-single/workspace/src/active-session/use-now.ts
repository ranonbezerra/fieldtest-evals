import { useEffect, useState } from 'react';

/** Returns the current time, re-rendering every `intervalMs` while non-null. */
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
