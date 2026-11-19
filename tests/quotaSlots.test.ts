import { describe, expect, mock, test } from 'bun:test';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import {
  buildGroupPools,
  claudePlanMultiplier,
  columnVariant,
  hasQuotaReadings,
  readQuotaSlots,
  slotColumnsFor,
  type PoolAccount,
  type QuotaSlotReading,
} from '@/features/quota/quotaSlots';

const sheets = [
  'QuotaBody',
  'QuotaCard',
  'QuotaSlot',
  'QuotaCardSection',
  'QuotaCardGroup',
  'CredentialEndControl',
  'PrivateText',
];
for (const sheet of sheets) {
  mock.module(
    join(import.meta.dir, `../src/features/quota/components/${sheet}.module.scss`),
    () => ({
      default: new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) }),
    })
  );
}
const { default: i18n } = await import('@/i18n');
const { QuotaCard } = await import('@/features/quota/components/QuotaCard');
const { QuotaSlot } = await import('@/features/quota/components/QuotaSlot');
const { QuotaCardGroup } = await import('@/features/quota/components/QuotaCardGroup');
const { bindQuotaClasses, QUOTA_CLASS_KEYS } = await import('@/features/quota/types');

const t = ((key: string) => key) as unknown as TFunction;
const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 86_400_000;
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);

const claudeQuota = (windows: { id: string; used: number }[], planType = 'plan_max20') => ({
  status: 'success' as const,
  planType,
  observedAt: new Date(NOW).toISOString(),
  windows: windows.map(({ id, used }) => ({
    id,
    label: id,
    usedPercent: used,
    resetLabel: '11/20 12:00',
    resetAtMs: NOW + DAY,
  })),
  extraUsage: null,
  dollarWindows: [],
});

const codexQuota = (windows: { id: string; used: number; periodHours?: number }[]) => ({
  status: 'success' as const,
  planType: 'pro',
  windows: windows.map(({ id, used, periodHours }) => ({
    id,
    label: id,
    usedPercent: used,
    resetLabel: '11/20 12:00',
    resetAtMs: NOW + DAY,
    periodHours: periodHours ?? null,
  })),
});

const reading = (slot: QuotaSlotReading['slot'], remaining: number): QuotaSlotReading => ({
  slot,
  variant: slot,
  rowId: slot,
  remainingPercent: remaining,
  resetAtMs: null,
  resetLabel: null,
});

function account(
  type: PoolAccount['type'],
  planType: string | null,
  slots: PoolAccount['slots'],
  included = true
): PoolAccount {
  return { type, planType, slots, included };
}

