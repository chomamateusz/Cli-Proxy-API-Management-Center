import { describe, expect, test } from 'bun:test';
import {
  clampRange,
  moveSliderHandle,
  presetRange,
  recordedSpan,
  resolveSelection,
  seriesGranularityFor,
  sliderPosition,
} from '../src/features/usage/usageRange';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-18T15:20:00Z');
const SINCE = Date.parse('2026-11-01T09:42:00Z');

describe('usage range presets', () => {
  test('today starts at local midnight, the rolling presets end now', () => {
    expect(presetRange('today', NOW, SINCE)).toEqual({
      fromMs: new Date(NOW).setHours(0, 0, 0, 0),
      toMs: NOW,
    });
    expect(presetRange('24h', NOW, SINCE)).toEqual({ fromMs: NOW - DAY, toMs: NOW });
    expect(presetRange('7d', NOW, SINCE)).toEqual({ fromMs: NOW - 7 * DAY, toMs: NOW });
  });

  test('all recorded spans from the recording start hour to now', () => {
    expect(presetRange('all', NOW, SINCE)).toEqual({
      fromMs: Date.parse('2026-11-01T09:00:00Z'),
      toMs: NOW,
    });
  });

  test('presets that reach before the recording start are clamped to it', () => {
    const recent = NOW - 2 * DAY;
    expect(presetRange('7d', NOW, recent).fromMs).toBe(Math.floor(recent / HOUR) * HOUR);
  });

  test('today stays at local midnight in the first hour of the day', () => {
    const midnight = new Date(2026, 10, 18).getTime();
    const justAfter = midnight + 15 * 60_000;
    const since = midnight - 2 * DAY;
    expect(presetRange('today', justAfter, since)).toEqual({ fromMs: midnight, toMs: justAfter });
    expect(
      resolveSelection({ kind: 'preset', preset: 'today' }, justAfter, since)
    ).toEqual({ fromMs: midnight, toMs: justAfter });
  });

  test('without a recording start the presets are not clamped', () => {
    expect(presetRange('7d', NOW, null)).toEqual({ fromMs: NOW - 7 * DAY, toMs: NOW });
  });
});

describe('usage range clamping', () => {
  const span = recordedSpan(SINCE, NOW);

  test('the recorded span runs from the recording hour to the end of the current hour', () => {
    expect(span).toEqual({
      fromMs: Date.parse('2026-11-01T09:00:00Z'),
      toMs: Date.parse('2026-11-18T16:00:00Z'),
    });
  });

  test('ranges outside the span are pulled inside and keep at least one hour', () => {
    expect(clampRange({ fromMs: 0, toMs: Number.POSITIVE_INFINITY }, span)).toEqual(span);
    expect(clampRange({ fromMs: span.toMs + DAY, toMs: span.toMs + 2 * DAY }, span)).toEqual({
      fromMs: span.toMs - HOUR,
      toMs: span.toMs,
    });
    const inverted = clampRange({ fromMs: span.fromMs + 5 * HOUR, toMs: span.fromMs }, span);
    expect(inverted.toMs - inverted.fromMs).toBe(HOUR);
  });

  test('a custom selection resolves against the current span', () => {
    const custom = { fromMs: span.fromMs - DAY, toMs: span.fromMs + 3 * HOUR };
    expect(resolveSelection({ kind: 'custom', range: custom }, NOW, SINCE)).toEqual({
      fromMs: span.fromMs,
      toMs: span.fromMs + 3 * HOUR,
    });
  });
});

describe('usage series granularity', () => {
  test('hour series up to 744 normalized hours, day series beyond', () => {
    const from = Date.parse('2026-10-01T00:00:00Z');
    expect(seriesGranularityFor({ fromMs: from, toMs: from + 744 * HOUR })).toBe('hour');
    expect(seriesGranularityFor({ fromMs: from, toMs: from + 744 * HOUR + 1 })).toBe('day');
    expect(seriesGranularityFor({ fromMs: from - 1, toMs: from + 744 * HOUR })).toBe('day');
    expect(seriesGranularityFor(presetRange('7d', NOW, SINCE))).toBe('hour');
  });
});

describe('usage range slider', () => {
  const span = recordedSpan(SINCE, NOW);
  const steps = (span.toMs - span.fromMs) / HOUR;

  test('positions map hours of the span to handle steps', () => {
    const position = sliderPosition({ fromMs: span.fromMs + 2 * HOUR, toMs: span.toMs }, span);
    expect(position).toEqual({ steps, lo: 2, hi: steps });
  });

  test('a partial-hour range maps to the steps that cover it', () => {
    const range = { fromMs: span.fromMs + 2 * HOUR + 40 * 60_000, toMs: NOW };
    expect(sliderPosition(range, span)).toEqual({ steps, lo: 2, hi: steps });
  });

  test('an end handle dragged to the span end keeps following the clock', () => {
    const current = { fromMs: span.fromMs + 2 * HOUR, toMs: span.fromMs + 5 * HOUR };
    const open = moveSliderHandle('end', steps, current, span, NOW);
    expect(open).toEqual({ fromMs: current.fromMs, toMs: Number.POSITIVE_INFINITY });
    const later = NOW + 3 * HOUR;
    expect(resolveSelection({ kind: 'custom', range: open }, later, SINCE).toMs).toBe(
      recordedSpan(SINCE, later).toMs
    );
    expect(moveSliderHandle('end', steps - 1, current, span, NOW).toMs).toBe(
      span.fromMs + (steps - 1) * HOUR
    );
  });

  test('moving one handle keeps the other end of the range exactly', () => {
    const now = Date.parse('2026-11-18T14:10:00Z');
    const since = now - 4 * DAY;
    const liveSpan = recordedSpan(since, now);
    const preset = presetRange('24h', now, since);
    const position = sliderPosition(preset, liveSpan);
    expect(position.hi).toBe(position.steps);

    const startMoved = moveSliderHandle('start', position.lo + 1, preset, liveSpan, now);
    expect(startMoved.toMs).toBe(Number.POSITIVE_INFINITY);
    expect(resolveSelection({ kind: 'custom', range: startMoved }, now, since).toMs).toBe(
      liveSpan.toMs
    );

    const endMoved = moveSliderHandle('end', position.hi - 1, preset, liveSpan, now);
    expect(endMoved).toEqual({ fromMs: preset.fromMs, toMs: Date.parse('2026-11-18T14:00:00Z') });

    const closed = { fromMs: liveSpan.fromMs, toMs: liveSpan.fromMs + 7 * HOUR };
    expect(moveSliderHandle('start', 3, closed, liveSpan, now)).toEqual({
      fromMs: liveSpan.fromMs + 3 * HOUR,
      toMs: closed.toMs,
    });
  });
});
