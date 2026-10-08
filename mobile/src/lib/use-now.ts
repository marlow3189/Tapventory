import { useEffect, useState } from 'react';

/** Aktualny czas (ms), odświeżany co `everyMs` — do napisów typu „trwa dłużej niż zwykle" bez wywoływania Date.now() podczas renderowania. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
