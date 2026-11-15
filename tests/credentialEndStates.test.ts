import { describe, expect, mock, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { authFilesApi, normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import {
  countResetsOutlivingEnd,
  readCredentialEnd,
  unusedResetsForCredential,
  withCredentialEnd,
} from '../src/features/quota/credentialEnd';
import {
  buildTimelineLane,
  projectLane,
  projectResetCredits,
  timelineSpan,
  type TimelineLane,
} from '../src/features/quota/quotaTimelineModel';
import { draftFromBoard, resolveRoute } from '../src/features/routing/logic';
import { buildRoutingBoard } from '../src/services/api/routing';
import { credentialEndStateAt } from '../src/utils/quota/credentialEndState';
import type { AuthFileItem } from '../src/types';

const sheets = ['QuotaBody', 'QuotaCard', 'QuotaAccountRow', 'PrivateText', 'CredentialEndControl'];
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
const { QuotaAccountRow } = await import('@/features/quota/components/QuotaAccountRow');
const { QuotaTimeline } = await import('@/features/quota/components/QuotaTimeline');

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();
const NOW = at(2026, 6, 29, 12);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const noEndActions = {
  save: async () => undefined,
  cancel: async () => 'scheduled' as const,
  nextPeriod: async () => undefined,
};

describe('credential end list fields', () => {
  test('the normalizer keeps state, source, cancel marker, warnings, anchor and check time', () => {
    const { files } = normalizeAuthFilesResponse({
      files: [
        {
          name: 'a.json',
          fleet_ends_at: '2026-08-07T21:09:56Z',
          fleet_ended: false,
          fleet_end_state: 'overdue',
          fleet_ends_at_source: 'claude-anniversary',
          fleet_cancelled_at: '2026-07-20T10:00:00Z',
          fleet_end_warnings: [
            { code: 'grace_period', until: '2026-08-10T00:00:00Z' },
            { code: 'provider_renews' },
            { until: 'no code' },
            'junk',
          ],
          fleet_billing_anchor: '2026-01-07T21:09:56.274004Z',
          fleet_end_checked_at: '2026-07-29T11:00:00Z',
        },
        { name: 'b.json', fleet_end_state: 'someday', fleet_ends_at_source: 'oracle' },
      ],
    });
    const byName = new Map(files.map((file) => [file.name, file]));
    expect(byName.get('a.json')).toMatchObject({
      fleetEndsAt: '2026-08-07T21:09:56Z',
      fleetEnded: false,
      fleetEndState: 'overdue',
      fleetEndsAtSource: 'claude-anniversary',
      fleetCancelledAt: '2026-07-20T10:00:00Z',
      fleetEndWarnings: [
        { code: 'grace_period', until: '2026-08-10T00:00:00Z' },
        { code: 'provider_renews' },
      ],
      fleetBillingAnchor: '2026-01-07T21:09:56.274004Z',
      fleetEndCheckedAt: '2026-07-29T11:00:00Z',
    });
    expect(byName.get('b.json')?.fleetEndState).toBeUndefined();
    expect(byName.get('b.json')?.fleetEndsAtSource).toBeUndefined();
  });
});

describe('credential end states', () => {
  const end = NOW - DAY;
  test('no end is none and a future end is scheduled', () => {
    expect(credentialEndStateAt({ endsAtMs: null }, NOW)).toBe('none');
    expect(
      credentialEndStateAt({ endsAtMs: NOW + DAY, reportedState: 'overdue', source: 'manual' }, NOW)
    ).toBe('scheduled');
  });

  test('a passed hand-set or anniversary end is overdue until the backend ends it', () => {
    for (const source of ['manual', 'claude-anniversary'] as const) {
      expect(credentialEndStateAt({ endsAtMs: end, reportedState: 'scheduled', source }, NOW)).toBe(
        'overdue'
      );
      expect(credentialEndStateAt({ endsAtMs: end, reportedState: 'ended', source }, NOW)).toBe(
        'ended'
      );
    }
  });

  test('a passed provider-confirmed end is ended without waiting for the list', () => {
    for (const source of ['codex-api', 'plan-ended'] as const) {
      expect(credentialEndStateAt({ endsAtMs: end, reportedState: 'scheduled', source }, NOW)).toBe(
        'ended'
      );
    }
  });

  test('a backend without end states ends the credential at its date', () => {
    expect(credentialEndStateAt({ endsAtMs: end }, NOW)).toBe('ended');
    expect(credentialEndStateAt({ endsAtMs: NOW + DAY, reportedEnded: true }, NOW)).toBe('ended');
  });

  test('only ended counts as ended for the card', () => {
    const file: AuthFileItem = {
      name: 'x.json',
      fleetEndsAt: iso(end),
      fleetEndState: 'overdue',
      fleetEndsAtSource: 'manual',
    };
    expect(readCredentialEnd(file, NOW)).toMatchObject({
      state: 'overdue',
      ended: false,
      source: 'manual',
    });
  });
});

describe('local end edits', () => {
  const file: AuthFileItem = {
    name: 'x.json',
    fleetEndsAt: iso(NOW + DAY),
    fleetEndState: 'scheduled',
    fleetEndsAtSource: 'codex-api',
    fleetCancelledAt: iso(NOW - DAY),
    fleetEndWarnings: [{ code: 'provider_renews' }, { code: 'grace_period', until: iso(NOW) }],
    fleetBillingAnchor: '2026-01-07T21:09:56Z',
  };

  test('a saved date is a hand-set end with a fresh state', () => {
    expect(withCredentialEnd(file, iso(NOW + 2 * DAY), NOW)).toMatchObject({
      fleetEndsAtSource: 'manual',
      fleetEndState: 'scheduled',
      fleetEnded: false,
      fleetBillingAnchor: '2026-01-07T21:09:56Z',
    });
    expect(withCredentialEnd(file, iso(NOW - DAY), NOW).fleetEndState).toBe('overdue');
    expect(withCredentialEnd(file, iso(NOW + 2 * DAY), NOW).fleetCancelledAt).toBeUndefined();
  });

  test('clearing drops the source, cancel marker and the renew warning only', () => {
    const cleared = withCredentialEnd(file, null, NOW);
    expect(cleared.fleetEndsAt).toBeUndefined();
    expect(cleared.fleetEndsAtSource).toBeUndefined();
    expect(cleared.fleetCancelledAt).toBeUndefined();
    expect(cleared.fleetEndState).toBeUndefined();
    expect(cleared.fleetEndWarnings).toEqual([{ code: 'grace_period', until: iso(NOW) }]);
    expect(cleared.fleetBillingAnchor).toBe('2026-01-07T21:09:56Z');
  });
});

describe('unused resets at the end', () => {
  const endsAtMs = NOW + 10 * DAY;

  test('only resets expiring after the end, or never, are lost with the account', () => {
    expect(
      countResetsOutlivingEnd(endsAtMs, [
        { count: 2, expiresAtMs: NOW + 5 * DAY },
        { count: 1, expiresAtMs: NOW + 20 * DAY },
        { count: 3, expiresAtMs: null },
      ])
    ).toBe(4);
    expect(countResetsOutlivingEnd(null, [{ count: 1, expiresAtMs: null }])).toBe(0);
  });

  test('Claude grant lines and Codex credits feed the count for scheduled and overdue ends', () => {
    const lines = [
      { resetsLeft: 1, endsAt: iso(NOW + 29 * DAY) },
      { resetsLeft: 2, endsAt: iso(NOW + 5 * DAY) },
      { resetsLeft: null, endsAt: null },
    ];
    const scheduled = { endsAtMs, state: 'scheduled' as const };
    expect(unusedResetsForCredential('claude', scheduled, undefined, lines)).toBe(1);
    expect(
      unusedResetsForCredential('claude', { ...scheduled, state: 'ended' }, undefined, lines)
    ).toBe(0);
    const codexQuota = {
      status: 'success',
      rateLimitResetCredits: [
        { id: 'a', status: 'available', expiresAt: iso(NOW + 30 * DAY) },
        { id: 'b', status: 'available', expiresAt: iso(NOW + 2 * DAY) },
        { id: 'c', status: 'used', expiresAt: iso(NOW + 30 * DAY) },
      ],
    };
    expect(
      unusedResetsForCredential('codex', { ...scheduled, state: 'overdue' }, codexQuota, [])
    ).toBe(1);
    expect(
      unusedResetsForCredential('codex', { endsAtMs: null, state: 'none' }, codexQuota, [])
    ).toBe(0);
  });
});

describe('end actions over the API', () => {
  test('cancel and next period patch the credential fields', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    try {
      expect(await authFilesApi.markSubscriptionCancelled('a.json')).toBe('scheduled');
      await authFilesApi.moveEndToNextPeriod('a.json');
      expect(patch.mock.calls).toEqual([
        ['/credentials/fields', { name: 'a.json', fleet_cancelled: true }],
        ['/credentials/fields', { name: 'a.json', fleet_end_action: 'next_period' }],
      ]);
    } finally {
      patch.mockRestore();
    }
  });

  test('a missing billing anchor is an outcome, other failures stay errors', async () => {
    const anchorless = Object.assign(new Error('no_billing_anchor'), {
      status: 400,
      apiCode: 'no_billing_anchor',
    });
    const patch = spyOn(apiClient, 'patch').mockRejectedValueOnce(anchorless);
    try {
      expect(await authFilesApi.markSubscriptionCancelled('a.json')).toBe('no_billing_anchor');
      const boom = Object.assign(new Error('boom'), { status: 500 });
      patch.mockRejectedValueOnce(boom);
      await expect(authFilesApi.markSubscriptionCancelled('a.json')).rejects.toBe(boom);
    } finally {
      patch.mockRestore();
    }
  });
});

describe('end controls on cards and rows', () => {
  const claudeQuota = {
    status: 'success' as const,
    planType: 'plan_max',
    windows: [],
    extraUsage: null,
  };
  const codexQuota = {
    status: 'success' as const,
    planType: 'pro',
    windows: [],
    rateLimitResetCredits: [
      { id: 'a', status: 'available', grantedAt: iso(NOW), expiresAt: iso(NOW + 30 * DAY) },
      { id: 'b', status: 'available', grantedAt: iso(NOW), expiresAt: iso(NOW + 40 * DAY) },
    ],
  };
  const props = (file: AuthFileItem, type: 'claude' | 'codex') => ({
    entry: { file, type },
    quota: type === 'claude' ? claudeQuota : codexQuota,
    resolvedTheme: 'light' as const,
    canRefresh: true,
    resetting: false,
    onRefresh() {},
    onReset() {},
    canEditEnd: true,
    endActions: noEndActions,
    nowMs: NOW,
  });
  const card = (file: AuthFileItem, type: 'claude' | 'codex') =>
    renderToStaticMarkup(createElement(QuotaCard, props(file, type)));
  const row = (file: AuthFileItem, type: 'claude' | 'codex') =>
    renderToStaticMarkup(
      createElement(QuotaAccountRow, {
        ...props(file, type),
        model: null,
        metricColumns: [],
        extrasColumn: null,
        label: { name: file.name, detail: null },
        nameInMessages: file.name,
        providerLabel: type,
        showEmails: true,
      })
    );

  test('a Claude credential without an end offers Cancelled, Codex does not', async () => {
    await i18n.changeLanguage('en');
    expect(card({ name: 'claude.json', type: 'claude' }, 'claude')).toContain('>Cancelled<');
    expect(row({ name: 'claude.json', type: 'claude' }, 'claude')).toContain('>Cancelled<');
    expect(card({ name: 'codex.json', type: 'codex' }, 'codex')).not.toContain('>Cancelled<');
    const withEnd = card(
      {
        name: 'claude.json',
        type: 'claude',
        fleetEndsAt: iso(NOW + DAY),
        fleetEndState: 'scheduled',
      },
      'claude'
    );
    expect(withEnd).not.toContain('>Cancelled<');
  });

  test('every end names its source', async () => {
    await i18n.changeLanguage('en');
    const labels = {
      manual: 'set by hand',
      'claude-anniversary': 'billing anniversary',
      'codex-api': 'from ChatGPT',
      'plan-ended': 'plan ended',
    } as const;
    for (const [source, label] of Object.entries(labels)) {
      const markup = card(
        {
          name: 'codex.json',
          type: 'codex',
          fleetEndsAt: iso(NOW + DAY),
          fleetEndState: 'scheduled',
          fleetEndsAtSource: source as keyof typeof labels,
        },
        'codex'
      );
      expect(markup).toContain(`>${label}<`);
    }
  });

  test('an overdue end asks for confirmation with three actions on card and row', async () => {
    await i18n.changeLanguage('en');
    const file: AuthFileItem = {
      name: 'claude.json',
      type: 'claude',
      fleetEndsAt: iso(at(2026, 6, 27, 9)),
      fleetEndState: 'overdue',
      fleetEndsAtSource: 'claude-anniversary',
    };
    for (const markup of [card(file, 'claude'), row(file, 'claude')]) {
      expect(markup).toContain('data-state="overdue"');
      expect(markup).toMatch(/Still active after [^<]+\. Really cancelled\?/);
      expect(markup).toContain('>Not cancelled<');
      expect(markup).toContain('>Next period<');
      expect(markup).toContain('>Set date<');
      expect(markup).toContain('data-ended="0"');
      expect(markup).not.toContain('>Ended<');
    }
    const scheduled = card(
      { ...file, fleetEndsAt: iso(NOW + DAY), fleetEndState: 'scheduled' },
      'claude'
    );
    expect(scheduled).not.toContain('Really cancelled?');
  });

  test('provider warnings and resets lost at the end are spelled out', async () => {
    await i18n.changeLanguage('en');
    const markup = card(
      {
        name: 'codex.json',
        type: 'codex',
        fleetEndsAt: iso(NOW + 35 * DAY),
        fleetEndState: 'scheduled',
        fleetEndsAtSource: 'manual',
        fleetEndWarnings: [
          { code: 'provider_renews' },
          { code: 'grace_period', until: iso(NOW + 3 * DAY) },
          { code: 'future_code' },
        ],
      },
      'codex'
    );
    expect(markup).toContain('ChatGPT says this subscription renews. Remove the end date?');
    expect(markup).toContain('>Remove end date<');
    expect(markup).toMatch(/Payment overdue; access ends [^<]+</);
    expect(markup).toContain('1 unused reset ends with this account');
    expect(markup).not.toContain('future_code');
  });

  test('without an end the renew warning and lost-reset note stay hidden', async () => {
    await i18n.changeLanguage('en');
    const markup = card(
      { name: 'codex.json', type: 'codex', fleetEndWarnings: [{ code: 'provider_renews' }] },
      'codex'
    );
    expect(markup).not.toContain('renews');
    expect(markup).not.toContain('unused reset');
  });
});

describe('timeline for overdue and ended lanes', () => {
  const span = timelineSpan('weekly', 0, NOW);
  const end = at(2026, 6, 27, 9);
  const lane = (endState: TimelineLane['endState']): TimelineLane => ({
    name: 'a.json',
    displayName: 'Alice',
    provider: 'codex',
    anchorMs: at(2026, 6, 29, 20),
    periodHours: 24 * 7,
    remaining: 40,
    limits: [],
    resetCredits: [{ id: 'later', grantedAtMs: null, expiresAtMs: at(2026, 7, 3, 12) }],
    endsAtMs: end,
    endState,
  });

  test('an overdue lane keeps projecting windows and credits past its end', () => {
    const overdue = projectLane(lane('overdue'), span.startMs, span.endMs, NOW, 'weekly');
    expect(overdue.some((window) => window.state === 'live')).toBe(true);
    expect(overdue.some((window) => window.startMs > end)).toBe(true);
    expect(projectResetCredits(lane('overdue'), span.startMs, span.endMs, NOW)).toHaveLength(1);
  });

  test('an ended lane is still cut at its end', () => {
    const ended = projectLane(lane('ended'), span.startMs, span.endMs, NOW, 'weekly');
    expect(ended.every((window) => window.endMs <= end && window.state === 'past')).toBe(true);
    expect(projectResetCredits(lane('ended'), span.startMs, span.endMs, NOW)).toHaveLength(0);
  });

  test('a built lane carries the end state it was given', () => {
    const built = buildTimelineLane({
      name: 'a',
      displayName: 'A',
      provider: 'codex',
      quota: undefined,
      endsAtMs: end,
      endState: 'overdue',
    });
    expect(built.endState).toBe('overdue');
  });

  test('the overdue marker is drawn in the warning style and stays unmuted', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaTimeline, {
        entries: [
          {
            file: {
              name: 'codex.json',
              type: 'codex',
              fleetEndsAt: iso(end),
              fleetEndState: 'overdue',
              fleetEndsAtSource: 'manual',
            },
            type: 'codex',
          },
        ],
        quotaFor: () => ({
          status: 'success',
          windows: [
            {
              id: 'weekly',
              label: 'Weekly',
              usedPercent: 25,
              resetAtMs: at(2026, 7, 1, 12),
              periodHours: 168,
            },
          ],
        }),
        displayNameFor: (name: string) => name,
        resolvedTheme: 'light',
        now: NOW,
      })
    );
    expect(markup).toContain('data-state="overdue"');
    expect(markup).toContain('aria-label="Was due to end 07/27 09:00; still active"');
    expect(markup).toContain('data-ended="0"');
    expect(markup).not.toContain('>Ended<');
  });
});

