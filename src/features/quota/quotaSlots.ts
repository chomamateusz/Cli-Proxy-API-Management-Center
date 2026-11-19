/**
 * Aligned limit slots for the Cards view: every mapped provider fills the same three columns
 * (five-hour, weekly, weekly model limit), everything else goes to "More limits".
 * React-free so slot mapping and the pooled group bars are testable directly.
 */

import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';
import { formatXaiOnDemandAmount, formatXaiRemainingAmount } from './providers/xai/amounts';
import { XAI_WEEKLY_ROW_ID } from './resetSchedule';
import type { QuotaProviderType } from './providers/types';

export const QUOTA_SLOT_IDS = ['five-hour', 'weekly', 'model'] as const;
export type QuotaSlotId = (typeof QUOTA_SLOT_IDS)[number];

export const PROVIDER_SLOTS: Partial<Record<QuotaProviderType, readonly QuotaSlotId[]>> = {
  claude: ['five-hour', 'weekly', 'model'],
  codex: ['five-hour', 'weekly'],
  xai: ['weekly'],
};

export const hasSlotMapping = (type: QuotaProviderType): boolean => Boolean(PROVIDER_SLOTS[type]);

/** Union of the slot sets of the providers present, in canonical order. */
export function slotColumnsFor(types: Iterable<QuotaProviderType>): QuotaSlotId[] {
  const present = new Set<QuotaSlotId>();
  for (const type of types) PROVIDER_SLOTS[type]?.forEach((slot) => present.add(slot));
  return QUOTA_SLOT_IDS.filter((slot) => present.has(slot));
}

export type QuotaSlotVariant = 'five-hour' | 'weekly' | 'monthly' | 'model';

const SLOT_LABEL_KEYS: Record<QuotaSlotVariant, string> = {
  'five-hour': 'quota_slots.five_hour',
  weekly: 'quota_slots.weekly',
  monthly: 'quota_slots.monthly',
  model: 'quota_slots.model_fable',
};

export const slotLabelKey = (variant: QuotaSlotVariant): string => SLOT_LABEL_KEYS[variant];

export interface QuotaSlotReading {
  slot: QuotaSlotId;
  variant: QuotaSlotVariant;
  /** The provider body's row id, so the soonest-reset emphasis matches the other views. */
  rowId: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  resetLabel: string | null;
}

export interface QuotaExtraLimit {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetAtMs: number | null;
  resetLabel: string | null;
  detail: string | null;
}