describe('slot mapping', () => {
  test('Claude maps five-hour, weekly and the weekly Fable window; the rest is extra', () => {
    const slots = readQuotaSlots(
      t,
      'claude',
      claudeQuota([
        { id: 'five-hour', used: 10 },
        { id: 'seven-day', used: 40 },
        { id: 'seven-day-fable', used: 70 },
        { id: 'seven-day-opus', used: 5 },
      ])
    );
    expect(slots?.slots['five-hour']?.remainingPercent).toBe(90);
    expect(slots?.slots.weekly?.remainingPercent).toBe(60);
    expect(slots?.slots.model?.remainingPercent).toBe(30);
    expect(slots?.extras.map((extra) => extra.id)).toEqual(['seven-day-opus']);
  });

  test('a Claude account without a five-hour window leaves that slot empty', () => {
    const slots = readQuotaSlots(t, 'claude', claudeQuota([{ id: 'seven-day', used: 0 }]));
    expect(Object.keys(slots?.slots ?? {})).toEqual(['weekly']);
  });

  test('Codex puts a monthly window into the weekly slot under its own label', () => {
    const slots = readQuotaSlots(
      t,
      'codex',
      codexQuota([
        { id: 'five-hour', used: 20 },
        { id: 'monthly', used: 50 },
        { id: 'code-review-weekly', used: 0 },
      ])
    );
    expect(slots?.slots.weekly?.variant).toBe('monthly');
    expect(slots?.slots.model).toBeUndefined();
    expect(slots?.extras.map((extra) => extra.id)).toEqual(['code-review-weekly']);
  });

  test('xAI fills only the weekly slot and moves the breakdown into extras', () => {
    const slots = readQuotaSlots(t, 'xai', {
      status: 'success',
      billing: {
        mode: 'billing',
        periodType: 'weekly',
        usagePercent: 2,
        periodEnd: new Date(NOW + DAY).toISOString(),
        resetAtMs: NOW + DAY,
        productUsage: [{ product: 'GrokBuild', usagePercent: 2 }],
        monthlyLimitCents: 0,
        usedCents: 0,
        includedUsedCents: 0,
        onDemandCapCents: 0,
        onDemandUsedCents: 0,
        onDemandUsedPercent: null,
        usedPercent: null,
      },
    });
    expect(Object.keys(slots?.slots ?? {})).toEqual(['weekly']);
    expect(slots?.slots.weekly?.remainingPercent).toBe(98);
    expect(slots?.extras.map((extra) => extra.id)).toEqual(['product-GrokBuild']);
  });

  test('Claude dollar limits keep the remaining amount without a dollar cap', async () => {
    await i18n.changeLanguage('en');
    const slots = readQuotaSlots(
      i18n.t.bind(i18n),
      'claude',
      {
        ...claudeQuota([]),
        dollarWindows: [
          { key: 'balance', limitDollars: null, remainingDollars: 12.34, usedDollars: 5 },
        ],
      },
      'en'
    );
    expect(slots?.extras[0].remainingPercent).toBeNull();
    expect(slots?.extras[0].detail).toContain('$12.34');
    expect(slots?.extras[0].detail).toContain('$5.00');
  });

  test.each(['loading', 'error'] as const)(
    'retained Claude readings count as loaded during %s',
    (status) => {
      const quota = { ...claudeQuota([{ id: 'seven-day', used: 30 }]), status };
      expect(hasQuotaReadings('claude', quota)).toBe(true);
      expect(hasQuotaReadings('claude', { status })).toBe(false);
      expect(hasQuotaReadings('codex', { status })).toBe(false);
      expect(readQuotaSlots(t, 'claude', quota)?.slots.weekly?.remainingPercent).toBe(70);
    }
  );

  test('unmapped providers keep their own body', () => {
    for (const type of ['antigravity', 'devin', 'meta', 'plugin', 'kimi'] as const) {
      expect(readQuotaSlots(t, type, { status: 'success' })).toBeNull();
    }
  });

  test('page columns are the union of the present providers, in slot order', () => {
    expect(slotColumnsFor(['xai'])).toEqual(['weekly']);
    expect(slotColumnsFor(['xai', 'codex'])).toEqual(['five-hour', 'weekly']);
    expect(slotColumnsFor(['codex', 'claude', 'kimi'])).toEqual(['five-hour', 'weekly', 'model']);
    expect(slotColumnsFor(['kimi'])).toEqual([]);
  });

  test('a column reads monthly only when every reading in it is monthly', () => {
    const monthly = { ...reading('weekly', 10), variant: 'monthly' as const };
    expect(columnVariant('weekly', [monthly, undefined])).toBe('monthly');
    expect(columnVariant('weekly', [monthly, reading('weekly', 20)])).toBe('weekly');
    expect(columnVariant('weekly', [])).toBe('weekly');
  });
});

