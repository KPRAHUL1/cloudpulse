/**
 * Polls an async function on an interval - this is what makes the dashboard
 * "real-time". Keeps the previous value while refetching so the UI never
 * flashes empty.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 5000,
  deps: unknown[] = []
) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: true,
  });

  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      if (mounted.current) setState({ data, error: null, loading: false });
    } catch (err: any) {
      if (mounted.current) {
        setState((prev) => ({
          data: prev.data,
          error: err?.message ?? 'Request failed',
          loading: false,
        }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setState((prev) => ({ ...prev, loading: prev.data === null }));
    load();

    if (intervalMs <= 0) return () => { mounted.current = false; };

    const id = setInterval(load, intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return { ...state, refresh: load };
}
