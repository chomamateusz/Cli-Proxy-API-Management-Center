import { apiClient } from './client';
import type {
  ClientKeyUsageQuery,
  ClientKeyUsageReport,
  KeyUsage,
  ModelUsage,
  RecentRequest,
  RecentRequestsPage,
  RecentRequestsQuery,
  UsageCounters,
  UsageSeriesPoint,
} from '@/types/fleetUsage';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';
import { parseTimestampMs } from '@/utils/timestamp';

const USAGE_TIMEOUT_MS = 20 * 1000;

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const readOptionalText = (value: unknown): string | null => readText(value) || null;

const readOptionalPositive = (value: unknown): number | null => {
  const count = readCount(value);
  return count > 0 ? count : null;
};

const readInstantMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const ms = parseTimestampMs(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

const readArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const readUsageCounters = (raw: Record<string, unknown>): UsageCounters => ({
  requests: readCount(raw.requests),
  failedRequests: readCount(raw.failed_requests),
  inputTokens: readCount(raw.input_tokens),
  outputTokens: readCount(raw.output_tokens),
  reasoningTokens: readCount(raw.reasoning_tokens),
  cacheReadTokens: readCount(raw.cache_read_tokens),
  cacheCreationTokens: readCount(raw.cache_creation_tokens),
  totalTokens: readCount(raw.total_tokens),
});

const normalizeModelUsage = (raw: unknown): ModelUsage | null => {
  if (!isRecord(raw)) return null;
  return {
    provider: readText(raw.provider) || 'unknown',
    model: readText(raw.model) || 'unknown',
    ...readUsageCounters(raw),
  };
};

const normalizeKeyUsage = (raw: unknown): KeyUsage | null => {
  if (!isRecord(raw)) return null;
  const name = readText(raw.name);
  if (!name) return null;
  return {
    name,
    createdAtMs: readInstantMs(raw.created_at),
    revoked: raw.revoked === true,
    models: readArray(raw.models).flatMap((entry) => normalizeModelUsage(entry) ?? []),
    ...readUsageCounters(raw),
  };
};

const normalizeSeriesPoint = (raw: unknown): UsageSeriesPoint | null => {
  if (!isRecord(raw)) return null;
  const startMs = readInstantMs(raw.start);
  const key = readText(raw.key);
  if (startMs === null || !key) return null;
  return {
    startMs,
    key,
    provider: readText(raw.provider) || 'unknown',
    model: readText(raw.model) || 'unknown',
    ...readUsageCounters(raw),
  };
};

export const normalizeClientKeyUsage = (raw: unknown): ClientKeyUsageReport => {
  const record = isRecord(raw) ? raw : {};
  const fromMs = readInstantMs(record.from) ?? 0;
  return {
    generatedAtMs: readInstantMs(record.generated_at) ?? Date.now(),
    fromMs,
    toMs: readInstantMs(record.to) ?? fromMs,
    recordingSinceMs: readInstantMs(record.recording_since),
    granularity: record.granularity === 'day' ? 'day' : 'hour',
    keys: readArray(record.keys).flatMap((entry) => normalizeKeyUsage(entry) ?? []),
    series: readArray(record.series).flatMap((entry) => normalizeSeriesPoint(entry) ?? []),
  };
};

const normalizeRecentRequest = (raw: unknown): RecentRequest | null => {
  if (!isRecord(raw)) return null;
  const seq = raw.seq;
  const requestedAtMs = readInstantMs(raw.requested_at);
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || requestedAtMs === null) {
    return null;
  }
  const model = readText(raw.model);
  const responseModel = readText(raw.response_model);
  const failed = raw.failed === true;
  return {
    seq,
    requestedAtMs,
    key: readText(raw.key),
    provider: readText(raw.provider),
    model,
    responseModel: responseModel && responseModel !== model ? responseModel : null,
    authIndex: normalizeAuthIndex(raw.auth_index),
    account: readText(raw.account),
    stream: raw.stream === true,
    latencyMs: readCount(raw.latency_ms),
    ttftMs: readOptionalPositive(raw.ttft_ms),
    failed,
    statusCode: failed ? readOptionalPositive(raw.status_code) : null,
    serviceTier: readOptionalText(raw.service_tier),
    reasoningEffort: readOptionalText(raw.reasoning_effort),
    ...readUsageCounters(raw),
  };
};

export const normalizeRecentRequests = (raw: unknown): RecentRequestsPage => {
  const record = isRecord(raw) ? raw : {};
  return {
    generatedAtMs: readInstantMs(record.generated_at) ?? Date.now(),
    capacity: readCount(record.capacity),
    latestSeq: readCount(record.latest_seq),
    requests: readArray(record.requests).flatMap((entry) => normalizeRecentRequest(entry) ?? []),
  };
};

export const toRfc3339Seconds = (ms: number): string =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

export const buildClientKeyUsageParams = (query: ClientKeyUsageQuery) => ({
  ...(query.fromMs === null ? {} : { from: toRfc3339Seconds(query.fromMs) }),
  to: toRfc3339Seconds(query.toMs),
  series: query.series,
  ...(query.key ? { key: query.key } : {}),
});

export const buildRecentRequestsParams = (query: RecentRequestsQuery) => ({
  limit: query.limit,
  ...(query.key ? { key: query.key } : {}),
  ...(query.afterSeq ? { after_seq: query.afterSeq } : {}),
});

export const fleetUsageApi = {
  async getClientKeyUsage(query: ClientKeyUsageQuery): Promise<ClientKeyUsageReport> {
    const data = await apiClient.get<unknown>('/usage/client-keys', {
      params: buildClientKeyUsageParams(query),
      timeout: USAGE_TIMEOUT_MS,
    });
    return normalizeClientKeyUsage(data);
  },

  async getRecentRequests(query: RecentRequestsQuery): Promise<RecentRequestsPage> {
    const data = await apiClient.get<unknown>('/usage/recent-requests', {
      params: buildRecentRequestsParams(query),
    });
    return normalizeRecentRequests(data);
  },
};
