import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';
import type { QuotaProviderType } from './providers/types';
import type { QuotaRowModel } from './quotaOverview';

export const WEEK_MS = 7 * DAY_MS;

export const BURN_LOOKBACKS = ['24h', '3d', '7d'] as const;
export type BurnLookback = (typeof BURN_LOOKBACKS)[number];

export const BURN_LOOKBACK_MS: Record<BurnLookback, number> = {
  '24h': DAY_MS,
  '3d': 3 * DAY_MS,
  '7d': WEEK_MS,
};

export const BURN_HORIZON_DAYS = [3, 7, 14] as const;
export type BurnHorizonDays = (typeof BURN_HORIZON_DAYS)[number];

export interface BurnReading {
  at: number;
  remaining: number;
}

export interface BurnAccount {
  remaining: number | null;
  resetAtMs: number | null;
  readings: readonly BurnReading[];
}

export interface BurnPoint {
  at: number;
  remaining: number;
}

export interface BurnReset {
  at: number;
  gain: number;
}

export interface BurnForecast {
  remaining: number;
  capacity: number;
  ratePerHour: number | null;
  rateSource: 'measured' | 'manual' | null;
  history: BurnPoint[];
  projection: BurnPoint[];
  nextReset: BurnReset | null;
  emptyAtMs: number | null;
}

interface LiveAccount {
  remaining: number;
  nextResetMs: number | null;
  readings: BurnReading[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

// A reset already in the past means the window refilled since the quota loaded. Instants are
// rounded to the minute because accounts that reset together are reported seconds apart.
function liveAccounts(accounts: readonly BurnAccount[], nowMs: number): LiveAccount[] {
  return accounts.flatMap((account) => {
    if (account.remaining === null || !Number.isFinite(account.remaining)) return [];
    let remaining = clampPercent(account.remaining);
    let nextResetMs =
      account.resetAtMs !== null && Number.isFinite(account.resetAtMs)
        ? Math.round(account.resetAtMs / MINUTE_MS) * MINUTE_MS
        : null;
    if (nextResetMs !== null && nextResetMs <= nowMs) {
      remaining = 100;
      nextResetMs += Math.ceil((nowMs - nextResetMs + 1) / WEEK_MS) * WEEK_MS;
    }
    const readings = account.readings
      .filter((reading) => Number.isFinite(reading.at) && Number.isFinite(reading.remaining))
      .filter((reading) => reading.at <= nowMs)
      .sort((a, b) => a.at - b.at);
    return [{ remaining, nextResetMs, readings }];
  });
}

// Rises are resets, not usage; usage between a reset and the next reading is lost, so the
// rate leans low right after a reset.
function accountRate(readings: readonly BurnReading[], startMs: number): number | null {
  let used = 0;
  let observedMs = 0;
  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];
    if (current.at <= startMs) continue;
    const gapMs = current.at - previous.at;
    if (gapMs <= 0) continue;
    const insideMs = current.at - Math.max(previous.at, startMs);
    used += (Math.max(0, previous.remaining - current.remaining) * insideMs) / gapMs;
    observedMs += insideMs;
  }
  return observedMs > 0 ? (used / observedMs) * HOUR_MS : null;
}

export function measureDrainRate(
  accounts: readonly BurnAccount[],
  lookbackMs: number,
  nowMs: number
): number | null {
  const startMs = nowMs - lookbackMs;
  let total: number | null = null;
  liveAccounts(accounts, nowMs).forEach((account) => {
    const rate = accountRate(account.readings, startMs);
    if (rate !== null) total = (total ?? 0) + rate;
  });
  return total;
}

export function pooledHistory(
  accounts: readonly BurnAccount[],
  fromMs: number,
  nowMs: number
): BurnPoint[] {
  const live = liveAccounts(accounts, nowMs);
  const withReadings = live.filter((account) => account.readings.length > 0);
  const instants = [
    ...new Set(
      withReadings.flatMap((account) =>
        account.readings.map((reading) => reading.at).filter((at) => at >= fromMs && at < nowMs)
      )
    ),
  ].sort((a, b) => a - b);

  const points = instants.map((at) => ({
    at,
    remaining: live.reduce((sum, account) => {
      if (account.readings.length === 0) return sum + account.remaining;
      let value = account.readings[0].remaining;
      for (const reading of account.readings) {
        if (reading.at > at) break;
        value = reading.remaining;
      }
      return sum + clampPercent(value);
    }, 0),
  }));
  points.push({ at: nowMs, remaining: live.reduce((sum, account) => sum + account.remaining, 0) });
  return points;
}

function drainEvenly(accounts: LiveAccount[], amount: number) {
  let left = amount;
  while (left > 1e-9) {
    const active = accounts.filter((account) => account.remaining > 0);
    if (active.length === 0) return;
    const share = left / active.length;
    const step = Math.min(share, ...active.map((account) => account.remaining));
    active.forEach((account) => {
      account.remaining = Math.max(0, account.remaining - step);
    });
    left -= step * active.length;
  }
}

