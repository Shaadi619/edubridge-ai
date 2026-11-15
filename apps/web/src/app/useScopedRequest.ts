import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export function useScopedRequest(scope: string | null) {
  const visit = useMemo(() => ({
    active: false,
    controller: null as AbortController | null,
  }), [scope]);

  useLayoutEffect(() => {
    visit.active = scope !== null;
    return () => {
      visit.active = false;
      visit.controller?.abort();
      visit.controller = null;
    };
  }, [scope, visit]);

  return useCallback((replacePending = true) => {
    if (!visit.active || (!replacePending && visit.controller)) return null;
    visit.controller?.abort();
    const controller = new AbortController();
    visit.controller = controller;
    const isCurrent = () => visit.active && visit.controller === controller && !controller.signal.aborted;
    return {
      signal: controller.signal,
      isCurrent,
      finish() {
        if (isCurrent()) visit.controller = null;
      },
    };
  }, [visit]);
}

export function useScopedQuery<T>(
  scope: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  errorMessage: string,
) {
  const startRequest = useScopedRequest(scope);
  const [result, setResult] = useState<{ scope: string; data: T | null } | null>(null);
  const refresh = useCallback(async (silent = false) => {
    if (scope === null) return;
    const request = startRequest();
    if (!request) return;
    try {
      const data = await load(request.signal);
      if (request.isCurrent()) setResult({ scope, data });
    } catch (error) {
      if (!request.isCurrent()) return;
      setResult(previous => previous?.scope === scope ? previous : { scope, data: null });
      if (!silent) toast.error(error instanceof Error ? error.message : errorMessage);
    } finally {
      request.finish();
    }
  }, [scope, startRequest, load, errorMessage]);

  useEffect(() => { void refresh(); }, [refresh]);

  const current = scope !== null && result?.scope === scope ? result : null;
  return { data: current?.data ?? null, loading: scope !== null && current === null, refresh };
}
