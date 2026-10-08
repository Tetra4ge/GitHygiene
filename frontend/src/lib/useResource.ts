import { useCallback, useEffect, useState } from 'react';
import { apiError } from './api';

/**
 * Loads a gateway resource on mount and exposes a reload trigger.
 *
 * State is only written from promise callbacks, never synchronously in the effect
 * body — that is what React's set-state-in-effect rule asks for, and it also gives
 * us a cancellation guard so an in-flight request can't write into an unmounted panel.
 *
 * `fetcher` must be referentially stable (wrap it in useCallback) or the effect
 * will refetch on every render.
 */
export function useResource<T>(fetcher: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(apiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher, reloadKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  return { data, setData, loading, error, setError, reload };
}