const poolOf = (accounts: readonly LiveAccount[]) =>
  accounts.reduce((sum, account) => sum + account.remaining, 0);

interface Projection {
  points: BurnPoint[];
  resets: BurnReset[];
  emptyAtMs: number | null;
}

export function projectBurn(
  accounts: readonly BurnAccount[],
  ratePerHour: number,
  nowMs: number,
  horizonMs: number
): Projection {
  const live = liveAccounts(accounts, nowMs);
  const rate = Math.max(0, ratePerHour);
  const endMs = nowMs + Math.max(0, horizonMs);
  const points: BurnPoint[] = [{ at: nowMs, remaining: poolOf(live) }];
  const resets: BurnReset[] = [];
  let emptyAtMs: number | null = null;
  let clock = nowMs;

  while (clock < endMs) {
    const resetTimes = live
      .map((account) => account.nextResetMs)
      .filter((at): at is number => at !== null);
    const nextEvent = Math.min(endMs, ...resetTimes);

    const pool = poolOf(live);
    const demand = (rate * (nextEvent - clock)) / HOUR_MS;
    if (pool <= 0) {
      emptyAtMs ??= clock;
    } else if (demand >= pool) {
      const dryAt = clock + (pool / rate) * HOUR_MS;
      emptyAtMs ??= dryAt;
      if (dryAt < nextEvent) points.push({ at: dryAt, remaining: 0 });
    }
    drainEvenly(live, demand);
    clock = nextEvent;
    points.push({ at: clock, remaining: poolOf(live) });
    if (clock >= endMs) break;

    let gain = 0;
    live.forEach((account) => {
      if (account.nextResetMs !== clock) return;
      gain += 100 - account.remaining;
      account.remaining = 100;
      account.nextResetMs = clock + WEEK_MS;
    });
    resets.push({ at: clock, gain });
    points.push({ at: clock, remaining: poolOf(live) });
  }

  return { points, resets, emptyAtMs };
}

export interface BurnForecastInput {
  accounts: readonly BurnAccount[];
  nowMs: number;
  lookback: BurnLookback;
  horizonDays: BurnHorizonDays;
  manualRatePerHour?: number | null;
}

export function buildBurnForecast({
  accounts,
  nowMs,
  lookback,
  horizonDays,
  manualRatePerHour,
}: BurnForecastInput): BurnForecast {
  const live = liveAccounts(accounts, nowMs);
  const lookbackMs = BURN_LOOKBACK_MS[lookback];
  const manual =
    manualRatePerHour !== null &&
    manualRatePerHour !== undefined &&
    Number.isFinite(manualRatePerHour) &&
    manualRatePerHour >= 0
      ? manualRatePerHour
      : null;
  const measured = manual === null ? measureDrainRate(accounts, lookbackMs, nowMs) : null;
  const ratePerHour = manual ?? measured;
  const projection = projectBurn(accounts, ratePerHour ?? 0, nowMs, horizonDays * DAY_MS);

  return {
    remaining: poolOf(live),
    capacity: live.length * 100,
    ratePerHour,
    rateSource: manual !== null ? 'manual' : measured !== null ? 'measured' : null,
    history: pooledHistory(accounts, nowMs - lookbackMs, nowMs),
    projection: projection.points,
    nextReset: projection.resets[0] ?? null,
    emptyAtMs: projection.emptyAtMs,
  };
}

export function burnValueAt(points: readonly BurnPoint[], atMs: number): number | null {
  if (points.length === 0) return null;
  let index = -1;
  while (index + 1 < points.length && points[index + 1].at <= atMs) index += 1;
  if (index < 0) return points[0].remaining;
  const point = points[index];
  const next = points[index + 1];
  if (!next) return point.remaining;
  const fraction = (atMs - point.at) / (next.at - point.at);
  return point.remaining + (next.remaining - point.remaining) * fraction;
}

// Codex team plans report a monthly window; they stay out because the projection resets weekly.
export const BURN_WINDOW_IDS: Partial<Record<QuotaProviderType, string>> = {
  claude: 'seven-day',
  codex: 'weekly',
};

export function burnAccountFromRow(
  type: QuotaProviderType,
  model: QuotaRowModel | null,
  readingsFor: (windowId: string) => readonly BurnReading[]
): BurnAccount {
  const windowId = BURN_WINDOW_IDS[type];
  const metric = windowId ? model?.metrics.find((item) => item.id === windowId) : undefined;
  if (!windowId || !metric || metric.remainingPercent === null) {
    return { remaining: null, resetAtMs: null, readings: [] };
  }
  return {
    remaining: metric.remainingPercent,
    resetAtMs: metric.resetAtMs,
    readings: readingsFor(windowId),
  };
}
