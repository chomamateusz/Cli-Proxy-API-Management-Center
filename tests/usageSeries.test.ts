import { describe, expect, test } from 'bun:test';
import {
  ALL_PROVIDERS,
  assignColorSlots,
  bucketStarts,
  buildChartBuckets,
  buildKeyTotals,
  formatCompact,
  metricValue,
  niceCeiling,
  providersIn,
  seriesKeyOrder,
  timeTicks,
} from '../src/features/usage/usageSeries';
import { seriesColor } from '../src/features/usage/usageFormat';
import type { ClientKeyUsageReport, KeyUsage, UsageSeriesPoint } from '../src/types/fleetUsage';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-16T00:00:00Z');

const counters = (requests: number, output: number, total: number, failed = 0) => ({
  requests,
  failedRequests: failed,
  inputTokens: total - output,
  outputTokens: output,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: total,
});

const point = (
  hour: number,
  key: string,
  provider: string,
  model: string,
  values: ReturnType<typeof counters>
): UsageSeriesPoint => ({ startMs: T0 + hour * HOUR, key, provider, model, ...values });

const SERIES: UsageSeriesPoint[] = [
  point(0, 'laptop', 'claude', 'claude-opus-5', counters(2, 100, 1000)),
  point(0, 'laptop', 'codex', 'gpt-5.5', counters(1, 50, 300, 1)),
  point(0, 'ci', 'claude', 'claude-sonnet-5', counters(4, 20, 200)),
  point(2, 'ci', 'claude', 'claude-sonnet-5', counters(3, 30, 400)),
  point(26, 'laptop', 'codex', 'gpt-5.5', counters(5, 500, 5000)),
];

const HOUR_RANGE = { fromMs: T0, toMs: T0 + 3 * HOUR };

describe('usage series aggregation', () => {
  test('metric values read total tokens, output tokens and all requests', () => {
    const values = counters(3, 40, 900, 2);
    expect(metricValue(values, 'total')).toBe(900);
    expect(metricValue(values, 'output')).toBe(40);
    expect(metricValue(values, 'requests')).toBe(5);
  });

  test('hour buckets stack every key per bucket for each metric', () => {
    const base = { range: HOUR_RANGE, granularity: 'hour' as const, provider: ALL_PROVIDERS };
    const total = buildChartBuckets(SERIES, { ...base, metric: 'total' });
    expect(total.map((bucket) => bucket.startMs)).toEqual([T0, T0 + HOUR, T0 + 2 * HOUR]);
    expect(Object.fromEntries(total[0].values)).toEqual({ laptop: 1300, ci: 200 });
    expect(total[0].total).toBe(1500);
    expect(total[1].total).toBe(0);
    expect(Object.fromEntries(total[2].values)).toEqual({ ci: 400 });

    const output = buildChartBuckets(SERIES, { ...base, metric: 'output' });
    expect(Object.fromEntries(output[0].values)).toEqual({ laptop: 150, ci: 20 });

    const requests = buildChartBuckets(SERIES, { ...base, metric: 'requests' });
    expect(Object.fromEntries(requests[0].values)).toEqual({ laptop: 4, ci: 4 });
  });

  test('provider filter keeps only that provider and hidden keys drop out of the stack', () => {
    const buckets = buildChartBuckets(SERIES, {
      range: HOUR_RANGE,
      granularity: 'hour',
      metric: 'total',
      provider: 'codex',
    });
    expect(Object.fromEntries(buckets[0].values)).toEqual({ laptop: 300 });

    const hidden = buildChartBuckets(SERIES, {
      range: HOUR_RANGE,
      granularity: 'hour',
      metric: 'total',
      provider: ALL_PROVIDERS,
      hidden: new Set(['laptop']),
    });
    expect(Object.fromEntries(hidden[0].values)).toEqual({ ci: 200 });
    expect(hidden[0].total).toBe(200);
  });

  test('day buckets start at UTC midnight and match day series points', () => {
    const daySeries = [
      point(0, 'laptop', 'claude', 'm', counters(1, 1, 10)),
      point(24, 'laptop', 'claude', 'm', counters(1, 1, 20)),
    ];
    const range = { fromMs: T0 + 5 * HOUR, toMs: T0 + DAY + 5 * HOUR };
    expect(bucketStarts(range, 'day')).toEqual([T0, T0 + DAY]);
    const buckets = buildChartBuckets(daySeries, {
      range,
      granularity: 'day',
      metric: 'total',
      provider: ALL_PROVIDERS,
    });
    expect(buckets.map((bucket) => bucket.total)).toEqual([10, 20]);
    expect(buckets[0].endMs - buckets[0].startMs).toBe(DAY);
  });

  test('keys beyond the eight palette colours keep their own segment and reuse colours', () => {
    const names = Array.from({ length: 10 }, (_, index) => `key-${index}`);
    const slots = assignColorSlots(new Map(), names);
    expect(slots.size).toBe(10);
    const series = names.map((name) => point(0, name, 'claude', 'm', counters(1, 1, 10)));
    const [bucket] = buildChartBuckets(series, {
      range: { fromMs: T0, toMs: T0 + HOUR },
      granularity: 'hour',
      metric: 'total',
      provider: ALL_PROVIDERS,
    });
    expect(bucket.values.size).toBe(10);
    expect(names.every((name) => bucket.values.get(name) === 10)).toBe(true);
    expect(seriesColor('key-8', slots)).toBe('var(--viz-series-1)');
    expect(seriesColor('key-9', slots)).toBe('var(--viz-series-2)');
  });

  test('a key first seen after a range change gets its own slot once the palette is used up', () => {
    const historical = Array.from({ length: 8 }, (_, index) => `old-${index}`);
    const slots = assignColorSlots(assignColorSlots(new Map(), historical), ['fresh']);
    expect(slots.get('fresh')).toBe(8);
    const [bucket] = buildChartBuckets([point(0, 'fresh', 'claude', 'm', counters(1, 1, 10))], {
      range: { fromMs: T0, toMs: T0 + HOUR },
      granularity: 'hour',
      metric: 'total',
      provider: ALL_PROVIDERS,
    });
    expect(bucket.values.get('fresh')).toBe(10);
  });

  test('key names that shadow object prototype properties still sum as numbers', () => {
    const names = ['constructor', 'toString', '__proto__'];
    const series = names.map((name) => point(0, name, 'claude', 'm', counters(1, 1, 100)));
    const [bucket] = buildChartBuckets(series, {
      range: { fromMs: T0, toMs: T0 + HOUR },
      granularity: 'hour',
      metric: 'total',
      provider: ALL_PROVIDERS,
    });
    expect(names.map((name) => bucket.values.get(name))).toEqual([100, 100, 100]);
    expect(bucket.values.get('hasOwnProperty')).toBeUndefined();
    expect(bucket.total).toBe(300);
  });

  test('colour slots follow the key, not its rank, when new keys appear', () => {
    const first = assignColorSlots(new Map(), ['ci', 'laptop']);
    const second = assignColorSlots(first, ['laptop', 'tablet', 'ci']);
    expect(second.get('ci')).toBe(0);
    expect(second.get('laptop')).toBe(1);
    expect(second.get('tablet')).toBe(2);
  });

  test('key order ranks by metric total and providers come from series and models', () => {
    expect(seriesKeyOrder(SERIES, 'total')).toEqual(['laptop', 'ci']);
    expect(seriesKeyOrder(SERIES, 'requests')).toEqual(['laptop', 'ci']);
    const report = {
      series: SERIES,
      keys: [{ models: [{ provider: 'xai' }] }],
    } as unknown as ClientKeyUsageReport;
    expect(providersIn(report)).toEqual(['claude', 'codex', 'xai']);
  });
});