describe('pooled group bars', () => {
  test('plan multipliers come from the Claude plan label', () => {
    expect(claudePlanMultiplier('plan_max20')).toBe(20);
    expect(claudePlanMultiplier('plan_max5')).toBe(5);
    expect(claudePlanMultiplier('plan_pro')).toBe(1);
    expect(claudePlanMultiplier('plan_max')).toBeNull();
    expect(claudePlanMultiplier(null)).toBeNull();
  });

  test('Claude accounts weigh by plan size', () => {
    const { pools, weighted } = buildGroupPools(
      [
        account('claude', 'plan_max20', { weekly: reading('weekly', 100) }),
        account('claude', 'plan_max5', { weekly: reading('weekly', 0) }),
      ],
      ['weekly']
    );
    expect(weighted).toBe(true);
    expect(pools[0].remainingPercent).toBe(80);
    expect(pools[0]).toMatchObject({ covered: 2, total: 2, available: true });
  });

  test('one Claude account without a readable multiplier makes the group unweighted', () => {
    const { pools, weighted } = buildGroupPools(
      [
        account('claude', 'plan_max20', { weekly: reading('weekly', 100) }),
        account('claude', 'plan_max', { weekly: reading('weekly', 0) }),
      ],
      ['weekly']
    );
    expect(weighted).toBe(false);
    expect(pools[0].remainingPercent).toBe(50);
  });

  test('coverage totals count only providers that support each slot', () => {
    const { pools } = buildGroupPools(
      [
        account('claude', 'plan_pro', {
          weekly: reading('weekly', 60),
          model: reading('model', 20),
        }),
        account('codex', null, { weekly: reading('weekly', 40) }),
        account('xai', null, { weekly: reading('weekly', 80) }),
      ],
      ['five-hour', 'weekly', 'model']
    );
    expect(pools.map(({ slot, covered, total }) => [slot, covered, total])).toEqual([
      ['five-hour', 0, 2],
      ['weekly', 3, 3],
      ['model', 1, 1],
    ]);
  });

  test('disabled, ended or unloaded accounts and missing windows are left out', () => {
    const { pools } = buildGroupPools(
      [
        account('codex', null, {
          'five-hour': reading('five-hour', 40),
          weekly: reading('weekly', 60),
        }),
        account('codex', null, { weekly: reading('weekly', 20) }),
        account('codex', null, { weekly: reading('weekly', 0) }, false),
      ],
      ['five-hour', 'weekly', 'model']
    );
    expect(
      pools.map((pool) => [pool.slot, pool.remainingPercent, pool.covered, pool.total])
    ).toEqual([
      ['five-hour', 40, 1, 3],
      ['weekly', 40, 2, 3],
      ['model', null, 0, 0],
    ]);
    expect(pools[2].available).toBe(false);
  });
});

