import type { SeriesGranularity } from '@/types/fleetUsage';
import { OTHER_SEGMENT } from './usageSeries';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  const cached = formatters.get(cacheKey);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat(locale || undefined, options);
  } catch {
    created = new Intl.DateTimeFormat(undefined, options);
  }
  formatters.set(cacheKey, created);
  return created;
}

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};
const SECONDS_OPTIONS: Intl.DateTimeFormatOptions = { ...TIME_OPTIONS, second: '2-digit' };
const DAY_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { ...DAY_OPTIONS, ...TIME_OPTIONS };
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

export const formatClock = (ms: number, locale: string) =>
  formatter(locale, TIME_OPTIONS).format(ms);
export const formatClockSeconds = (ms: number, locale: string) =>
  formatter(locale, SECONDS_OPTIONS).format(ms);
export const formatDay = (ms: number, locale: string) => formatter(locale, DAY_OPTIONS).format(ms);
export const formatDateTime = (ms: number, locale: string) =>
  formatter(locale, DATE_TIME_OPTIONS).format(ms);
export const formatDate = (ms: number, locale: string) =>
  formatter(locale, DATE_OPTIONS).format(ms);

export function formatBucketLabel(
  startMs: number,
  endMs: number,
  granularity: SeriesGranularity,
  locale: string
): string {
  if (granularity === 'hour') {
    return `${formatDateTime(startMs, locale)}–${formatClock(endMs, locale)}`;
  }
  return `${formatDateTime(startMs, locale)} – ${formatDateTime(endMs, locale)}`;
}

export function formatInteger(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale || undefined).format(value);
  } catch {
    return String(value);
  }
}

export function formatShare(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.001) return '<0.1%';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

export function seriesColor(segment: string, slots: ReadonlyMap<string, number>): string {
  const slot = segment === OTHER_SEGMENT ? undefined : slots.get(segment);
  return slot === undefined ? 'var(--viz-series-other)' : `var(--viz-series-${slot + 1})`;
}