export interface QuotaCardSlots {
  slots: Partial<Record<QuotaSlotId, QuotaSlotReading>>;
  extras: QuotaExtraLimit[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const remainingFromUsed = (used: unknown): number | null => {
  const value = finite(used);
  return value === null ? null : clampPercent(100 - value);
};

const cleanResetLabel = (label: string | null | undefined): string | null =>
  label && label !== '-' ? label : null;

type LabeledWindow = {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  resetAtMs?: number | null;
};

const slotReading = (
  slot: QuotaSlotId,
  variant: QuotaSlotVariant,
  window: LabeledWindow
): QuotaSlotReading => ({
  slot,
  variant,
  rowId: window.id,
  remainingPercent: remainingFromUsed(window.usedPercent),
  resetAtMs: finite(window.resetAtMs),
  resetLabel: cleanResetLabel(window.resetLabel),
});

const windowExtra = (t: TFunction, window: LabeledWindow): QuotaExtraLimit => ({
  id: window.id,
  label: window.labelKey ? String(t(window.labelKey, window.labelParams ?? {})) : window.label,
  remainingPercent: remainingFromUsed(window.usedPercent),
  resetAtMs: finite(window.resetAtMs),
  resetLabel: cleanResetLabel(window.resetLabel),
  detail: null,
});

const formatMoney = (value: number | null, locale: string | undefined): string => {
  if (value === null) return '--';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  } catch {
    return `${value.toFixed(2)} USD`;
  }
};

function claudeSlots(t: TFunction, quota: ClaudeQuotaState, locale?: string): QuotaCardSlots {
  const windows = quota.windows ?? [];
  const find = (id: string) => windows.find((window) => window.id === id);
  const slots: QuotaCardSlots['slots'] = {};
  const fiveHour = find('five-hour');
  const weekly = find('seven-day');
  const fable = find('seven-day-fable');
  if (fiveHour) slots['five-hour'] = slotReading('five-hour', 'five-hour', fiveHour);
  if (weekly) slots.weekly = slotReading('weekly', 'weekly', weekly);
  if (fable) slots.model = slotReading('model', 'model', fable);
  const shown = new Set([fiveHour, weekly, fable]);
  const extras = windows.filter((window) => !shown.has(window)).map((w) => windowExtra(t, w));
  (quota.dollarWindows ?? []).forEach((balance) => {
    const limit = finite(balance.limitDollars);
    const left = finite(balance.remainingDollars);
    extras.push({
      id: `dollar-${balance.key}`,
      label: balance.key,
      remainingPercent: limit && left !== null ? clampPercent((left / limit) * 100) : null,
      resetAtMs: null,
      resetLabel: cleanResetLabel(formatQuotaResetTime(balance.resetsAt ?? undefined)),
      detail: String(
        t('claude_quota.usage_spent_limit', {
          spent: formatMoney(finite(balance.usedDollars), locale),
          limit: formatMoney(limit, locale),
        })
      ),
    });
  });
  return { slots, extras };
}

function codexSlots(t: TFunction, quota: CodexQuotaState): QuotaCardSlots {
  const windows = quota.windows ?? [];
  const fiveHour = windows.find((window) => window.id === 'five-hour');
  const weekly =
    windows.find((window) => window.id === 'weekly') ??
    windows.find((window) => window.id === 'monthly');
  const slots: QuotaCardSlots['slots'] = {};
  if (fiveHour) slots['five-hour'] = slotReading('five-hour', 'five-hour', fiveHour);
  if (weekly) {
    slots.weekly = slotReading('weekly', weekly.id === 'monthly' ? 'monthly' : 'weekly', weekly);
  }
  const extras = windows
    .filter((window) => window !== fiveHour && window !== weekly)
    .map((window) => windowExtra(t, window));
  return { slots, extras };
}

function xaiSlots(t: TFunction, quota: XaiQuotaState): QuotaCardSlots {
  const billing = quota.billing;
  if (!billing) return { slots: {}, extras: [] };
  if (billing.mode === 'paid-health') {
    return {
      slots: {},
      extras: [
        {
          id: 'paid-health',
          label: String(t('xai_quota.plan_paid')),
          remainingPercent: null,
          resetAtMs: null,
          resetLabel: null,
          detail: String(t('xai_quota.paid_health')),
        },
      ],
    };
  }
  const slots: QuotaCardSlots['slots'] = {};
  const weekly =
    billing.periodType === 'weekly' &&
    (billing.usagePercent !== null || Boolean(billing.periodEnd) || billing.productUsage.length > 0);
  if (weekly) {
    slots.weekly = {
      slot: 'weekly',
      variant: 'weekly',
      rowId: XAI_WEEKLY_ROW_ID,
      remainingPercent: remainingFromUsed(billing.usagePercent),
      resetAtMs: finite(billing.resetAtMs),
      resetLabel: cleanResetLabel(formatQuotaResetTime(billing.periodEnd)),
    };
  }
  const extras: QuotaExtraLimit[] = billing.productUsage.map((item) => ({
    id: `product-${item.product}`,
    label: String(t('xai_quota.product_usage', { product: item.product })),
    remainingPercent: null,
    resetAtMs: null,
    resetLabel: null,
    detail:
      item.usagePercent === null
        ? String(t('xai_quota.usage_unavailable'))
        : `${Math.round(clampPercent(item.usagePercent))}%`,
  }));
  const onDemandCap = billing.onDemandCapCents ?? 0;
  if (onDemandCap > 0) {
    extras.push({
      id: 'on-demand',
      label: String(t('xai_quota.pay_as_you_go_label')),
      remainingPercent: remainingFromUsed(billing.onDemandUsedPercent),
      resetAtMs: null,
      resetLabel: null,
      detail: formatXaiOnDemandAmount(billing),
    });
  }
  const monthly =
    (billing.monthlyLimitCents !== null ||
      billing.usedCents !== null ||
      Boolean(billing.billingPeriodEnd)) &&
    !(weekly && billing.monthlyLimitCents === 0 && billing.usedCents === 0);
  if (monthly) {
    const resetMs = billing.billingPeriodEnd ? Date.parse(billing.billingPeriodEnd) : NaN;
    extras.push({
      id: 'monthly-credits',
      label: String(t('xai_quota.monthly_credits')),
      remainingPercent: remainingFromUsed(billing.usedPercent),
      resetAtMs: Number.isFinite(resetMs) ? resetMs : null,
      resetLabel: cleanResetLabel(formatQuotaResetTime(billing.billingPeriodEnd)),
      detail: formatXaiRemainingAmount(billing),
    });
  }
  return { slots, extras };
}

/** Null means the provider has no slot mapping and keeps its own quota body. */
export function readQuotaSlots(
  t: TFunction,
  type: QuotaProviderType,
  quota: unknown,
  locale?: string
): QuotaCardSlots | null {
  if (!hasSlotMapping(type)) return null;
  if (!quota || typeof quota !== 'object') return { slots: {}, extras: [] };
  const status = (quota as { status?: string }).status;
  switch (type) {
    case 'claude':
      return claudeSlots(t, quota as ClaudeQuotaState, locale);
    case 'codex':
      return status === 'success'
        ? codexSlots(t, quota as CodexQuotaState)
        : { slots: {}, extras: [] };
    case 'xai':
      return status === 'success' ? xaiSlots(t, quota as XaiQuotaState) : { slots: {}, extras: [] };
    default:
      return null;
  }
}

/** A column reads "Monthly" only when every reading in it is a monthly window. */
export function columnVariant(
  slot: QuotaSlotId,
  readings: readonly (QuotaSlotReading | undefined)[]
): QuotaSlotVariant {
  if (slot !== 'weekly') return slot;
  const present = readings.filter((reading): reading is QuotaSlotReading => Boolean(reading));
  return present.length > 0 && present.every((reading) => reading.variant === 'monthly')
    ? 'monthly'
    : 'weekly';
}

const CLAUDE_PLAN_MULTIPLIERS: Record<string, number> = {
  plan_max20: 20,
  plan_max5: 5,
  plan_pro: 1,
};

/** Null when the plan label carries no multiplier (undifferentiated Max, Team, unknown). */
export const claudePlanMultiplier = (planType: string | null | undefined): number | null =>
  (planType && CLAUDE_PLAN_MULTIPLIERS[planType]) || null;

export interface PoolAccount {
  type: QuotaProviderType;
  /** Enabled, not ended and loaded: only these count toward a pool. */
  included: boolean;
  planType: string | null;
  slots: Partial<Record<QuotaSlotId, QuotaSlotReading>>;
}

export interface SlotPool {
  slot: QuotaSlotId;
  variant: QuotaSlotVariant;
  /** Weighted mean of percent remaining over the covered accounts. */
  remainingPercent: number | null;
  covered: number;
  total: number;
  /** False when no account in the group has this window. */
  available: boolean;
}

export interface GroupPools {
  pools: SlotPool[];
  weighted: boolean;
}

export function buildGroupPools(
  accounts: readonly PoolAccount[],
  columns: readonly QuotaSlotId[]
): GroupPools {
  const included = accounts.filter((account) => account.included);
  const claude = included.filter((account) => account.type === 'claude');
  const weighted =
    claude.length > 0 &&
    claude.every((account) => claudePlanMultiplier(account.planType) !== null);
  const weightOf = (account: PoolAccount) =>
    weighted && account.type === 'claude' ? (claudePlanMultiplier(account.planType) ?? 1) : 1;

  const pools = columns.map((slot): SlotPool => {
    const readings = accounts.map((account) => account.slots[slot]);
    const covering = included.filter((account) => {
      const reading = account.slots[slot];
      return reading !== undefined && reading.remainingPercent !== null;
    });
    const totalWeight = covering.reduce((sum, account) => sum + weightOf(account), 0);
    return {
      slot,
      variant: columnVariant(slot, readings),
      remainingPercent:
        totalWeight > 0
          ? covering.reduce(
              (sum, account) =>
                sum + weightOf(account) * (account.slots[slot]?.remainingPercent ?? 0),
              0
            ) / totalWeight
          : null,
      covered: covering.length,
      total: accounts.length,
      available: readings.some(Boolean),
    };
  });
  return { pools, weighted };
}
