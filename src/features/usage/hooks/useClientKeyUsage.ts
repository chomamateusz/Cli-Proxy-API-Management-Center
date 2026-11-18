import { useEffect, useRef, useState } from 'react';
import {
  classifyClientKeyError,
  type ClassifiedClientKeyError,
} from '@/features/clientKeys/errors';
import { apiClient } from '@/services/api/client';
import { fleetUsageApi } from '@/services/api/fleetUsage';
import type { ClientKeyUsageQuery, ClientKeyUsageReport } from '@/types/fleetUsage';

export const USAGE_FETCH_DEBOUNCE_MS = 300;

export interface ClientKeyUsageState {
  report: ClientKeyUsageReport | null;
  loading: boolean;
  error: ClassifiedClientKeyError | null;
}

const INITIAL_STATE: ClientKeyUsageState = { report: null, loading: true, error: null };

export function useClientKeyUsage(
  query: ClientKeyUsageQuery,
  refreshKey: number
): ClientKeyUsageState {
  const [state, setState] = useState<ClientKeyUsageState>(INITIAL_STATE);
  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const parsed = JSON.parse(queryKey) as ClientKeyUsageQuery;
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      const revision = apiClient.getConnectionRevision();
      const current = () =>
        requestId === requestIdRef.current && revision === apiClient.getConnectionRevision();
      setState((previous) => ({ ...previous, loading: true }));
      fleetUsageApi.getClientKeyUsage(parsed).then(
        (report) => {
          if (current()) setState({ report, loading: false, error: null });
        },
        (error: unknown) => {
          if (current()) {
            setState((previous) => ({
              ...previous,
              loading: false,
              error: classifyClientKeyError(error),
            }));
          }
        }
      );
    }, USAGE_FETCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [queryKey, refreshKey]);

  return state;
}
