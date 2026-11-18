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
  return { fromMs: Math.min(Math.max(fromMs, floorHour(recordingSinceMs)), nowMs), toMs: nowMs };
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

const spanSteps = (span: TimeRange) =>
  Math.max(1, Math.round((span.toMs - span.fromMs) / HOUR_MS));

export function sliderPosition(range: TimeRange, span: TimeRange): SliderPosition {
  const steps = spanSteps(span);
  const clampStep = (step: number) => Math.min(steps, Math.max(0, step));
  const hoursIntoSpan = (ms: number) => (ms - span.fromMs) / HOUR_MS;
  const hi = Math.max(1, clampStep(Math.ceil(hoursIntoSpan(range.toMs))));
  return { steps, lo: Math.min(clampStep(Math.floor(hoursIntoSpan(range.fromMs))), hi - 1), hi };
}

export type SliderHandle = 'start' | 'end';

/** An end that reaches the present stays open, so the range keeps following the clock. */
export function moveSliderHandle(
  handle: SliderHandle,
  step: number,
  current: TimeRange,
  span: TimeRange,
  nowMs: number
): TimeRange {
  const steps = spanSteps(span);
  const clamped = Math.min(steps, Math.max(0, step));
  const atMs = span.fromMs + clamped * HOUR_MS;
  if (handle === 'start') {
    return {
      fromMs: atMs,
      toMs: current.toMs >= nowMs ? Number.POSITIVE_INFINITY : current.toMs,
    };
  }
  return {
    fromMs: current.fromMs,
    toMs: clamped >= steps ? Number.POSITIVE_INFINITY : atMs,
  };
}
