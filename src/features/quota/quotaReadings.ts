import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore } from '@/stores';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { parseIsoToMs } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import { BURN_WINDOW_IDS, type BurnReading } from './burnForecast';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { buildQuotaRowModel } from './quotaOverview';

/** Account cache key → quota window id → readings, oldest first. */
export type QuotaReadingLog = Record<string, Record<string, BurnReading[]>>;

const STORAGE_KEY = 'quotaPage.quotaReadings.v1';

// The backend only reports quota as it is now, so the week of history the burn forecast needs
// exists only in this browser. The slack lets a drop that straddles the lookback start be prorated.
export const QUOTA_READING_RETENTION_MS = (7 * 24 + 6) * HOUR_MS;

export function appendQuotaReading(
  readings: readonly BurnReading[],
  reading: BurnReading
): BurnReading[] {
  if (readings.some((item) => item.at >= reading.at)) return [...readings];
  const cutoff = reading.at - QUOTA_READING_RETENTION_MS;
  const kept = readings.filter((item) => item.at >= cutoff);
  const last = kept[kept.length - 1];
  if (last?.remaining !== reading.remaining) return [...kept, reading];
  if (reading.at - last.at < MINUTE_MS) return kept;
  // A run of equal readings only needs its first and last point to measure the same drain.
  const beforeLast = kept[kept.length - 2];
  if (beforeLast?.remaining === reading.remaining) return [...kept.slice(0, -1), reading];
  return [...kept, reading];
}

const isReading = (value: unknown): value is BurnReading =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as BurnReading).at) &&
  Number.isFinite((value as BurnReading).remaining);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseQuotaReadingLog(raw: string | null, nowMs: number): QuotaReadingLog {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const cutoff = nowMs - QUOTA_READING_RETENTION_MS;
  const log: QuotaReadingLog = {};
  Object.entries(parsed).forEach(([account, windows]) => {
    if (!isRecord(windows)) return;
    Object.entries(windows).forEach(([windowId, readings]) => {
      if (!Array.isArray(readings)) return;
      const kept = readings.filter(isReading).filter((reading) => reading.at >= cutoff);
      if (kept.length === 0) return;
      log[account] = { ...log[account], [windowId]: kept };
    });
  });
  return log;
}

/** Read from storage rather than React state so loads made by other open tabs count too. */
export const readQuotaReadingLog = (nowMs: number): QuotaReadingLog => {
  if (typeof window === 'undefined') return {};
  try {
    return parseQuotaReadingLog(window.localStorage.getItem(STORAGE_KEY), nowMs);
  } catch {
    return {};
  }
};

const writeLog = (log: QuotaReadingLog) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or blocked: the forecast shows an unknown rate, nothing else breaks.
  }
};

export function lastQuotaReadingAtFrom(log: QuotaReadingLog, accountKey: string): number | null {
  const windows = log[accountKey];
  if (!windows) return null;
  const latest = Object.values(windows)
    .map((readings) => readings[readings.length - 1]?.at)
    .filter((at): at is number => at !== undefined);
  return latest.length > 0 ? Math.max(...latest) : null;
}

/** A load can be committed, and seen here, long after it was fetched. */
export const quotaFetchedAtMs = (type: QuotaProviderType, state: QuotaCardState): number | null => {
  if (type === 'claude') return parseIsoToMs((state as ClaudeQuotaState).observedAt);
  if (type === 'codex') return (state as CodexQuotaState).loadedAtMs ?? null;
  return null;
};

// Every fetch commits a new state object, so identity tells which loads were already saved.
const recordedStates = new WeakSet<object>();

export function useQuotaReadings(entries: readonly QuotaFileEntry[]): QuotaReadingLog {
  const { t } = useTranslation();
  const claude = useQuotaStore((state) => state.claudeQuota);
  const codex = useQuotaStore((state) => state.codexQuota);
  const [log, setLog] = useState<QuotaReadingLog>(() => readQuotaReadingLog(Date.now()));

  useEffect(() => {
    const quotaMaps = { claude, codex } as unknown as Partial<
      Record<QuotaFileEntry['type'], Record<string, QuotaCardState>>
    >;
    const nowMs = Date.now();
    let next: QuotaReadingLog | null = null;
    entries.forEach(({ file, type }) => {
      const windowId = BURN_WINDOW_IDS[type];
      const key = getQuotaCacheKey(file);
      const state = quotaMaps[type]?.[key];
      if (!windowId || !state || state.status !== 'success' || recordedStates.has(state)) return;
      recordedStates.add(state);
      const remaining = buildQuotaRowModel(t, type, state)?.metrics.find(
        (metric) => metric.id === windowId
      )?.remainingPercent;
      if (remaining === undefined || remaining === null) return;
      const updated: QuotaReadingLog = next ?? readQuotaReadingLog(nowMs);
      const windows = updated[key] ?? {};
      updated[key] = {
        ...windows,
        [windowId]: appendQuotaReading(windows[windowId] ?? [], {
          at: quotaFetchedAtMs(type, state) ?? nowMs,
          remaining,
        }),
      };
      next = updated;
    });
    if (next) {
      writeLog(next);
      setLog(next);
    }
  }, [entries, claude, codex, t]);

  return log;
}
