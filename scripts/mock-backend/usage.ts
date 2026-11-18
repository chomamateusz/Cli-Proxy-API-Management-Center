import { USAGE_RECORDED_DAYS, usageKeyFixtures, type UsageKeyFixture } from './fixtures';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOUR_SERIES_MAX_HOURS = 744;
const RING_CAPACITY = 2000;
const LIVE_TICK_MS = 4000;

interface Counters {
  requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
}

interface RecentEntry extends Counters {
  seq: number;
  requested_at: string;
  key: string;
  provider: string;
  model: string;
  response_model?: string;
  auth_index: string;
  account: string;
  stream: boolean;
  latency_ms: number;
  ttft_ms?: number;
  failed: boolean;
  status_code?: number;
  service_tier?: string;
  reasoning_effort?: string;
}

type Reply = { status: number; body: unknown };

const emptyCounters = (): Counters => ({
  requests: 0,
  failed_requests: 0,
  input_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  total_tokens: 0,
});

const COUNTER_FIELDS = Object.keys(emptyCounters()) as (keyof Counters)[];

const addInto = (target: Counters, delta: Counters) => {
  for (const field of COUNTER_FIELDS) target[field] += delta[field];
};

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const activity = (atMs: number) => {
  const hour = new Date(atMs).getUTCHours();
  if (hour >= 8 && hour < 18) return 1;
  if (hour >= 18 && hour < 23) return 0.45;
  return 0.08;
};

const pseudonym = (provider: string, authIndex: string) =>
  `${provider}-${[...authIndex]
    .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)
    .toString(16)
    .padStart(8, '0')
    .slice(0, 6)}`;

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function pickRoute(fixture: UsageKeyFixture, random: () => number) {
  const total = fixture.routes.reduce((sum, route) => sum + route.weight, 0);
  let roll = random() * total;
  for (const route of fixture.routes) {
    roll -= route.weight;
    if (roll <= 0) return route;
  }
  return fixture.routes[0];
}

function requestCounters(failed: boolean, provider: string, random: () => number): Counters {
  if (failed) return { ...emptyCounters(), failed_requests: 1 };
  const input = Math.round(1500 + random() * 9000);
  const output = Math.round(200 + random() * (provider === 'codex' ? 2600 : 1800));
  const reasoning = provider === 'codex' ? Math.round(output * random() * 0.6) : 0;
  const cacheRead = Math.round(random() * 60000);
  const cacheCreation = provider === 'claude' ? Math.round(random() * 4000) : 0;
  return {
    requests: 1,
    failed_requests: 0,
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    total_tokens: input + output + cacheRead + cacheCreation,
  };
}

const FAILURE_CODES = [429, 429, 500, 529, 401];

