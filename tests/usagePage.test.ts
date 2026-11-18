import { afterAll, describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/i18n/index';
import { LiveTraffic } from '../src/features/usage/components/LiveTraffic';
import { UsageByKey } from '../src/features/usage/components/UsageByKey';
import { UsageDashboard, UsagePage } from '../src/features/usage/UsagePage';
import { EMPTY_LIVE_FEED, applyRecentPage } from '../src/features/usage/recentRequests';
import { useAuthStore } from '../src/stores';
import type { ClientKeyUsageReport, RecentRequest } from '../src/types/fleetUsage';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  },
});
const initialLanguage = i18n.language;
const initialStatus = useAuthStore.getState().connectionStatus;
await i18n.changeLanguage('en');
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
  useAuthStore.setState({ connectionStatus: initialStatus });
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const FROM = NOW - 3 * HOUR;
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const counters = (requests: number, total: number) => ({
  requests,
  failedRequests: 1,
  inputTokens: total / 2,
  outputTokens: total / 4,
  reasoningTokens: 0,
  cacheReadTokens: total / 4,
  cacheCreationTokens: 0,
  totalTokens: total,
});

const REPORT: ClientKeyUsageReport = {
  generatedAtMs: NOW,
  fromMs: FROM,
  toMs: NOW,
  recordingSinceMs: NOW - 4 * 24 * HOUR,
  granularity: 'hour',
  keys: [
    {
      name: 'laptop-with-a-very-long-descriptive-name',
      createdAtMs: NOW - 10 * 24 * HOUR,
      revoked: false,
      ...counters(4, 8000),
      models: [{ provider: 'claude', model: 'claude-opus-5', ...counters(4, 8000) }],
    },
    {
      name: 'old-tablet',
      createdAtMs: null,
      revoked: true,
      ...counters(2, 1200),
      models: [{ provider: 'codex', model: 'gpt-5.5', ...counters(2, 1200) }],
    },
  ],
  series: [
    {
      startMs: FROM,
      key: 'laptop-with-a-very-long-descriptive-name',
      provider: 'claude',
      model: 'claude-opus-5',
      ...counters(4, 8000),
    },
    {
      startMs: FROM + HOUR,
      key: 'old-tablet',
      provider: 'codex',
      model: 'gpt-5.5',
      ...counters(2, 1200),
    },
  ],
};

const usageProps = {
  loading: false,
  error: null,
  nowMs: NOW,
  range: { fromMs: FROM, toMs: NOW },
  selection: { kind: 'preset' as const, preset: '24h' as const },
  onSelectionChange: () => undefined,
  metric: 'total' as const,
  onMetricChange: () => undefined,
  onRetry: () => undefined,
};

const row = (seq: number, overrides: Partial<RecentRequest> = {}): RecentRequest => ({
  seq,
  requestedAtMs: NOW + seq * 1000,
  key: 'ci',
  provider: 'claude',
  model: 'claude-sonnet-5',
  responseModel: null,
  authIndex: 'claude-1',
  account: 'claude-a1b2c3',
  stream: true,
  latencyMs: 2300,
  ttftMs: 400,
  failed: false,
  statusCode: null,
  serviceTier: null,
  reasoningEffort: null,
  ...counters(1, 4000),
  failedRequests: 0,
  ...overrides,
});

describe('usage page rendering', () => {
  test('the dashboard renders both sections in their loading state', () => {
    const html = render(createElement(UsageDashboard));
    expect(html).toContain('Usage by client key');
    expect(html).toContain('Live traffic');
    expect(html).toContain('Loading…');
  });

  test('the routed page renders its heading and asks for a connection when disconnected', () => {
    useAuthStore.setState({ connectionStatus: 'disconnected' });
    const html = render(createElement(UsagePage));
    expect(html).toContain('<h1');
    expect(html).toContain('Connect to a proxy to see usage.');
  });

  test('the key chart draws stacked bars, a legend and the totals table', () => {
    const html = render(createElement(UsageByKey, { ...usageProps, report: REPORT }));
    expect(html.match(/<rect/g)?.length).toBe(2);
    expect(html).toContain('var(--viz-series-1)');
    expect(html).toContain('var(--viz-series-2)');
    expect(html).toContain('title="laptop-with-a-very-long-descriptive-name"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Revoked');
    expect(html).toContain('Totals for the selected range');
    expect(html).toContain('8k');
    expect(html).toContain('87%');
    expect(html).toContain('type="range"');
    expect(html).not.toContain('<svg role="img" class="pie');
  });

  test('every key keeps its own segment and legend toggle, whatever its name', () => {
    const names = [
      'constructor',
      'toString',
      '__proto__',
      ...Array.from({ length: 8 }, (_, index) => `key-${index}`),
    ];
    const report: ClientKeyUsageReport = {
      ...REPORT,
      keys: [],
      series: names.map((key) => ({
        startMs: FROM,
        key,
        provider: 'claude',
        model: 'claude-opus-5',
        ...counters(1, 100),
      })),
    };
    const html = render(createElement(UsageByKey, { ...usageProps, report }));
    expect(html.match(/<rect/g)?.length).toBe(names.length);
    expect(names.filter((name) => !html.includes(`title="${name}"`))).toEqual([]);
    expect(html).not.toContain('NaN');
  });

  test('the key chart shows an empty state and an error state', () => {
    const empty = render(
      createElement(UsageByKey, { ...usageProps, report: { ...REPORT, series: [], keys: [] } })
    );
    expect(empty).toContain('No usage in this range.');
    const failed = render(
      createElement(UsageByKey, {
        ...usageProps,
        report: null,
        error: { kind: 'unsupported', message: '' },
      })
    );
    expect(failed).toContain('Could not load usage');
    expect(failed).toContain('Retry');
  });

  test('live traffic resolves accounts, marks failures and highlights new rows', () => {
    const first = applyRecentPage(EMPTY_LIVE_FEED, {
      generatedAtMs: NOW,
      capacity: 2000,
      latestSeq: 1,
      requests: [row(1)],
    });
    const feed = applyRecentPage(first, {
      generatedAtMs: NOW,
      capacity: 2000,
      latestSeq: 3,
      requests: [
        row(3, { failed: true, statusCode: 429, authIndex: 'codex-9', account: 'codex-77aa00' }),
        row(2, { responseModel: 'claude-sonnet-5-20261101' }),
      ],
    });
    const html = render(
      createElement(LiveTraffic, {
        state: { feed, error: null },
        paused: false,
        onTogglePause: () => undefined,
        keyFilter: '',
        keyOptions: ['ci'],
        onKeyFilterChange: () => undefined,
        accountNames: new Map([['claude-1', 'mary@studio.test']]),
      })
    );
    expect(html).toContain('mary@studio.test');
    expect(html).toContain('codex-77aa00');
    expect(html).toContain('429');
    expect(html).toContain('claude-sonnet-5-20261101');
    expect(html.match(/data-fresh="true"/g)?.length).toBe(2);
    expect(html).toContain('Pause');
    expect(html).toContain('empties when the proxy restarts');
  });
});
