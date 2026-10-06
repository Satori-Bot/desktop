import { useEffect, useRef, useState } from "react";

/** Follow saved values while pristine, without discarding an in-progress edit. */
export function useSavedDraft<T>(saved: T, equal: (a: T, b: T) => boolean) {
  const [draft, setDraft] = useState(saved);
  const previous = useRef(saved);
  useEffect(() => {
    const baseline = previous.current;
    previous.current = saved;
    if (equal(baseline, saved)) return;
    setDraft((current) => (equal(current, baseline) ? saved : current));
  }, [saved, equal]);
  return [draft, setDraft] as const;
}
