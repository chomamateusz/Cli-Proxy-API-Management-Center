import type {
  ClientKeyUsageReport,
  KeyUsage,
  ModelUsage,
  SeriesGranularity,
  UsageCounters,
  UsageSeriesPoint,
} from '@/types/fleetUsage';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { floorHour, floorUtcDay, localMidnight, type TimeRange } from './usageRange';

export const USAGE_METRICS = ['total', 'output', 'requests'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const ALL_PROVIDERS = 'all';
export const COLOR_SLOT_COUNT = 8;
export const OTHER_SEGMENT = '\u0000other';

export const isUsageMetric = (value: unknown): value is UsageMetric =>
  typeof value === 'string' && (USAGE_METRICS as readonly string[]).includes(value);

export const requestCount = (counters: UsageCounters) =>
  counters.requests + counters.failedRequests;

export function metricValue(counters: UsageCounters, metric: UsageMetric): number {
  if (metric === 'output') return counters.outputTokens;
  if (metric === 'requests') return requestCount(counters);
  return counters.totalTokens;
}

export const emptyCounters = (): UsageCounters => ({
  requests: 0,
  failedRequests: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
});

export function addCounters(target: UsageCounters, delta: UsageCounters): UsageCounters {
  target.requests += delta.requests;
  target.failedRequests += delta.failedRequests;
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningTokens += delta.reasoningTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  target.totalTokens += delta.totalTokens;
  return target;
}

const matchesProvider = (provider: string, filter: string) =>
  filter === ALL_PROVIDERS || provider === filter;

export function providersIn(report: ClientKeyUsageReport | null): string[] {
  if (!report) return [];
  const providers = new Set<string>();
  report.series.forEach((point) => providers.add(point.provider));
  report.keys.forEach((key) => key.models.forEach((model) => providers.add(model.provider)));
  return [...providers].sort((left, right) => left.localeCompare(right));
}

export function bucketStarts(range: TimeRange, granularity: SeriesGranularity): number[] {
  const step = granularity === 'day' ? DAY_MS : HOUR_MS;
  const first = granularity === 'day' ? floorUtcDay(range.fromMs) : floorHour(range.fromMs);
  const starts: number[] = [];
  for (let at = first; at < range.toMs; at += step) starts.push(at);
  return starts;
}

export function assignColorSlots(
  existing: ReadonlyMap<string, number>,
  orderedNames: readonly string[]
): Map<string, number> {
  const slots = new Map(existing);
  for (const name of orderedNames) {
    if (slots.has(name) || slots.size >= COLOR_SLOT_COUNT) continue;
    slots.set(name, slots.size);
  }
  return slots;
}

export const segmentOf = (key: string, slots: ReadonlyMap<string, number>) =>
  slots.has(key) ? key : OTHER_SEGMENT;

export interface ChartBucket {
  startMs: number;
  endMs: number;
  values: Record<string, number>;
  total: number;
}

export interface BucketOptions {
  range: TimeRange;
  granularity: SeriesGranularity;
  metric: UsageMetric;
  provider: string;
  slots: ReadonlyMap<string, number>;
  hidden?: ReadonlySet<string>;
}

export function buildChartBuckets(
  series: readonly UsageSeriesPoint[],
  options: BucketOptions
): ChartBucket[] {
  const step = options.granularity === 'day' ? DAY_MS : HOUR_MS;
  const buckets = bucketStarts(options.range, options.granularity).map((startMs): ChartBucket => ({
    startMs,
    endMs: startMs + step,
    values: {},
    total: 0,
  }));
  const byStart = new Map(buckets.map((bucket) => [bucket.startMs, bucket]));
  for (const point of series) {
    if (!matchesProvider(point.provider, options.provider)) continue;
    const segment = segmentOf(point.key, options.slots);
    if (options.hidden?.has(segment)) continue;
    const bucket = byStart.get(point.startMs);
    const value = metricValue(point, options.metric);
    if (!bucket || value === 0) continue;
    bucket.values[segment] = (bucket.values[segment] ?? 0) + value;
    bucket.total += value;
  }
  return buckets;
}

export function seriesKeyOrder(series: readonly UsageSeriesPoint[], metric: UsageMetric): string[] {
  const totals = new Map<string, number>();
  for (const point of series) {
    totals.set(point.key, (totals.get(point.key) ?? 0) + metricValue(point, metric));
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key]) => key);
}

export interface KeyTotalRow {
  name: string;
  createdAtMs: number | null;
  revoked: boolean;
  counters: UsageCounters;
  value: number;
  share: number;
  models: ModelUsage[];
}

export function buildKeyTotals(
  keys: readonly KeyUsage[],
  metric: UsageMetric,
  provider: string
): KeyTotalRow[] {
  const rows = keys.map((key) => {
    const models = key.models
      .filter((model) => matchesProvider(model.provider, provider))
      .sort(
        (left, right) =>
          metricValue(right, metric) - metricValue(left, metric) ||
          left.model.localeCompare(right.model)
      );
    const counters =
      provider === ALL_PROVIDERS
        ? addCounters(emptyCounters(), key)
        : models.reduce((sum, model) => addCounters(sum, model), emptyCounters());
    return {
      name: key.name,
      createdAtMs: key.createdAtMs,
      revoked: key.revoked,
      counters,
      value: metricValue(counters, metric),
      share: 0,
      models,
    };
  });
  const grandTotal = rows.reduce((sum, row) => sum + row.value, 0);
  return rows
    .filter((row) => provider === ALL_PROVIDERS || row.models.length > 0)
    .map((row) => ({ ...row, share: grandTotal > 0 ? row.value / grandTotal : 0 }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
}

const COMPACT_UNITS = [
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'k' },
];

export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  for (const { limit, suffix } of COMPACT_UNITS) {
    if (magnitude >= limit) {
      const scaled = value / limit;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(Math.round(value));
}

export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((factor) => factor * exponent >= value);
  return (step ?? 10) * exponent;
}

const TICK_STEPS_HOURS = [1, 2, 3, 6, 12, 24, 48, 72, 168, 336, 720];

export interface AxisTick {
  atMs: number;
  dayStart: boolean;
}

export function timeTicks(range: TimeRange, maxTicks = 7): AxisTick[] {
  const spanHours = (range.toMs - range.fromMs) / HOUR_MS;
  const stepHours =
    TICK_STEPS_HOURS.find((hours) => spanHours / hours <= maxTicks) ??
    Math.ceil(spanHours / maxTicks / 24) * 24;
  const ticks: AxisTick[] = [];
  if (stepHours < 24) {
    for (let at = Math.ceil(range.fromMs / HOUR_MS) * HOUR_MS; at < range.toMs; at += HOUR_MS) {
      const hour = new Date(at).getHours();
      if (hour % stepHours === 0) ticks.push({ atMs: at, dayStart: hour === 0 });
    }
    return ticks;
  }
  const stepDays = stepHours / 24;
  const day = new Date(localMidnight(range.fromMs));
  if (day.getTime() < range.fromMs) day.setDate(day.getDate() + 1);
  for (let index = 0; day.getTime() < range.toMs; index += 1) {
    if (index % stepDays === 0) ticks.push({ atMs: day.getTime(), dayStart: true });
    day.setDate(day.getDate() + 1);
  }
  return ticks;
}