describe('routing preview by end state', () => {
  const NOW_ROUTE = Date.parse('2026-11-15T12:00:00Z');
  const catalog = { channels: {}, credentials: {} };
  const tierWith = (ending: Partial<AuthFileItem>) => {
    const board = buildRoutingBoard({}, [
      { name: 'ending.json', type: 'codex', priority: 5, ...ending },
      { name: 'other.json', type: 'codex', priority: 5 },
    ]);
    return resolveRoute(board, draftFromBoard(board), catalog, null, NOW_ROUTE).tiers[0];
  };
  const stateOf = (ending: Partial<AuthFileItem>) =>
    tierWith(ending).members.find((member) => member.key === 'cred:ending.json')?.state;

  test('an overdue credential keeps serving', () => {
    expect(
      stateOf({
        fleetEndsAt: '2026-11-14T00:00:00Z',
        fleetEndState: 'overdue',
        fleetEndsAtSource: 'manual',
      })
    ).toBe('serving');
  });

  test('a provider-confirmed end stops serving as soon as it passes', () => {
    expect(
      stateOf({
        fleetEndsAt: '2026-11-15T11:00:00Z',
        fleetEndState: 'scheduled',
        fleetEndsAtSource: 'codex-api',
      })
    ).toBe('ended');
  });
});

describe('mock backend billing anniversary', () => {
  test('a day the month lacks becomes its last day, then returns', async () => {
    const { nextAnniversary } = await import('../scripts/mock-backend/credentialEnds');
    const anchor = Date.UTC(2026, 0, 31, 21, 9, 56);
    expect(nextAnniversary(anchor, Date.UTC(2026, 1, 1))).toBe(Date.UTC(2026, 1, 28, 21, 9, 56));
    expect(nextAnniversary(anchor, Date.UTC(2026, 1, 28, 21, 9, 56))).toBe(
      Date.UTC(2026, 2, 31, 21, 9, 56)
    );
  });
});