describe('usage totals', () => {
  const keys: KeyUsage[] = [
    {
      name: 'laptop',
      createdAtMs: T0,
      revoked: false,
      ...counters(8, 650, 6300, 1),
      models: [
        { provider: 'claude', model: 'claude-opus-5', ...counters(2, 100, 1000) },
        { provider: 'codex', model: 'gpt-5.5', ...counters(6, 550, 5300, 1) },
      ],
    },
    {
      name: 'ci',
      createdAtMs: null,
      revoked: true,
      ...counters(7, 50, 600),
      models: [{ provider: 'claude', model: 'claude-sonnet-5', ...counters(7, 50, 600) }],
    },
  ];

  test('rows sort by the active metric and carry their share of the range', () => {
    const byTokens = buildKeyTotals(keys, 'total', ALL_PROVIDERS);
    expect(byTokens.map((row) => row.name)).toEqual(['laptop', 'ci']);
    expect(byTokens[0].share).toBeCloseTo(6300 / 6900);
    expect(byTokens[0].models.map((model) => model.model)).toEqual(['gpt-5.5', 'claude-opus-5']);

    const byRequests = buildKeyTotals(keys, 'requests', ALL_PROVIDERS);
    expect(byRequests.map((row) => [row.name, row.value])).toEqual([
      ['laptop', 9],
      ['ci', 7],
    ]);
  });

  test('provider filter sums only matching models and drops keys without them', () => {
    const codex = buildKeyTotals(keys, 'total', 'codex');
    expect(codex.map((row) => row.name)).toEqual(['laptop']);
    expect(codex[0].counters.totalTokens).toBe(5300);
    expect(codex[0].share).toBe(1);

    const claude = buildKeyTotals(keys, 'output', 'claude');
    expect(claude.map((row) => [row.name, row.value])).toEqual([
      ['laptop', 100],
      ['ci', 50],
    ]);
  });
});

describe('usage number and axis formatting', () => {
  test('compact numbers use k, M and B', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(12_340)).toBe('12.3k');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatCompact(3_200_000_000)).toBe('3.2B');
  });

  test('axis ceilings split into four distinct whole-number steps', () => {
    expect(niceCeiling(0)).toBe(4);
    expect(niceCeiling(3)).toBe(4);
    expect(niceCeiling(9)).toBe(12);
    expect(niceCeiling(45)).toBe(60);
    expect(niceCeiling(2_300_000_000)).toBe(2_400_000_000);
    for (let max = 1; max <= 5000; max += 1) {
      const ceiling = niceCeiling(max);
      expect(ceiling).toBeGreaterThanOrEqual(max);
      expect(Number.isInteger(ceiling / 4)).toBe(true);
      const labels = [1, 0.75, 0.5, 0.25, 0].map((fraction) => formatCompact(ceiling * fraction));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  test('time ticks stay within the range and never exceed the requested count', () => {
    const day = timeTicks({ fromMs: T0, toMs: T0 + DAY });
    expect(day.length).toBeGreaterThan(0);
    expect(day.length).toBeLessThanOrEqual(7);
    expect(day.every((tick) => tick.atMs >= T0 && tick.atMs < T0 + DAY)).toBe(true);
    const month = timeTicks({ fromMs: T0, toMs: T0 + 30 * DAY });
    expect(month.length).toBeLessThanOrEqual(8);
    expect(month.every((tick) => tick.dayStart)).toBe(true);
  });
});
