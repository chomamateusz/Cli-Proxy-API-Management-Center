import { describe, expect, mock, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { authFilesApi, normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import {
  localInputToMs,
  msToLocalInput,
  paidUntilMsFor,
  readCredentialEnd,
  toUtcSeconds,
  withCredentialEnd,
} from '../src/features/quota/credentialEnd';
import {
  projectLane,
  projectLaneEnd,
  projectResetCredits,
  timelineSpan,
  type TimelineLane,
} from '../src/features/quota/quotaTimelineModel';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '../src/features/quota/types';
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
const { CodexQuotaBody } = await import('@/features/quota/providers/codex/CodexQuotaBody');

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();
const noEndActions = {
  save: async () => undefined,
  cancel: async () => 'scheduled' as const,
  nextPeriod: async () => undefined,
};
const NOW = at(2026, 6, 29, 12);

describe('credential end reading', () => {
  test('the list normalizer keeps the end date and the backend verdict', () => {
    const { files } = normalizeAuthFilesResponse({
      files: [
        { name: 'a.json', fleet_ends_at: '2026-12-12T23:00:00Z', fleet_ended: false },
        { name: 'b.json', fleet_ends_at: '2026-01-01T00:00:00Z', fleet_ended: true },
        { name: 'c.json' },
      ],
    });
    const byName = new Map(files.map((file) => [file.name, file]));
    expect(byName.get('a.json')).toMatchObject({
      fleetEndsAt: '2026-12-12T23:00:00Z',
      fleetEnded: false,
    });
    expect(byName.get('b.json')?.fleetEnded).toBe(true);
    expect(byName.get('c.json')?.fleetEndsAt).toBeUndefined();
    expect(byName.get('c.json')?.fleetEnded).toBeUndefined();
  });

  test('an end is ended once the clock reaches it or the backend says so', () => {
    const file = (fields: Partial<AuthFileItem>): AuthFileItem => ({ name: 'x.json', ...fields });
    const end = new Date(NOW + 1000).toISOString();
    expect(readCredentialEnd(file({}), NOW)).toMatchObject({ endsAtMs: null, ended: false });
    expect(readCredentialEnd(file({ fleetEndsAt: end }), NOW).ended).toBe(false);
    expect(readCredentialEnd(file({ fleetEndsAt: end }), NOW + 1000).ended).toBe(true);
    expect(readCredentialEnd(file({ fleetEndsAt: end, fleetEnded: true }), NOW).ended).toBe(true);
    expect(readCredentialEnd(file({ fleetEndsAt: 'garbage' }), NOW).endsAtMs).toBeNull();
  });

  test('a local input becomes UTC seconds and round-trips', () => {
    const ms = localInputToMs('2026-12-12T23:30');
    expect(ms).toBe(new Date(2026, 11, 12, 23, 30).getTime());
    expect(msToLocalInput(ms as number)).toBe('2026-12-12T23:30');
    expect(toUtcSeconds(Date.UTC(2026, 11, 12, 23, 0, 0, 987))).toBe('2026-12-12T23:00:00Z');
    expect(localInputToMs('2026-02-30T10:00')).toBeNull();
    expect(localInputToMs('')).toBeNull();
    expect(localInputToMs('2026-12-12')).toBeNull();
  });

  test('a saved value updates the local entry and a cleared one removes every form', () => {
    const file: AuthFileItem = {
      name: 'x.json',
      fleet_ends_at: '2026-01-01T00:00:00Z',
      fleet_ended: true,
      fleetEndsAt: '2026-01-01T00:00:00Z',
      fleetEnded: true,
    };
    const saved = withCredentialEnd(file, '2026-12-12T23:00:00Z', NOW);
    expect(saved).toMatchObject({ fleetEndsAt: '2026-12-12T23:00:00Z', fleetEnded: false });
    expect(saved.fleet_ends_at).toBeUndefined();
    const cleared = withCredentialEnd(file, null, NOW);
    expect(Object.keys(cleared)).toEqual(['name']);
  });

  test('a loaded Codex quota offers its paid-until date', () => {
    const file: AuthFileItem = { name: 'codex.json', type: 'codex' };
    const quota = { status: 'success', subscriptionActiveUntil: '2026-08-20T10:00:00Z' };
    expect(paidUntilMsFor('codex', quota, file)).toBe(Date.parse('2026-08-20T10:00:00Z'));
    expect(paidUntilMsFor('codex', { ...quota, subscriptionActiveUntil: null }, file)).toBeNull();
    expect(paidUntilMsFor('codex', { ...quota, status: 'loading' }, file)).toBeNull();
    expect(paidUntilMsFor('claude', quota, file)).toBeNull();
  });

  test('the credential list carries the paid-until date before any quota load', () => {
    const file: AuthFileItem = {
      name: 'codex.json',
      type: 'codex',
      id_token: { chatgpt_subscription_active_until: '2026-09-01T00:00:00Z' },
    };
    const fileMs = Date.parse('2026-09-01T00:00:00Z');
    expect(paidUntilMsFor('codex', undefined, file)).toBe(fileMs);
    expect(paidUntilMsFor('codex', { status: 'error', error: 'boom' }, file)).toBe(fileMs);
    const loaded = { status: 'success', subscriptionActiveUntil: '2026-08-20T10:00:00Z' };
    expect(paidUntilMsFor('codex', loaded, file)).toBe(Date.parse('2026-08-20T10:00:00Z'));
    expect(paidUntilMsFor('claude', undefined, { ...file, type: 'claude' })).toBeNull();
  });
});

describe('credential end writing', () => {
  test('sets and clears the end through the credential fields patch', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });
    try {
      await authFilesApi.patchFields('a.json', { fleet_ends_at: '2026-12-12T23:00:00Z' });
      await authFilesApi.patchFields('a.json', { fleet_ends_at: null });
      expect(patch.mock.calls).toEqual([
        ['/credentials/fields', { name: 'a.json', fleet_ends_at: '2026-12-12T23:00:00Z' }],
        ['/credentials/fields', { name: 'a.json', fleet_ends_at: null }],
      ]);
    } finally {
      patch.mockRestore();
    }
  });
});

