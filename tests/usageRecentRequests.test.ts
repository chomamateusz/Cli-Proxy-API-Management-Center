import { describe, expect, test } from 'bun:test';
import {
  EMPTY_LIVE_FEED,
  accountLabel,
  afterSeqFor,
  applyRecentPage,
  buildAccountNames,
  mergeRecentRequests,
} from '../src/features/usage/recentRequests';
import {
  buildClientKeyUsageParams,
  buildRecentRequestsParams,
  normalizeClientKeyUsage,
  normalizeRecentRequests,
} from '../src/services/api/fleetUsage';
import type { AuthFileItem } from '../src/types/authFile';
import type { RecentRequest, RecentRequestsPage } from '../src/types/fleetUsage';

const AT = Date.parse('2026-11-18T12:00:00Z');

const request = (seq: number, overrides: Partial<RecentRequest> = {}): RecentRequest => ({
  seq,
  requestedAtMs: AT + seq * 1000,
  key: 'laptop',
  provider: 'claude',
  model: 'claude-opus-5',
  responseModel: null,
  authIndex: 'claude-1',
  account: 'claude-a1b2c3',
  stream: true,
  latencyMs: 1200,
  ttftMs: 300,
  failed: false,
  statusCode: null,
  serviceTier: null,
  reasoningEffort: null,
  requests: 1,
  failedRequests: 0,
  inputTokens: 10,
  outputTokens: 5,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 15,
  ...overrides,
});

const page = (latestSeq: number, seqs: number[]): RecentRequestsPage => ({
  generatedAtMs: AT,
  capacity: 2000,
  latestSeq,
  requests: seqs.map((seq) => request(seq)),
});

describe('live traffic merge', () => {
  test('merges newest first without duplicate sequence numbers', () => {
    const merged = mergeRecentRequests([request(3), request(2)], [request(4), request(3)]);
    expect(merged.map((row) => row.seq)).toEqual([4, 3, 2]);
  });

  test('keeps at most the cap, dropping the oldest rows', () => {
    const existing = Array.from({ length: 500 }, (_, index) => request(500 - index));
    const merged = mergeRecentRequests(existing, [request(501), request(502)]);
    expect(merged).toHaveLength(500);
    expect(merged[0].seq).toBe(502);
    expect(merged[merged.length - 1].seq).toBe(3);
  });

  test('the first page loads without highlights and sets the after_seq cursor', () => {
    expect(afterSeqFor(EMPTY_LIVE_FEED)).toBe(0);
    const first = applyRecentPage(EMPTY_LIVE_FEED, page(12, [12, 11, 10]));
    expect(first.loaded).toBe(true);
    expect(first.cursor).toBe(12);
    expect(first.fresh.size).toBe(0);
    expect(afterSeqFor(first)).toBe(12);
  });

  test('later pages highlight only new rows and ignore entries at or below after_seq', () => {
    const first = applyRecentPage(EMPTY_LIVE_FEED, page(12, [12, 11]));
    const second = applyRecentPage(first, page(14, [14, 13, 12]));
    expect(second.rows.map((row) => row.seq)).toEqual([14, 13, 12, 11]);
    expect([...second.fresh].sort()).toEqual([13, 14]);
    expect(second.cursor).toBe(14);
  });

  test('a filtered page still advances the cursor to the latest sequence', () => {
    const first = applyRecentPage(EMPTY_LIVE_FEED, page(5, [5]));
    const quiet = applyRecentPage(first, page(9, []));
    expect(quiet.cursor).toBe(9);
    expect(quiet.rows.map((row) => row.seq)).toEqual([5]);
  });

  test('a proxy restart empties the feed so the next poll reloads from scratch', () => {
    const first = applyRecentPage(EMPTY_LIVE_FEED, page(40, [40, 39]));
    const restarted = applyRecentPage(first, page(3, []));
    expect(restarted).toEqual(EMPTY_LIVE_FEED);
    expect(afterSeqFor(restarted)).toBe(0);
  });
});

