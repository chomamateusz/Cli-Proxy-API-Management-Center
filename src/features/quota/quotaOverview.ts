import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, CodexQuotaState, KimiQuotaState, XaiQuotaState } from '@/types';
import { MINUTE_MS } from '@/utils/time/durations';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from './components/QuotaMeter';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export type QuotaTone = 'high' | 'medium' | 'low' | 'unknown';

export interface QuotaMetric {
  id: string;
  label: string;
  /** What is left, 0-100. */
  remainingPercent: number | null;
  resetAtMs: number | null;
}

export interface QuotaRowModel {
  /** The bucket the provider pool adds up. */
  primary: QuotaMetric;
  metrics: QuotaMetric[];
  /** Buckets shown only on request (Opus, Sonnet, code review). */
  extra: QuotaMetric[];
}

export interface PoolTotal {
  label: string;
  remaining: number | null;
  capacity: number;
}

export interface ProviderSummary {
  type: QuotaProviderType;
  credentialCount: number;
  loadedCount: number;
  pool: PoolTotal | null;
  /** Claude only: the 7-day Fable bucket pooled the same way. */
  secondaryPool: PoolTotal | null;
  /** Soonest future reset of the pooled bucket. */
  nextResetAtMs: number | null;
  /** Percentage points that soonest reset gives back to the pool. */
  nextResetGain: number | null;
  hasExtraBuckets: boolean;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const remainingFromUsed = (used: number | null | undefined): number | null => {
  const finite = finiteOrNull(used);
  return finite === null ? null : clampPercent(100 - finite);
};

export const toneForRemaining = (remaining: number | null): QuotaTone => {
  if (remaining === null) return 'unknown';
  if (remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
};

type LabeledWindow = {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetAtMs?: number | null;
};

const windowMetric = (t: TFunction, window: LabeledWindow): QuotaMetric => ({
  id: window.id,
  label: window.labelKey ? String(t(window.labelKey, window.labelParams ?? {})) : window.label,
  remainingPercent: remainingFromUsed(window.usedPercent),
  resetAtMs: finiteOrNull(window.resetAtMs),
});

const rowModelFromWindows = (
  t: TFunction,
  windows: readonly LabeledWindow[],
  shownIds: readonly string[]
): QuotaRowModel | null => {
  const shown = shownIds.flatMap((id) => windows.filter((window) => window.id === id).slice(0, 1));
  if (shown.length === 0) return null;
  const metrics = shown.map((window) => windowMetric(t, window));
  return {
    primary: metrics[0],
    metrics,
    extra: windows
      .filter((window) => !shown.includes(window))
      .map((window) => windowMetric(t, window)),
  };
};

const CLAUDE_ROW_WINDOWS = ['seven-day', 'seven-day-fable', 'five-hour'];

const claudeRowModel = (t: TFunction, quota: ClaudeQuotaState) =>
  rowModelFromWindows(t, quota.windows ?? [], CLAUDE_ROW_WINDOWS);

const codexRowModel = (t: TFunction, quota: CodexQuotaState) => {
  const windows = quota.windows ?? [];
  const longest = windows.some((window) => window.id === 'weekly') ? 'weekly' : 'monthly';
  return rowModelFromWindows(t, windows, [longest, 'five-hour']);
};

const kimiRowModel = (t: TFunction, quota: KimiQuotaState): QuotaRowModel | null => {
  const rows = quota.rows ?? [];
  const toMetric = (row: KimiQuotaState['rows'][number]): QuotaMetric => ({
    id: row.id,
    label: row.labelKey ? String(t(row.labelKey, row.labelParams ?? {})) : (row.label ?? row.id),
    remainingPercent:
      row.limit > 0 ? clampPercent(((row.limit - row.used) / row.limit) * 100) : null,
    resetAtMs: finiteOrNull(row.resetAtMs),
  });
  const weekly = rows.find((row) => row.id === 'summary') ?? rows[rows.length - 1];
  if (!weekly) return null;
  const metrics = [weekly, ...rows.filter((row) => row !== weekly)].map(toMetric);
  return { primary: metrics[0], metrics, extra: [] };
};

const xaiRowModel = (t: TFunction, quota: XaiQuotaState): QuotaRowModel | null => {
  const billing = quota.billing;
  if (!billing || billing.mode !== 'billing') return null;
  const weekly = billing.periodType === 'weekly';
  const metric: QuotaMetric = {
    id: weekly ? 'weekly' : 'monthly',
    label: String(t(weekly ? 'quota_overview.weekly_limit' : 'quota_overview.monthly_limit')),
    remainingPercent: remainingFromUsed(billing.usedPercent ?? billing.usagePercent),
    resetAtMs: finiteOrNull(billing.resetAtMs),
  };
  return { primary: metric, metrics: [metric], extra: [] };
};

/** Null means the row renders the provider's full quota body instead of compact bars. */
export const buildQuotaRowModel = (
  t: TFunction,
  type: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaRowModel | null => {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'claude':
      return claudeRowModel(t, quota as ClaudeQuotaState);
    case 'codex':
      return codexRowModel(t, quota as CodexQuotaState);
    case 'kimi':
      return kimiRowModel(t, quota as KimiQuotaState);
    case 'xai':
      return xaiRowModel(t, quota as XaiQuotaState);
    default:
      return null;
  }
};

const mostCommon = (labels: readonly string[]): string | null => {
  const counts = new Map<string, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

const poolOf = (metrics: readonly QuotaMetric[]): PoolTotal | null => {
  const label = mostCommon(metrics.map((metric) => metric.label));
  if (label === null) return null;
  const known = metrics.filter((metric) => metric.remainingPercent !== null);
  return {
    label,
    remaining:
      known.length === 0
        ? null
        : known.reduce((sum, metric) => sum + (metric.remainingPercent ?? 0), 0),
    capacity: metrics.length * 100,
  };
};

/** Reset instants are reported a few seconds apart for accounts that reset together. */
const toMinute = (ms: number) => Math.round(ms / MINUTE_MS) * MINUTE_MS;

export const buildProviderSummary = (
  t: TFunction,
  type: QuotaProviderType,
  quotas: readonly (QuotaCardState | undefined)[],
  nowMs: number
): ProviderSummary => {
  const models = quotas.flatMap((quota) => {
    const model = buildQuotaRowModel(t, type, quota);
    return model ? [model] : [];
  });
  const primaries = models.map((model) => model.primary);
  const fables =
    type === 'claude'
      ? models.flatMap((model) =>
          model.metrics.filter(
            (metric) => metric.id === 'seven-day-fable' && metric !== model.primary
          )
        )
      : [];

  const upcoming = primaries
    .map((metric) => metric.resetAtMs)
    .filter((at): at is number => at !== null && at > nowMs)
    .map(toMinute);
  const nextResetAtMs = upcoming.length > 0 ? Math.min(...upcoming) : null;
  const resetting = primaries.filter(
    (metric) =>
      nextResetAtMs !== null &&
      metric.resetAtMs !== null &&
      toMinute(metric.resetAtMs) === nextResetAtMs &&
      metric.remainingPercent !== null
  );

  return {
    type,
    credentialCount: quotas.length,
    loadedCount: quotas.filter((quota) => quota?.status === 'success').length,
    pool: poolOf(primaries),
    secondaryPool: poolOf(fables),
    nextResetAtMs,
    nextResetGain:
      resetting.length === 0
        ? null
        : resetting.reduce((sum, metric) => sum + (100 - (metric.remainingPercent ?? 100)), 0),
    hasExtraBuckets: models.some((model) => model.extra.length > 0),
  };
};

const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)/g;
const MASK = '•••';

/** `tooling@lumen.dev` becomes `t•••@l•••.dev`. */
export const maskEmail = (text: string): string =>
  text.replace(
    EMAIL_PATTERN,
    (_match, local: string, firstLabel: string, rest: string) =>
      `${local.slice(0, 1)}${MASK}@${firstLabel.slice(0, 1)}${MASK}${rest}`
  );

const CREDENTIAL_PREFIX =
  /^(?:codex-[0-9a-f]{8}-|(?:claude|codex|gemini|antigravity|kimi|xai|grok|devin|meta|qwen|iflow|kiro|vertex)-)/;

/**
 * Masks the email inside a credential file name while keeping the provider prefix
 * readable: `codex-ae5d455f-john-doe@lumen.dev-pro.json` becomes
 * `codex-ae5d455f-j•••@l•••.dev-pro.json`.
 */
export const maskCredentialName = (name: string): string => {
  if (!name.includes('@')) return name;
  const prefix = name.match(CREDENTIAL_PREFIX)?.[0] ?? '';
  return `${prefix}${maskEmail(name.slice(prefix.length))}`;
};

/** `2d 4h`, `19h 12m`, `7m`; units stay unlocalized like the timeline's day labels. */
export const formatCountdown = (targetMs: number, nowMs: number): string => {
  const totalMinutes = Math.max(0, Math.ceil((targetMs - nowMs) / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};
