import { useEffect, useRef, useState } from 'react';
import {
  classifyClientKeyError,
  type ClassifiedClientKeyError,
} from '@/features/clientKeys/errors';
import { apiClient } from '@/services/api/client';
import { fleetUsageApi } from '@/services/api/fleetUsage';
import {
  EMPTY_LIVE_FEED,
  LIVE_POLL_MS,
  LIVE_ROW_CAP,
  afterSeqFor,
  applyRecentPage,
  type LiveFeedState,
} from '../recentRequests';

export interface RecentRequestsOptions {
  active: boolean;
  keyFilter: string;
}

export interface RecentRequestsState {
  feed: LiveFeedState;
  error: ClassifiedClientKeyError | null;
}

export function useRecentRequests({ active, keyFilter }: RecentRequestsOptions) {
  const [state, setState] = useState<RecentRequestsState>({ feed: EMPTY_LIVE_FEED, error: null });
  const feedRef = useRef<LiveFeedState>(EMPTY_LIVE_FEED);
  const filterRef = useRef(keyFilter);
  const revisionRef = useRef(apiClient.getConnectionRevision());

  useEffect(() => {
    if (filterRef.current !== keyFilter) {
      filterRef.current = keyFilter;
      feedRef.current = EMPTY_LIVE_FEED;
      setState({ feed: EMPTY_LIVE_FEED, error: null });
    }
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      const revision = apiClient.getConnectionRevision();
      if (revision !== revisionRef.current) {
        revisionRef.current = revision;
        feedRef.current = EMPTY_LIVE_FEED;
      }
      const before = feedRef.current;
      let delay = LIVE_POLL_MS;
      try {
        const page = await fleetUsageApi.getRecentRequests({
          limit: LIVE_ROW_CAP,
          key: keyFilter || undefined,
          afterSeq: afterSeqFor(before),
        });
        if (cancelled || revision !== apiClient.getConnectionRevision()) return;
        const next = applyRecentPage(before, page);
        feedRef.current = next;
        setState({ feed: next, error: null });
        if (!next.loaded) delay = 0;
      } catch (error: unknown) {
        if (cancelled) return;
        setState((previous) => ({ ...previous, error: classifyClientKeyError(error) }));
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, keyFilter]);

  return state;
}