describe('live traffic account names', () => {
  const files = [
    { name: 'claude-mary@studio.test.json', email: 'mary@studio.test', authIndex: 'claude-1' },
    { name: 'codex-abc-team.json', auth_index: 'codex-2' },
    { name: 'vertex.json', projectId: 'proj-7', authIndex: 7 },
  ] as AuthFileItem[];
  const names = buildAccountNames(files);

  test('resolves auth_index to the identity shown on the Auth files page', () => {
    expect(names.get('claude-1')).toBe('mary@studio.test');
    expect(names.get('codex-2')).toBe('codex-abc-team');
    expect(names.get('7')).toBe('proj-7');
    expect(accountLabel(request(1), names)).toBe('mary@studio.test');
  });

  test('falls back to the account pseudonym when the index is unknown or absent', () => {
    expect(accountLabel(request(1, { authIndex: 'claude-99' }), names)).toBe('claude-a1b2c3');
    expect(accountLabel(request(1, { authIndex: null, account: '' }), names)).toBe('');
  });
});

describe('usage API normalization', () => {
  test('recent requests drop invalid rows and a response model equal to the model', () => {
    const normalized = normalizeRecentRequests({
      capacity: 2000,
      latest_seq: 8,
      requests: [
        {
          seq: 8,
          requested_at: '2026-11-18T12:00:01.123456Z',
          key: 'ci',
          provider: 'codex',
          model: 'gpt-5.5',
          response_model: 'gpt-5.5',
          auth_index: 'codex-1',
          account: 'codex-0f4bf1',
          failed: true,
          status_code: 429,
          latency_ms: 140,
          total_tokens: 0,
        },
        { seq: 'x', requested_at: '2026-11-18T12:00:00Z' },
        { seq: 7, requested_at: '2026-11-18T12:00:00Z', model: 'a', response_model: 'b' },
      ],
    });
    expect(normalized.latestSeq).toBe(8);
    expect(normalized.requests.map((row) => row.seq)).toEqual([8, 7]);
    expect(normalized.requests[0]).toMatchObject({
      responseModel: null,
      failed: true,
      statusCode: 429,
      ttftMs: null,
      authIndex: 'codex-1',
    });
    expect(normalized.requests[1].responseModel).toBe('b');
  });

  test('client key usage reads keys, models and series', () => {
    const report = normalizeClientKeyUsage({
      from: '2026-11-18T00:00:00Z',
      to: '2026-11-18T03:00:00Z',
      recording_since: '2026-11-01T09:00:00Z',
      granularity: 'day',
      keys: [
        {
          name: 'laptop',
          created_at: null,
          revoked: true,
          total_tokens: 30,
          models: [{ provider: 'claude', model: 'opus', total_tokens: 30 }],
        },
        { name: '' },
      ],
      series: [{ start: '2026-11-18T00:00:00Z', key: 'laptop', provider: 'claude', model: 'opus' }],
    });
    expect(report.granularity).toBe('day');
    expect(report.recordingSinceMs).toBe(Date.parse('2026-11-01T09:00:00Z'));
    expect(report.keys).toHaveLength(1);
    expect(report.keys[0]).toMatchObject({ name: 'laptop', revoked: true, createdAtMs: null });
    expect(report.series[0].startMs).toBe(Date.parse('2026-11-18T00:00:00Z'));
  });

  test('query params use RFC3339 seconds, the series switch and after_seq', () => {
    expect(
      buildClientKeyUsageParams({
        fromMs: Date.parse('2026-11-18T00:00:00.999Z'),
        toMs: Date.parse('2026-11-18T05:30:00Z'),
        series: 'hour',
      })
    ).toEqual({ from: '2026-11-18T00:00:00Z', to: '2026-11-18T05:30:00Z', series: 'hour' });
    expect(buildClientKeyUsageParams({ fromMs: null, toMs: AT, series: 'day' })).toEqual({
      to: '2026-11-18T12:00:00Z',
      series: 'day',
    });
    expect(buildRecentRequestsParams({ limit: 500, afterSeq: 0 })).toEqual({ limit: 500 });
    expect(buildRecentRequestsParams({ limit: 500, afterSeq: 41, key: 'ci' })).toEqual({
      limit: 500,
      key: 'ci',
      after_seq: 41,
    });
  });
});