describe('timeline after a credential end', () => {
  const span = timelineSpan('weekly', 0, NOW);
  const lane = (endsAtMs: number | null): TimelineLane => ({
    name: 'a.json',
    displayName: 'Alice',
    provider: 'codex',
    anchorMs: at(2026, 6, 29, 20),
    periodHours: 24 * 7,
    remaining: 40,
    limits: [],
    resetCredits: [
      { id: 'before', grantedAtMs: null, expiresAtMs: at(2026, 7, 1, 12) },
      { id: 'after', grantedAtMs: null, expiresAtMs: at(2026, 7, 5, 12) },
    ],
    endsAtMs,
    endState: endsAtMs === null ? 'none' : 'scheduled',
  });

  test('no window starts after the end and a straddling window is cut at it', () => {
    const end = at(2026, 7, 2, 8);
    const windows = projectLane(lane(end), span.startMs, span.endMs, NOW, 'weekly');
    const uncut = projectLane(lane(null), span.startMs, span.endMs, NOW, 'weekly');
    expect(uncut.some((window) => window.startMs >= end)).toBe(true);
    expect(windows.every((window) => window.startMs < end && window.endMs <= end)).toBe(true);
    const straddling = windows.find((window) => window.startMs === at(2026, 6, 29, 20));
    expect(straddling?.endMs).toBe(end);
    const live = windows.find((window) => window.state === 'live');
    expect(live?.remaining).toBe(40);
  });

  test('a lane that already ended projects nothing after its end', () => {
    const end = at(2026, 6, 27, 9);
    const windows = projectLane(lane(end), span.startMs, span.endMs, NOW, 'weekly');
    expect(windows.every((window) => window.endMs <= end && window.state === 'past')).toBe(true);
  });

  test('reset-credit marks after the end are dropped', () => {
    const credits = projectResetCredits(lane(at(2026, 7, 3)), span.startMs, span.endMs, NOW);
    expect(credits.map((credit) => credit.id)).toEqual(['before']);
  });

  test('the end marker sits on the span only when the end is visible', () => {
    const inside = projectLaneEnd(lane(at(2026, 7, 2, 8)), span.startMs, span.endMs);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(100);
    expect(projectLaneEnd(lane(null), span.startMs, span.endMs)).toBeNull();
    expect(projectLaneEnd(lane(span.endMs + 1), span.startMs, span.endMs)).toBeNull();
    expect(projectLaneEnd(lane(span.startMs - 1), span.startMs, span.endMs)).toBeNull();
  });
});

