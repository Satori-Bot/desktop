import { useEffect, useRef } from "react";

/** In-flight work must not reopen UI or start follow-on work after dismissal. */
export function usePageActive() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
