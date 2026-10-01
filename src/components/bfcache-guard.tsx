"use client";

import { useEffect } from "react";

// When the browser restores a page from its back-forward cache (bfcache) —
// e.g. pressing Back after sign-out — it shows an old in-memory snapshot
// without re-checking the session. This forces a real reload whenever that
// happens, so the server-side auth check in (dashboard)/layout.tsx runs
// again and bounces to /login if the session is actually gone.
export function BfcacheGuard() {
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return null;
}