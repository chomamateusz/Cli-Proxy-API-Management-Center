import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import type { ClaudeQuotaState, CodexQuotaState, KimiQuotaState, XaiQuotaState } from '@/types';
import {
  buildProviderSummary,
  buildQuotaRowModel,
  formatCountdown,
  maskCredentialName,
  maskEmail,
  remainingFromUsed,
  toneForRemaining,
} from '@/features/quota/quotaOverview';

const now = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const t = i18n.t.bind(i18n);

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

const claudeWindow = (
  id: string,
  labelKey: string,
  usedPercent: number | null,
  resetAtMs: number | null
) => ({ id, label: id, labelKey, usedPercent, resetLabel: '', resetAtMs });

const claudeQuota = (fableUsed: number | null, sevenDayUsed: number, resetInHours: number) =>
  ({
    status: 'success',
    planType: 'plan_max',
    windows: [
      claudeWindow('five-hour', 'claude_quota.five_hour', 0, null),
      claudeWindow('seven-day', 'claude_quota.seven_day', sevenDayUsed, now + resetInHours * HOUR),
      claudeWindow('seven-day-opus', 'claude_quota.seven_day_opus', 12, now + 30 * HOUR),
      ...(fableUsed === null
        ? []
        : [
            claudeWindow(
              'seven-day-fable',
              'claude_quota.seven_day_fable',
              fableUsed,
              now + resetInHours * HOUR
            ),
          ]),
    ],
  }) satisfies ClaudeQuotaState;

const codexQuota = (weeklyUsed: number, resetInHours: number): CodexQuotaState => ({
  status: 'success',
  planType: 'pro',
  windows: [
    {
      id: 'weekly',
      label: 'weekly',
      labelKey: 'codex_quota.secondary_window',
      usedPercent: weeklyUsed,
      resetLabel: '',
      resetAtMs: now + resetInHours * HOUR,
    },
  ],
  rateLimitResetCreditsAvailableCount: 2,
  rateLimitResetCredits: [],
});

describe('quota overview row model', () => {
  test('Claude rows show 7-day, then Fable, then 5-hour, and keep Opus out of the way', () => {
    const model = buildQuotaRowModel(t, 'claude', claudeQuota(42, 21, 30));
    expect(model?.primary.id).toBe('seven-day');
    expect(model?.primary.remainingPercent).toBe(79);
    expect(model?.metrics.map((metric) => metric.id)).toEqual([
      'seven-day',
      'seven-day-fable',
      'five-hour',
    ]);
    expect(model?.extra.map((metric) => metric.id)).toEqual(['seven-day-opus']);
  });

  test('Claude rows without Fable show 7-day and 5-hour', () => {
    const model = buildQuotaRowModel(t, 'claude', claudeQuota(null, 25, 30));
    expect(model?.metrics.map((metric) => metric.id)).toEqual(['seven-day', 'five-hour']);
  });

  test('rows without a successful quota have no model', () => {
    expect(buildQuotaRowModel(t, 'claude', undefined)).toBeNull();
    expect(
      buildQuotaRowModel(t, 'claude', { status: 'loading', windows: [] } as ClaudeQuotaState)
    ).toBeNull();
  });

  test('successful responses without bars fall back to the provider body and its empty state', () => {
    expect(
      buildQuotaRowModel(t, 'claude', { status: 'success', windows: [] } as ClaudeQuotaState)
    ).toBeNull();
    expect(
      buildQuotaRowModel(t, 'codex', { status: 'success', windows: [] } as CodexQuotaState)
    ).toBeNull();
    expect(
      buildQuotaRowModel(t, 'kimi', { status: 'success', rows: [] } as KimiQuotaState)
    ).toBeNull();
  });

  test('xAI rows read the billing period and unknown usage stays unknown', () => {
    const quota = {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usedPercent: null,
        usagePercent: null,
        resetAtMs: now + 5 * 24 * HOUR,
      },
    } as unknown as XaiQuotaState;
    const model = buildQuotaRowModel(t, 'xai', quota);
    expect(model?.primary.label).toBe('Weekly limit');
    expect(model?.primary.remainingPercent).toBeNull();
  });

  test('paid xAI health checks keep their own body instead of an invented weekly bar', () => {
    const quota = {
      status: 'success',
      billing: { mode: 'paid-health', periodType: 'unknown', usedPercent: null },
    } as unknown as XaiQuotaState;
    expect(buildQuotaRowModel(t, 'xai', quota)).toBeNull();
  });

  test('remaining percentages are clamped and toned', () => {
    expect(remainingFromUsed(120)).toBe(0);
    expect(remainingFromUsed(-5)).toBe(100);
    expect(remainingFromUsed(null)).toBeNull();
    expect(toneForRemaining(83)).toBe('high');
    expect(toneForRemaining(51)).toBe('medium');
    expect(toneForRemaining(17)).toBe('low');
    expect(toneForRemaining(null)).toBe('unknown');
  });
});