export function createUsageMock(startedAt: number, createdAt: () => Record<string, string>) {
  const random = seededRandom(20261118);
  const recordingSince = Math.floor((startedAt - USAGE_RECORDED_DAYS * DAY_MS) / HOUR_MS) * HOUR_MS;
  const ledger = new Map<
    string,
    Counters & { hour: number; key: string; provider: string; model: string }
  >();
  const ring: RecentEntry[] = [];
  let seq = 0;

  const record = (
    atMs: number,
    key: string,
    provider: string,
    model: string,
    counters: Counters
  ) => {
    const hour = Math.floor(atMs / HOUR_MS) * HOUR_MS;
    const id = `${hour}|${key}|${provider}|${model}`;
    const bucket = ledger.get(id) ?? { ...emptyCounters(), hour, key, provider, model };
    addInto(bucket, counters);
    ledger.set(id, bucket);
  };

  for (let hour = recordingSince; hour < startedAt; hour += HOUR_MS) {
    for (const fixture of usageKeyFixtures) {
      const count = Math.round(fixture.peakPerHour * activity(hour) * (0.5 + random()));
      for (let index = 0; index < count; index += 1) {
        const route = pickRoute(fixture, random);
        const failed = random() < fixture.failureRate;
        record(
          hour,
          fixture.name,
          route.provider,
          route.model,
          requestCounters(failed, route.provider, random)
        );
      }
    }
  }

  const liveRequest = (atMs: number) => {
    const fixture = usageKeyFixtures[Math.floor(random() * usageKeyFixtures.length)];
    const route = pickRoute(fixture, random);
    const failed = random() < fixture.failureRate * 2;
    const counters = requestCounters(failed, route.provider, random);
    const authIndex = route.authIndexes[Math.floor(random() * route.authIndexes.length)];
    const stream = random() < 0.7;
    const latency = Math.round(failed ? 150 + random() * 900 : 1200 + random() * 38000);
    seq += 1;
    const entry: RecentEntry = {
      seq,
      requested_at: new Date(atMs).toISOString(),
      key: fixture.name,
      provider: route.provider,
      model: route.model,
      ...(route.provider === 'claude' && route.model === 'claude-opus-5' && random() < 0.2
        ? { response_model: 'claude-opus-5-20261101' }
        : {}),
      auth_index: authIndex,
      account: pseudonym(route.provider, authIndex),
      stream,
      latency_ms: latency,
      ...(stream && !failed ? { ttft_ms: Math.round(300 + random() * 2500) } : {}),
      failed,
      ...(failed
        ? { status_code: FAILURE_CODES[Math.floor(random() * FAILURE_CODES.length)] }
        : {}),
      ...(route.provider === 'codex'
        ? { service_tier: random() < 0.3 ? 'priority' : 'default' }
        : {}),
      ...(route.provider === 'codex'
        ? { reasoning_effort: random() < 0.5 ? 'high' : 'medium' }
        : {}),
      ...counters,
    };
    ring.push(entry);
    if (ring.length > RING_CAPACITY) ring.shift();
    record(atMs, entry.key, entry.provider, entry.model, counters);
  };

  for (let index = 180; index > 0; index -= 1) liveRequest(startedAt - index * 19_000);
  setInterval(() => {
    const burst = 1 + Math.floor(random() * 3);
    for (let index = 0; index < burst; index += 1) liveRequest(Date.now());
  }, LIVE_TICK_MS);

  const invalid = (code: string, message: string): Reply => ({
    status: 400,
    body: { error: code, message },
  });

  const clientKeys = (params: URLSearchParams): Reply => {
    const now = Date.now();
    const toRaw = params.get('to');
    const fromRaw = params.get('from');
    const to = toRaw ? Date.parse(toRaw) : now;
    const from = fromRaw ? Date.parse(fromRaw) : recordingSince;
    if (!Number.isFinite(to) || !Number.isFinite(from) || from > to) {
      return invalid('invalid_window', 'from and to must be RFC3339 with from <= to');
    }
    const fromHour = Math.floor(from / HOUR_MS) * HOUR_MS;
    const toHour = Math.ceil(to / HOUR_MS) * HOUR_MS;
    const series = params.get('series');
    if (series !== null && series !== 'hour' && series !== 'day') {
      return invalid('invalid_series', 'series must be hour or day');
    }
    if (series === 'hour' && toHour - fromHour > HOUR_SERIES_MAX_HOURS * HOUR_MS) {
      return invalid('invalid_window', 'series=hour supports at most 744 hours');
    }
    const keyFilter = params.get('key')?.trim() ?? '';
    const buckets = [...ledger.values()].filter(
      (bucket) =>
        bucket.hour >= fromHour && bucket.hour < toHour && (!keyFilter || bucket.key === keyFilter)
    );
    const created = createdAt();
    const keys = new Map<
      string,
      Counters & { models: Map<string, Counters & { provider: string; model: string }> }
    >();
    for (const bucket of buckets) {
      const key = keys.get(bucket.key) ?? { ...emptyCounters(), models: new Map() };
      addInto(key, bucket);
      const modelId = `${bucket.provider}|${bucket.model}`;
      const model = key.models.get(modelId) ?? {
        ...emptyCounters(),
        provider: bucket.provider,
        model: bucket.model,
      };
      addInto(model, bucket);
      key.models.set(modelId, model);
      keys.set(bucket.key, key);
    }
    const seriesRows = new Map<
      string,
      Counters & { start: string; key: string; provider: string; model: string }
    >();
    if (series) {
      for (const bucket of buckets) {
        const start = series === 'day' ? Math.floor(bucket.hour / DAY_MS) * DAY_MS : bucket.hour;
        const id = `${start}|${bucket.key}|${bucket.provider}|${bucket.model}`;
        const row = seriesRows.get(id) ?? {
          ...emptyCounters(),
          start: iso(start),
          key: bucket.key,
          provider: bucket.provider,
          model: bucket.model,
        };
        addInto(row, bucket);
        seriesRows.set(id, row);
      }
    }
    const synthetic = (name: string) => name === 'anonymous' || name.startsWith('unnamed-');
    return {
      status: 200,
      body: {
        object: 'fleet.client_key_usage',
        generated_at: iso(now),
        from: iso(fromHour),
        to: iso(toHour),
        recording_since: iso(recordingSince),
        granularity: series ?? 'hour',
        keys: [...keys.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, { models, ...counters }]) => ({
            name,
            created_at: created[name] ?? null,
            revoked: !(name in created) && !synthetic(name),
            ...counters,
            models: [...models.values()].sort((left, right) =>
              `${left.provider}/${left.model}`.localeCompare(`${right.provider}/${right.model}`)
            ),
          })),
        ...(series
          ? {
              series: [...seriesRows.values()].sort(
                (left, right) =>
                  left.start.localeCompare(right.start) ||
                  left.key.localeCompare(right.key) ||
                  left.provider.localeCompare(right.provider) ||
                  left.model.localeCompare(right.model)
              ),
            }
          : {}),
      },
    };
  };

  const recentRequests = (params: URLSearchParams): Reply => {
    const limitRaw = params.get('limit');
    const limit = limitRaw === null ? 200 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > RING_CAPACITY) {
      return invalid('invalid_limit', `limit must be between 1 and ${RING_CAPACITY}`);
    }
    const afterRaw = params.get('after_seq');
    const after = afterRaw === null ? 0 : Number(afterRaw);
    if (!Number.isInteger(after) || after < 0) {
      return invalid('invalid_after_seq', 'after_seq must be a non-negative integer');
    }
    const keyFilter = params.get('key')?.trim() ?? '';
    const requests = ring
      .filter((entry) => entry.seq > after && (!keyFilter || entry.key === keyFilter))
      .reverse()
      .slice(0, limit);
    return {
      status: 200,
      body: {
        object: 'fleet.recent_requests',
        generated_at: iso(Date.now()),
        capacity: RING_CAPACITY,
        latest_seq: seq,
        requests,
      },
    };
  };

  return { clientKeys, recentRequests };
}
