import { useEffect, useRef } from 'react';
import { MINUTE_MS } from '@/utils/time/durations';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { lastQuotaReadingAtFrom, readQuotaReadingLog } from '../quotaReadings';
import type { LoadQuotaOptions, QuotaLoadFailure } from './useQuotaBatchLoader';

export const QUOTA_AUTO_REFRESH_MS = 10 * MINUTE_MS;
// Claude's usage endpoint answers 429 when polled too often; a limited account is left alone.
export const QUOTA_RATE_LIMIT_BACKOFF_MS = 30 * MINUTE_MS;
// Timers drift, so a load a little under one interval ago still counts as recent.
const RECENT_SLACK_MS = MINUTE_MS;

const RATE_LIMITED = 429;
const REVOKED_STATUSES = new Set([401, 403]);

export function pickAutoRefreshTargets(
  targets: readonly QuotaFileEntry[],
  nowMs: number,
  lastLoadedAt: (cacheKey: string) => number | null,
  backoffUntil: ReadonlyMap<string, number>
): QuotaFileEntry[] {
  return targets.filter((entry) => {
    const key = getQuotaCacheKey(entry.file);
    if ((backoffUntil.get(key) ?? 0) > nowMs) return false;
    const last = lastLoadedAt(key);
    return last === null || nowMs - last >= QUOTA_AUTO_REFRESH_MS - RECENT_SLACK_MS;
  });
}

export const shouldSurfaceQuietFailure = (
  status: number | undefined,
  failedLastTick: boolean
): boolean =>
  status !== RATE_LIMITED &&
  (failedLastTick || (status !== undefined && REVOKED_STATUSES.has(status)));

export function useQuotaAutoRefresh(
  targets: QuotaFileEntry[],
  enabled: boolean,
  loadQuota: (
    targets: QuotaFileEntry[],
    options?: LoadQuotaOptions
  ) => Promise<QuotaLoadFailure[] | null>,
  reloadList: () => Promise<void>
) {
  const targetsRef = useRef(targets);
  const loadRef = useRef(loadQuota);
  const reloadListRef = useRef(reloadList);
  // Read at tick time, so a changing list does not restart the interval.
  useEffect(() => {
    targetsRef.current = targets;
    loadRef.current = loadQuota;
    reloadListRef.current = reloadList;
  }, [targets, loadQuota, reloadList]);
  const backoffRef = useRef(new Map<string, number>());
  const failedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      void reloadListRef.current();
      const nowMs = Date.now();
      const readings = readQuotaReadingLog(nowMs);
      const due = pickAutoRefreshTargets(
        targetsRef.current,
        nowMs,
        (key) => lastQuotaReadingAtFrom(readings, key),
        backoffRef.current
      );
      const failedBefore = failedRef.current;
      const failures = await loadRef.current(due, {
        quiet: true,
        surfaceFailure: ({ cacheKey, status }) =>
          shouldSurfaceQuietFailure(status, failedBefore.has(cacheKey)),
      });
      if (failures === null) return;
      const failed = new Set(failedBefore);
      due.forEach((entry) => failed.delete(getQuotaCacheKey(entry.file)));
      failures.forEach(({ cacheKey, status }) => {
        if (status === RATE_LIMITED) {
          backoffRef.current.set(cacheKey, nowMs + QUOTA_RATE_LIMIT_BACKOFF_MS);
        } else {
          failed.add(cacheKey);
        }
      });
      failedRef.current = failed;
    }, QUOTA_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
