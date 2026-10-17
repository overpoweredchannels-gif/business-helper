import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Guards an organization-scoped catalog load against account changes while the
 * component stays mounted.
 *
 * - `requestRef`: bump before each load; a loader must ignore its response when
 *   the ref no longer matches (stale request, e.g. after logout/navigation).
 * - `invalidate()`: bumps the request ref and runs `onInvalidate` (the caller
 *   clears old-scope rows and draft selections immediately).
 * - Auth observation: the parent layout does not watch auth state, so this
 *   hook subscribes itself. Sign-out, or sign-in as a different user while
 *   mounted, invalidates immediately. A token refresh for the same user is not
 *   a scope change and invalidates nothing.
 * - Unmount invalidates in-flight requests so late responses cannot commit.
 */
export function useCatalogScopeGuard(onInvalidate: () => void) {
  const requestRef = useRef(0);
  const scopeRef = useRef<string | null>(null);

  const invalidate = useCallback(() => {
    requestRef.current += 1;
    onInvalidate();
  }, [onInvalidate]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;
      if (event === "SIGNED_OUT" || (userId && scopeRef.current && userId !== scopeRef.current)) {
        scopeRef.current = userId;
        invalidate();
      } else if (userId && !scopeRef.current) {
        scopeRef.current = userId;
      }
    });
    return () => {
      // In-flight loads must not commit after unmount.
      requestRef.current += 1;
      subscription.unsubscribe();
    };
  }, [invalidate]);

  return { requestRef, invalidate };
}