describe('credential end rendering', () => {
  const codexQuota = {
    status: 'success' as const,
    planType: 'pro',
    subscriptionActiveUntil: '2026-08-20T10:00:00Z',
    windows: [
      {
        id: 'weekly',
        label: 'Weekly',
        usedPercent: 25,
        resetAtMs: at(2026, 7, 1, 12),
        periodHours: 168,
      },
    ],
  };
  const cardProps = (file: AuthFileItem) => ({
    entry: { file, type: 'codex' as const },
    quota: codexQuota,
    resolvedTheme: 'light' as const,
    canRefresh: true,
    resetting: false,
    onRefresh() {},
    onReset() {},
    canEditEnd: true,
    endActions: noEndActions,
    nowMs: NOW,
  });

  test('a card shows its end with a relative phrase and edit controls', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(
        QuotaCard,
        cardProps({
          name: 'codex.json',
          type: 'codex',
          fleetEndsAt: new Date(at(2026, 7, 25, 12)).toISOString(),
        })
      )
    );
    expect(markup).toContain('Ends');
    expect(markup).toContain('in 27 days');
    expect(markup).toContain('aria-label="Edit end date"');
    expect(markup).toContain('aria-label="Clear end date"');
    expect(markup).not.toContain('Set as end');
    expect(markup).toContain('data-ended="0"');
  });

  test('an unset Codex end offers the paid-until date in one click', async () => {
    await i18n.changeLanguage('en');
    const markup = renderToStaticMarkup(
      createElement(QuotaCard, cardProps({ name: 'codex.json', type: 'codex' }))
    );
    expect(markup).toContain('Not set');
    expect(markup).toContain('Set as end');
    expect(markup).toContain('aria-label="Set end date"');
    expect(markup).not.toContain('aria-label="Clear end date"');
  });

  test('an ended credential is muted with an Ended badge on card and row', async () => {
    await i18n.changeLanguage('en');
    const file: AuthFileItem = {
      name: 'codex.json',
      type: 'codex',
      fleetEndsAt: new Date(NOW - 3 * 86_400_000).toISOString(),
      fleetEnded: true,
    };
    const card = renderToStaticMarkup(createElement(QuotaCard, cardProps(file)));
    const row = renderToStaticMarkup(
      createElement(QuotaAccountRow, {
        ...cardProps(file),
        model: null,
        metricColumns: [],
        extrasColumn: null,
        label: { name: 'codex.json', detail: null },
        nameInMessages: 'codex.json',
        providerLabel: 'Codex',
        showEmails: true,
      })
    );
    for (const markup of [card, row]) {
      expect(markup).toContain('data-ended="1"');
      expect(markup).toContain('>Ended<');
      expect(markup).toContain('ended 3 days ago');
      expect(markup).toContain('aria-label="End date of codex.json"');
    }
  });

  test('Codex labels its subscription date as paid until', async () => {
    await i18n.changeLanguage('en');
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test'
    );
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: codexQuota, classes })
    );
    expect(markup).toContain('Paid until');
    expect(markup).not.toContain('Renewal time');
  });

  test('the timeline draws an end marker and mutes an ended lane', async () => {
    await i18n.changeLanguage('en');
    const render = (fleetEndsAt: string) =>
      renderToStaticMarkup(
        createElement(QuotaTimeline, {
          entries: [{ file: { name: 'codex.json', type: 'codex', fleetEndsAt }, type: 'codex' }],
          quotaFor: () => codexQuota,
          displayNameFor: (name: string) => name,
          resolvedTheme: 'light',
          now: NOW,
        })
      );
    const upcoming = render(new Date(at(2026, 7, 2, 8)).toISOString());
    expect(upcoming).toContain('aria-label="Ends 08/02 08:00"');
    expect(upcoming).toContain('data-ended="0"');
    const ended = render(new Date(at(2026, 6, 28, 8)).toISOString());
    expect(ended).toContain('data-ended="1"');
    expect(ended).toContain('>Ended<');
  });
});

describe('credential end locales', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) =>
          flatten(child, prefix ? `${prefix}.${key}` : key)
        )
      : [prefix];

  test('every locale carries every new key', async () => {
    const english = await Bun.file('src/i18n/locales/en.json').json();
    const required = [
      ...flatten(english.credential_end, 'credential_end'),
      'quota_management.windows_end_marker',
      'quota_management.windows_end_marker_overdue',
      'routing.drain_ending_label',
      'routing.drain_ending_desc',
      'codex_quota.expires_label',
    ];
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const keys = new Set(flatten(await Bun.file(`src/i18n/locales/${locale}.json`).json()));
      expect(required.filter((key) => !keys.has(key))).toEqual([]);
    }
    expect(english.codex_quota.expires_label).toBe('Paid until');
  });
});
