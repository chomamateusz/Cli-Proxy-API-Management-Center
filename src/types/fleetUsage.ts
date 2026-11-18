export interface UsageCounters {
  requests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface ModelUsage extends UsageCounters {
  provider: string;
  model: string;
}

export interface KeyUsage extends UsageCounters {
  name: string;
  createdAtMs: number | null;
  revoked: boolean;
  models: ModelUsage[];
}

export type SeriesGranularity = 'hour' | 'day';

export interface UsageSeriesPoint extends UsageCounters {
  startMs: number;
  key: string;
  provider: string;
  model: string;
}

export interface ClientKeyUsageReport {
  generatedAtMs: number;
  fromMs: number;
  toMs: number;
  recordingSinceMs: number | null;
  granularity: SeriesGranularity;
  keys: KeyUsage[];
  series: UsageSeriesPoint[];
}

export interface ClientKeyUsageQuery {
  fromMs: number | null;
  toMs: number;
  series: SeriesGranularity;
  key?: string;
}

export interface RecentRequest extends UsageCounters {
  seq: number;
  requestedAtMs: number;
  key: string;
  provider: string;
  model: string;
  responseModel: string | null;
  authIndex: string | null;
  account: string;
  stream: boolean;
  latencyMs: number;
  ttftMs: number | null;
  failed: boolean;
  statusCode: number | null;
  serviceTier: string | null;
  reasoningEffort: string | null;
}

export interface RecentRequestsPage {
  generatedAtMs: number;
  capacity: number;
  latestSeq: number;
  requests: RecentRequest[];
}

export interface RecentRequestsQuery {
  limit: number;
  key?: string;
  afterSeq?: number;
}