describe('provider summary', () => {
  test('pools the Claude 7-day limit across accounts, with Fable as the second pool', () => {
    const summary = buildProviderSummary(
      t,
      'claude',
      [
        claudeQuota(0, 0, 120),
        claudeQuota(49, 25, 21),
        claudeQuota(0, 0, 96),
        claudeQuota(0, 0, 100),
        claudeQuota(42, 21, 30),
      ],
      now
    );
    expect(summary.pool).toEqual({
      label: t('claude_quota.seven_day'),
      remaining: 454,
      capacity: 500,
    });
    expect(summary.secondaryPool).toEqual({
      label: t('claude_quota.seven_day_fable'),
      remaining: 409,
      capacity: 500,
    });
    expect(summary.loadedCount).toBe(5);
    expect(summary.nextResetAtMs).toBe(now + 21 * HOUR);
    expect(summary.nextResetGain).toBe(25);
    expect(summary.hasExtraBuckets).toBe(true);
  });

  test('the next reset refills every account resetting at that minute', () => {
    const summary = buildProviderSummary(
      t,
      'codex',
      [codexQuota(83, 27), codexQuota(100, 49), codexQuota(100, 27)],
      now
    );
    expect(summary.pool?.remaining).toBe(17);
    expect(summary.pool?.capacity).toBe(300);
    expect(summary.secondaryPool).toBeNull();
    expect(summary.nextResetAtMs).toBe(now + 27 * HOUR);
    expect(summary.nextResetGain).toBe(183);
    expect(summary.hasExtraBuckets).toBe(false);
  });

  test('accounts that have not loaded stay out of the pool and past resets are skipped', () => {
    const summary = buildProviderSummary(t, 'codex', [undefined, codexQuota(10, -1)], now);
    expect(summary.credentialCount).toBe(2);
    expect(summary.loadedCount).toBe(1);
    expect(summary.pool).toEqual({
      label: summary.pool?.label ?? '',
      remaining: 90,
      capacity: 100,
    });
    expect(summary.nextResetAtMs).toBeNull();
    expect(summary.nextResetGain).toBeNull();
    expect(buildProviderSummary(t, 'codex', [undefined], now).pool).toBeNull();
  });
});

describe('email masking', () => {
  test('masks the local part and the first domain label', () => {
    expect(maskEmail('tooling@lumen.dev')).toBe('t•••@l•••.dev');
    expect(maskEmail('no email here')).toBe('no email here');
  });

  test('masks the whole local part when it contains hyphens', () => {
    expect(maskEmail('john-doe@example.com')).toBe('j•••@e•••.com');
    expect(maskCredentialName('john-doe@example.com')).toBe('j•••@e•••.com');
    expect(maskCredentialName('claude-john-doe@example.com.json')).toBe(
      'claude-j•••@e•••.com.json'
    );
    expect(maskCredentialName('codex-ae5d455f-mary-jane-watson@lumen.dev-pro.json')).toBe(
      'codex-ae5d455f-m•••@l•••.dev-pro.json'
    );
  });

  test('keeps the provider and account prefix of credential names readable', () => {
    expect(maskCredentialName('claude-tasks@tide.gg.json')).toBe('claude-t•••@t•••.gg.json');
    expect(maskCredentialName('codex-ae5d455f-tooling@lumen.dev-pro.json')).toBe(
      'codex-ae5d455f-t•••@l•••.dev-pro.json'
    );
    expect(maskCredentialName('vertex-project.json')).toBe('vertex-project.json');
  });

  test('masks the identity in Devin lane names', () => {
    expect(maskCredentialName('shared.json · ana-maria@corp.io')).toBe(
      'shared.json · a•••@c•••.io'
    );
  });

  test('never leaves any part of a hyphenated local part visible', () => {
    const masked = maskCredentialName('claude-deadbeef-first-last@example.com.json');
    expect(masked).not.toContain('first');
    expect(masked).not.toContain('last');
    expect(masked).not.toContain('deadbeef');
  });
});

describe('countdown', () => {
  test('shows the two largest units', () => {
    expect(formatCountdown(now + 2 * 24 * HOUR + 30 * 60 * 1000, now)).toBe('2d 0h');
    expect(formatCountdown(now + 19 * HOUR + 12 * 60 * 1000, now)).toBe('19h 12m');
    expect(formatCountdown(now + 30 * 1000, now)).toBe('1m');
    expect(formatCountdown(now - HOUR, now)).toBe('0m');
  });
});
