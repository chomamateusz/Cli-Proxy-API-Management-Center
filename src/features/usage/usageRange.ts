import type { SeriesGranularity } from '@/types/fleetUsage';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

export const RANGE_PRESETS = ['today', '24h', '7d', 'all'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const HOUR_SERIES_MAX_MS = 744 * HOUR_MS;

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

export type RangeSelection =
  { kind: 'preset'; preset: RangePreset } | { kind: 'custom'; range: TimeRange };

export const floorHour = (ms: number) => Math.floor(ms / HOUR_MS) * HOUR_MS;
export const ceilHour = (ms: number) => Math.ceil(ms / HOUR_MS) * HOUR_MS;
export const floorUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

export const localMidnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

export const isRangePreset = (value: unknown): value is RangePreset =>
  typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value);

export function recordedSpan(recordingSinceMs: number | null, nowMs: number): TimeRange {
  const toMs = ceilHour(nowMs);
  const fromMs = recordingSinceMs === null ? toMs - DAY_MS : floorHour(recordingSinceMs);
  return { fromMs: Math.min(fromMs, toMs - HOUR_MS), toMs };
}

export function clampRange(range: TimeRange, span: TimeRange): TimeRange {
  const spanMs = span.toMs - span.fromMs;
  const minimum = Math.min(HOUR_MS, spanMs);
  const toMs = Math.min(Math.max(range.toMs, span.fromMs + minimum), span.toMs);
  const fromMs = Math.min(Math.max(range.fromMs, span.fromMs), toMs - minimum);
  return { fromMs, toMs };
}

export function presetRange(
  preset: RangePreset,
  nowMs: number,
  recordingSinceMs: number | null
): TimeRange {
  const fromMs = {
    today: localMidnight(nowMs),
    '24h': nowMs - DAY_MS,
    '7d': nowMs - 7 * DAY_MS,
    all: recordingSinceMs === null ? nowMs - DAY_MS : floorHour(recordingSinceMs),
  }[preset];
  if (recordingSinceMs === null) return { fromMs, toMs: nowMs };
  return clampRange({ fromMs, toMs: nowMs }, { fromMs: floorHour(recordingSinceMs), toMs: nowMs });
}

export function resolveSelection(
  selection: RangeSelection,
  nowMs: number,
  recordingSinceMs: number | null
): TimeRange {
  if (selection.kind === 'preset') return presetRange(selection.preset, nowMs, recordingSinceMs);
  return clampRange(selection.range, recordedSpan(recordingSinceMs, nowMs));
}

export function seriesGranularityFor(range: TimeRange): SeriesGranularity {
  return ceilHour(range.toMs) - floorHour(range.fromMs) <= HOUR_SERIES_MAX_MS ? 'hour' : 'day';
}

export interface SliderPosition {
  steps: number;
  lo: number;
  hi: number;
}

export function sliderPosition(range: TimeRange, span: TimeRange): SliderPosition {
  const steps = Math.max(1, Math.round((span.toMs - span.fromMs) / HOUR_MS));
  const toStep = (ms: number) =>
    Math.min(steps, Math.max(0, Math.round((ms - span.fromMs) / HOUR_MS)));
  const hi = Math.max(1, toStep(range.toMs));
  return { steps, lo: Math.min(toStep(range.fromMs), hi - 1), hi };
}

/** A handle dragged to the end of the span keeps following the clock, hence the open end. */
export function rangeFromSlider(lo: number, hi: number, span: TimeRange): TimeRange {
  const steps = Math.max(1, Math.round((span.toMs - span.fromMs) / HOUR_MS));
  const upper = Math.min(steps, Math.max(1, hi));
  const lower = Math.min(upper - 1, Math.max(0, lo));
  return {
    fromMs: span.fromMs + lower * HOUR_MS,
    toMs: upper >= steps ? Number.POSITIVE_INFINITY : span.fromMs + upper * HOUR_MS,
  };
}
