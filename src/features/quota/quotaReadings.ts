import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore } from '@/stores';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { BurnReading } from './burnForecast';
import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
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
  const cutoff = reading.at - QUOTA_READING_RETENTION_MS;
  const kept = readings.filter((item) => item.at >= cutoff && item.at < reading.at);
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

const readLog = (nowMs: number): QuotaReadingLog => {
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

/** Read from storage rather than React state so loads made by other open tabs count too. */
export function lastQuotaReadingAt(accountKey: string, nowMs: number): number | null {
  const windows = readLog(nowMs)[accountKey];
  if (!windows) return null;
  const latest = Object.values(windows)
    .map((readings) => readings[readings.length - 1]?.at)
    .filter((at): at is number => at !== undefined);
  return latest.length > 0 ? Math.max(...latest) : null;
}

// Every fetch commits a new state object, so identity tells which loads were already saved.
const recordedStates = new WeakSet<object>();

export function useQuotaReadings(entries: readonly QuotaFileEntry[]): QuotaReadingLog {
  const { t } = useTranslation();
  const claude = useQuotaStore((state) => state.claudeQuota);
  const codex = useQuotaStore((state) => state.codexQuota);
  const kimi = useQuotaStore((state) => state.kimiQuota);
  const xai = useQuotaStore((state) => state.xaiQuota);
  const [log, setLog] = useState<QuotaReadingLog>(() => readLog(Date.now()));

  useEffect(() => {
    const quotaMaps = { claude, codex, kimi, xai } as unknown as Partial<
      Record<QuotaFileEntry['type'], Record<string, QuotaCardState>>
    >;
    const nowMs = Date.now();
    let next: QuotaReadingLog | null = null;
    entries.forEach(({ file, type }) => {
      const key = getQuotaCacheKey(file);
      const state = quotaMaps[type]?.[key];
      if (!state || state.status !== 'success' || recordedStates.has(state)) return;
      recordedStates.add(state);
      const model = buildQuotaRowModel(t, type, state);
      if (!model) return;
      const updated: QuotaReadingLog = next ?? readLog(nowMs);
      [...model.metrics, ...model.extra].forEach((metric) => {
        if (metric.remainingPercent === null) return;
        const windows = updated[key] ?? {};
        updated[key] = {
          ...windows,
          [metric.id]: appendQuotaReading(windows[metric.id] ?? [], {
            at: nowMs,
            remaining: metric.remainingPercent,
          }),
        };
      });
      next = updated;
    });
    if (next) {
      writeLog(next);
      setLog(next);
    }
  }, [entries, claude, codex, kimi, xai, t]);

  return log;
}