describe('aligned slot markup', () => {
  const props = (type: 'claude' | 'codex', quota: unknown, file = {}) => ({
    entry: { file: { name: `${type}.json`, type, ...file }, type },
    quota: quota as never,
    resolvedTheme: 'dark' as const,
    canRefresh: true,
    resetting: false,
    onRefresh() {},
    onReset() {},
    canEditEnd: false,
    endActions: {
      save: async () => undefined,
      cancel: async () => 'scheduled' as const,
      nextPeriod: async () => undefined,
    },
    nowMs: NOW,
    slotColumns: ['five-hour', 'weekly', 'model'] as const,
  });

  const slotStates = (markup: string) =>
    [...markup.matchAll(/class="slot" data-state="(\w+)"/g)].map((match) => match[1]);

  test('a disabled slot keeps its label, an em dash and an accessible name', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaSlot, { variant: 'five-hour', state: 'off', classes })
    );
    expect(markup).toContain('aria-label="5-hour: not available for this account"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('>5-hour<');
    expect(markup).toContain('>—<');
    expect(markup).toContain('class="head"');
    expect(markup).toContain('class="foot"');
    expect(markup).toContain('quotaBar track');
  });

  test('a Codex card on a Claude page shows three slots with the model slot disabled', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(
        QuotaCard,
        props(
          'codex',
          codexQuota([
            { id: 'five-hour', used: 10, periodHours: 5 },
            { id: 'weekly', used: 40, periodHours: 168 },
          ])
        )
      )
    );
    expect(slotStates(markup)).toEqual(['live', 'live', 'off']);
    expect(markup).toContain('aria-label="Weekly Fable: not available for this account"');
  });

  test('a Max 20x card without a five-hour window keeps the slot, disabled, in first place', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(
        QuotaCard,
        props(
          'claude',
          claudeQuota([
            { id: 'seven-day', used: 20 },
            { id: 'seven-day-fable', used: 40 },
          ])
        )
      )
    );
    expect(slotStates(markup)).toEqual(['off', 'live', 'live']);
    expect(markup.indexOf('class="slots"')).toBeLessThan(markup.indexOf('aria-label="End date'));
  });

  test('extra usage and other limits are collapsed disclosures below the slots', async () => {
    await i18n.changeLanguage('en');
    const quota = {
      ...claudeQuota([
        { id: 'seven-day', used: 20 },
        { id: 'seven-day-opus', used: 40 },
      ]),
      extraUsage: {
        isEnabled: false,
        monthlyLimit: 10_000,
        usedCredits: 0,
        utilization: 0,
        currency: 'EUR',
        disabledReason: 'out_of_credits',
        userDisabled: null,
        spendLimitReached: null,
      },
    };
    const markup = renderToStaticMarkup(createElement(QuotaCard, props('claude', quota)));
    const toggles = [...markup.matchAll(/aria-expanded="(\w+)"/g)].map((match) => match[1]);
    expect(toggles).toEqual(['false', 'false']);
    expect(markup).toContain('>Extra Usage<');
    expect(markup).toContain('class="summary">Disabled<');
    expect(markup).toContain('>More limits<');
    expect(markup).toContain('hidden=""');
    expect(markup.indexOf('class="slots"')).toBeLessThan(markup.indexOf('aria-expanded'));
  });

  test('Codex shows the known reset count when credit details fail', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(
        QuotaCard,
        props('codex', {
          ...codexQuota([]),
          rateLimitResetCredits: [],
          rateLimitResetCreditsAvailableCount: 3,
          rateLimitResetCreditsError: 'details unavailable',
        })
      )
    );
    expect(markup).toContain('Resets (3)');
    expect(markup).toContain('details unavailable');
  });

  test('Codex uses listed resets when details are present', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(
        QuotaCard,
        props('codex', {
          ...codexQuota([]),
          rateLimitResetCredits: [
            { status: 'available', expiresAt: new Date(NOW + DAY).toISOString() },
          ],
          rateLimitResetCreditsAvailableCount: 3,
        })
      )
    );
    expect(markup).toContain('Resets (1)');
  });

  test('an unloaded card still reserves every slot', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(createElement(QuotaCard, props('claude', undefined)));
    expect(slotStates(markup)).toEqual(['pending', 'pending', 'pending']);
    expect(markup).toContain('Refresh quota');
  });

  test('a group with nothing loaded points at refresh all', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaCardGroup, {
        kind: 'others',
        type: null,
        accountCount: 3,
        loadedCount: 0,
        pools: buildGroupPools([], ['weekly']),
        resolvedTheme: 'dark',
        routerStrategy: 'round-robin',
        children: null,
      })
    );
    expect(markup).toContain('All others');
    expect(markup).toContain('Use “Refresh all credentials” to read every account.');
    expect(markup).toContain('Routing currently uses round-robin');
  });

  test('pool coverage, not the success count, controls the empty prompt', async () => {
    await i18n.changeLanguage('en');
    const groupProps = {
      kind: 'all' as const,
      type: null,
      accountCount: 1,
      resolvedTheme: 'dark' as const,
      routerStrategy: null,
      children: null,
    };
    const covered = renderToStaticMarkup(
      createElement(QuotaCardGroup, {
        ...groupProps,
        loadedCount: 0,
        pools: buildGroupPools(
          [account('claude', 'plan_pro', { weekly: reading('weekly', 70) })],
          ['weekly']
        ),
      })
    );
    expect(covered).toContain('Weekly: 70% left across 1 of 1 accounts');
    expect(covered).not.toContain('No quota loaded yet');
    const uncovered = renderToStaticMarkup(
      createElement(QuotaCardGroup, {
        ...groupProps,
        loadedCount: 1,
        pools: buildGroupPools([account('claude', 'plan_pro', {}, false)], ['weekly']),
      })
    );
    expect(uncovered).toContain('No quota loaded yet');
  });

  test('unsupported pools have no account coverage line', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaCardGroup, {
        kind: 'provider',
        type: 'codex',
        accountCount: 1,
        loadedCount: 1,
        pools: buildGroupPools(
          [account('codex', null, { weekly: reading('weekly', 50) })],
          ['weekly', 'model']
        ),
        resolvedTheme: 'dark',
        routerStrategy: null,
        children: null,
      })
    );
    expect(markup).toContain('Weekly Fable: no account in this group has this limit');
    expect(markup).not.toContain('0 of 0 accounts');
    expect(markup).not.toContain('0 of 1 accounts');
  });

  test('a weighted pool says so in visible text', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaCardGroup, {
        kind: 'provider',
        type: 'claude',
        accountCount: 2,
        loadedCount: 2,
        pools: buildGroupPools(
          [
            account('claude', 'plan_max20', { weekly: reading('weekly', 50) }),
            account('claude', 'plan_max5', { weekly: reading('weekly', 50) }),
          ],
          ['five-hour', 'weekly']
        ),
        resolvedTheme: 'dark',
        routerStrategy: 'use-or-lose',
        children: null,
      })
    );
    expect(markup).toContain('2 of 2 accounts · weighted by plan');
    expect(markup).toContain('aria-label="Weekly: 50% left across 2 of 2 accounts"');
    expect(markup).toContain('aria-label="5-hour: no account in this group has this limit"');
    expect(markup).toContain('use-or-lose estimate for new sessions.');
  });
});
