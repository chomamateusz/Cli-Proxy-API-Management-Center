import { describe, expect, test } from 'bun:test';
import {
  buildRouterView,
  DEFAULT_ROUTER_SETTINGS,
  normalizeRouterStrategy,
  rankByRouter,
  rankProviderByRouter,
  readRouterSettings,
  routerOutOfRotation,
  routerReadingsFor,
  type RouterCandidate,
  type RouterReadings,
  type RouterSettings,
} from '@/features/quota/routerOrder';
import type { QuotaTabId } from '@/features/quota/constants';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaProviderType } from '@/features/quota/providers/types';

const NOW = Date.UTC(2026, 10, 19, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const USE_OR_LOSE: RouterSettings = { ...DEFAULT_ROUTER_SETTINGS, strategy: 'use-or-lose' };

const readings = (
  weekly: [number, number] | null,
  short: [number, number] | null = null,
  fable: [number, number] | null = null
): RouterReadings => ({
  weekly: weekly && { usedPercent: weekly[0], resetAtMs: NOW + weekly[1] },
  short: short && { usedPercent: short[0], resetAtMs: NOW + short[1] },
  fable: fable && { usedPercent: fable[0], resetAtMs: NOW + fable[1] },
  creditsAvailable: false,
  observedAtMs: NOW - 60_000,
});

const candidate = (
  item: string,
  value: RouterReadings | null,
  extra: Partial<RouterCandidate<string>> = {}
): RouterCandidate<string> => ({
  item,
  provider: 'claude' as QuotaProviderType,
  priority: 0,
  endsAtMs: null,
  readings: value,
  outOfRotation: null,
  ...extra,
});

const order = (
  list: RouterCandidate<string>[],
  settings: RouterSettings = USE_OR_LOSE,
  family: 'all' | 'fable' = 'all'
) => rankByRouter(list, family, settings, NOW).map((ranked) => ranked.candidate.item);

describe('use-or-lose router order', () => {
  test('earlier weekly reset goes first, beyond the one-hour tie group', () => {
    expect(
      order([
        candidate('late', readings([10, 5 * DAY])),
        candidate('early', readings([70, 2 * DAY])),
        candidate('middle', readings([0, 3 * DAY])),
      ])
    ).toEqual(['early', 'middle', 'late']);
  });

  test('inside an hour of the earliest reset, lower utilisation wins, then the earlier reset', () => {
    expect(
      order([
        candidate('earliest-busy', readings([60, DAY])),
        candidate('later-idle', readings([20, DAY + 50 * 60_000])),
        candidate('tied-earlier', readings([20, DAY + 30 * 60_000])),
        candidate('outside', readings([0, DAY + 61 * 60_000])),
      ])
    ).toEqual(['tied-earlier', 'later-idle', 'earliest-busy', 'outside']);
  });

  test('the tie group anchors to the earliest reset, not to pairwise neighbours', () => {
    expect(
      order([
        candidate('a', readings([50, DAY])),
        candidate('b', readings([40, DAY + 50 * 60_000])),
        candidate('c', readings([0, DAY + 100 * 60_000])),
      ])
    ).toEqual(['b', 'a', 'c']);
  });

  test('capacity tiers: room, then five-hour capped, then weekly-limited', () => {
    const ranked = rankByRouter(
      [
        candidate('limited', readings([100, DAY])),
        candidate('capped', readings([10, DAY], [96, HOUR])),
        candidate('room', readings([10, 6 * DAY], [50, HOUR])),
      ],
      'all',
      USE_OR_LOSE,
      NOW
    );
    expect(ranked.map((entry) => entry.candidate.item)).toEqual(['room', 'capped', 'limited']);
    expect(ranked.map((entry) => entry.placement)).toMatchObject([
      { kind: 'ranked', position: 1, tier: 'room' },
      { kind: 'ranked', position: 2, tier: 'capped' },
      { kind: 'ranked', position: 3, tier: 'limited' },
    ]);
  });

  test('the five-hour cap follows the configured percentage', () => {
    const list = [
      candidate('capped', readings([10, DAY], [91, HOUR])),
      candidate('room', readings([10, 5 * DAY], [0, HOUR])),
    ];
    expect(order(list)).toEqual(['capped', 'room']);
    expect(order(list, { ...USE_OR_LOSE, shortWindowCapPct: 90 })).toEqual(['room', 'capped']);
  });

  test('a limit whose reset has passed is ignored', () => {
    const expired = candidate('expired-cap', {
      ...readings([10, DAY]),
      short: { usedPercent: 100, resetAtMs: NOW - HOUR },
    });
    expect(order([expired, candidate('later', readings([10, 3 * DAY]))])).toEqual([
      'expired-cap',
      'later',
    ]);
  });

  test('with drain on, an end date before the weekly reset moves the account forward', () => {
    const list = [
      candidate('soon-reset', readings([10, 2 * DAY])),
      candidate('ending', readings([10, 6 * DAY]), { endsAtMs: NOW + DAY }),
    ];
    expect(order(list)).toEqual(['ending', 'soon-reset']);
    expect(order(list, { ...USE_OR_LOSE, drainEndingCredentials: false })).toEqual([
      'soon-reset',
      'ending',
    ]);
  });

  test('Fable ranks by the Fable weekly window when usable, otherwise the all-model one', () => {
    const list = [
      candidate('fable-late', readings([10, DAY], null, [10, 5 * DAY])),
      candidate('fable-early', readings([10, 4 * DAY], null, [10, 2 * DAY])),
      candidate('fable-expired', {
        ...readings([10, 3 * DAY]),
        fable: { usedPercent: 10, resetAtMs: NOW - HOUR },
      }),
    ];
    expect(order(list, USE_OR_LOSE, 'all')).toEqual(['fable-late', 'fable-expired', 'fable-early']);
    expect(order(list, USE_OR_LOSE, 'fable')).toEqual([
      'fable-early',
      'fable-expired',
      'fable-late',
    ]);
  });

  test('a Fable weekly window at 100% makes the account weekly-limited for Fable only', () => {
    const list = [
      candidate('fable-full', readings([10, DAY], null, [100, DAY])),
      candidate('other', readings([10, 3 * DAY])),
    ];
    expect(order(list, USE_OR_LOSE, 'all')).toEqual(['fable-full', 'other']);
    expect(order(list, USE_OR_LOSE, 'fable')).toEqual(['other', 'fable-full']);
  });

  test('without a weekly reading accounts follow the ranked ones in input order', () => {
    const ranked = rankByRouter(
      [
        candidate('unread-a', null),
        candidate('ranked', readings([10, DAY])),
        candidate('unread-b', null),
      ],
      'all',
      USE_OR_LOSE,
      NOW
    );
    expect(ranked.map((entry) => entry.candidate.item)).toEqual(['ranked', 'unread-a', 'unread-b']);
    expect(ranked[1].placement).toMatchObject({ kind: 'ranked', sampled: false });
  });

  test('out-of-rotation accounts come last: cooling, disabled, ended', () => {
    const ranked = rankByRouter(
      [
        candidate('ended', readings([0, DAY]), { outOfRotation: 'ended' }),
        candidate('disabled', readings([0, DAY]), { outOfRotation: 'disabled' }),
        candidate('cooling', readings([0, DAY]), { outOfRotation: 'cooling' }),
        candidate('unread', null),
        candidate('ranked', readings([90, 6 * DAY])),
      ],
      'all',
      USE_OR_LOSE,
      NOW
    );
    expect(ranked.map((entry) => entry.candidate.item)).toEqual([
      'ranked',
      'unread',
      'cooling',
      'disabled',
      'ended',
    ]);
    expect(ranked[2].placement).toEqual({ kind: 'out', reason: 'cooling' });
  });

  test('a higher credential priority ranks first inside its capacity tier', () => {
    expect(
      order([
        candidate('low', readings([0, DAY])),
        candidate('high', readings([50, 6 * DAY]), { priority: 5 }),
        candidate('high-capped', readings([0, DAY], [99, HOUR]), { priority: 9 }),
      ])
    ).toEqual(['high', 'low', 'high-capped']);
  });

  test('mixed groups rank inside each provider and keep provider order', () => {
    const ranked = rankByRouter(
      [
        candidate('claude-late', readings([0, 5 * DAY])),
        candidate('claude-early', readings([0, DAY])),
        candidate('codex-late', readings([0, 4 * DAY]), { provider: 'codex' }),
        candidate('codex-early', readings([0, 2 * DAY]), { provider: 'codex' }),
        candidate('xai', null, { provider: 'xai' }),
      ],
      'all',
      USE_OR_LOSE,
      NOW
    );
    expect(ranked.map((entry) => entry.candidate.item)).toEqual([
      'claude-early',
      'claude-late',
      'codex-early',
      'codex-late',
      'xai',
    ]);
    expect(ranked.map((entry) => entry.placement)).toMatchObject([
      { position: 1 },
      { position: 2 },
      { position: 1 },
      { position: 2 },
      { sampledProvider: false },
    ]);
  });

  test('search and tab narrow what is shown without re-ranking', () => {
    const entry = (name: string, type: QuotaProviderType): QuotaFileEntry => ({
      file: { name, type },
      type,
    });
    const entries = [
      entry('claude-first.json', 'claude'),
      entry('claude-second.json', 'claude'),
      entry('codex-first.json', 'codex'),
      entry('codex-second.json', 'codex'),
    ];
    const view = (tab: QuotaTabId, search: string) =>
      buildRouterView(
        entries,
        ({ file }) => ({
          priority: 0,
          endsAtMs: null,
          readings: readings([0, file.name.includes('second') ? 3 * DAY : DAY]),
          outOfRotation: null,
        }),
        tab,
        search,
        'all',
        USE_OR_LOSE,
        NOW
      );
    const placementOf = (name: string, ranked: ReturnType<typeof view>['ranked']) =>
      ranked.find((item) => item.candidate.item.file.name === name)?.placement;

    const searched = view('all', 'claude-second');
    expect(searched.visible.map((item) => item.file.name)).toEqual(['claude-second.json']);
    expect(placementOf('claude-second.json', searched.ranked)).toMatchObject({ position: 2 });

    const tabbed = view('codex', '');
    expect(tabbed.visible.map((item) => item.file.name)).toEqual([
      'codex-first.json',
      'codex-second.json',
    ]);
    expect(placementOf('codex-second.json', tabbed.ranked)).toMatchObject({ position: 2 });
    expect(placementOf('claude-first.json', tabbed.ranked)).toMatchObject({ position: 1 });
  });

  test('providers without a weekly sample kind keep input order', () => {
    const list = ['c', 'a', 'b'].map((item) =>
      candidate(item, null, { provider: 'kimi' as QuotaProviderType })
    );
    expect(
      rankProviderByRouter(list, 'all', USE_OR_LOSE, NOW).map((entry) => entry.candidate.item)
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('router inputs', () => {
  test('settings mirror the proxy defaults and validation', () => {
    expect(readRouterSettings(undefined)).toEqual(DEFAULT_ROUTER_SETTINGS);
    expect(
      readRouterSettings({
        routing: {
          strategy: ' Use-Or-Lose ',
          'use-or-lose': { 'short-window-cap-pct': 80, 'drain-ending-credentials': false },
        },
      })
    ).toEqual({ strategy: 'use-or-lose', shortWindowCapPct: 80, drainEndingCredentials: false });
    expect(
      readRouterSettings({ routing: { 'use-or-lose': { 'short-window-cap-pct': 1 } } })
        .shortWindowCapPct
    ).toBe(95);
    expect(normalizeRouterStrategy('nr')).toBe('nearest-reset');
    expect(normalizeRouterStrategy('something')).toBe('round-robin');
  });

  test('readings come from the loaded Claude and Codex windows', () => {
    expect(
      routerReadingsFor(
        'claude',
        {
          status: 'success',
          observedAt: new Date(NOW).toISOString(),
          windows: [
            { id: 'five-hour', usedPercent: 40, resetAtMs: NOW + HOUR },
            { id: 'seven-day', usedPercent: 20, resetAtMs: NOW + DAY },
            { id: 'seven-day-fable', usedPercent: 30, resetAtMs: NOW + 2 * DAY },
          ],
        },
        NOW
      )
    ).toEqual({
      weekly: { usedPercent: 20, resetAtMs: NOW + DAY },
      fable: { usedPercent: 30, resetAtMs: NOW + 2 * DAY },
      short: { usedPercent: 40, resetAtMs: NOW + HOUR },
      creditsAvailable: false,
      observedAtMs: NOW,
    });
    const codex = routerReadingsFor(
      'codex',
      {
        status: 'success',
        loadedAtMs: NOW,
        creditBalance: '12',
        windows: [{ id: 'monthly', usedPercent: 20, resetAtMs: NOW + DAY, periodHours: 720 }],
      },
      NOW
    );
    expect(codex).toMatchObject({ weekly: null, short: null, creditsAvailable: true });
    expect(routerReadingsFor('codex', { status: 'idle', windows: [] }, NOW)).toBeNull();
    expect(routerReadingsFor('xai', { status: 'success' }, NOW)).toBeNull();
  });

  test('cooldown, disabled and ended files are out of rotation', () => {
    const cooling = {
      name: 'a.json',
      cooldownSnapshot: {
        receivedAtMs: NOW,
        records: [
          {
            scope: 'credential' as const,
            reason: 'quota',
            retryAt: new Date(NOW + HOUR).toISOString(),
            remainingSeconds: 3600,
          },
        ],
      },
    };
    expect(routerOutOfRotation(cooling, NOW)).toBe('cooling');
    expect(routerOutOfRotation({ name: 'b.json', disabled: true }, NOW)).toBe('disabled');
    expect(
      routerOutOfRotation(
        { name: 'c.json', fleetEndsAt: new Date(NOW - DAY).toISOString(), fleetEnded: true },
        NOW
      )
    ).toBe('ended');
    expect(routerOutOfRotation({ name: 'd.json' }, NOW)).toBeNull();
  });
});
