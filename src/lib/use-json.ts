"use client";

import { useEffect, useState } from "react";

export interface JsonState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Minimal fetch hook for local JSON endpoints. `version` forces a refetch after mutations.
 * Keeps the previous data while reloading to avoid flicker.
 */
export function useJson<T>(url: string | null, version = 0): JsonState<T> {
  const [state, setState] = useState<JsonState<T> & { key: string | null }>({
    data: null,
    error: null,
    loading: false,
    key: null,
  });
  const key = url ? `${url}#${version}` : null;

  if (state.key !== key) {
    // Reset synchronously when the target changes (no stale data for another resource).
    const sameResource = state.key?.split("#")[0] === url;
    setState({ data: sameResource ? state.data : null, error: null, loading: Boolean(url), key });
  }

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      })
      .then((data) => setState((s) => (s.key === key ? { ...s, data, loading: false } : s)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) =>
          s.key === key
            ? { ...s, error: error instanceof Error ? error.message : "Error", loading: false }
            : s,
        );
      });
    return () => controller.abort();
  }, [url, key]);

  return { data: state.data, error: state.error, loading: state.loading };
}
