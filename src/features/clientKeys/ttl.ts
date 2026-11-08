export const TTL_PRESETS = [
  { value: '24h', labelKey: 'client_keys.issue.expiry_1d' },
  { value: '168h', labelKey: 'client_keys.issue.expiry_7d' },
  { value: '720h', labelKey: 'client_keys.issue.expiry_30d' },
  { value: '2160h', labelKey: 'client_keys.issue.expiry_90d' },
  { value: '8760h', labelKey: 'client_keys.issue.expiry_1y' },
] as const;

export const DEFAULT_TTL = '8760h';

export type TtlParse =
  | { ok: true; ttl: string; ms: number }
  | { ok: false; error: 'empty' | 'invalid' | 'too_short' | 'too_long' };

const HOUR_MS = 3_600_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 87_600 * HOUR_MS;

const UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  μs: 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: HOUR_MS,
  d: 24 * HOUR_MS,
  w: 168 * HOUR_MS,
};

const SEGMENT = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h|d|w)/y;

export function parseTtl(input: string): TtlParse {
  const text = input.trim();
  if (!text) return { ok: false, error: 'empty' };
  let ms = 0;
  let position = 0;
  while (position < text.length) {
    SEGMENT.lastIndex = position;
    const match = SEGMENT.exec(text);
    if (!match) return { ok: false, error: 'invalid' };
    ms += Number(match[1]) * UNIT_MS[match[2]];
    position = SEGMENT.lastIndex;
  }
  if (!Number.isFinite(ms)) return { ok: false, error: 'too_long' };
  if (ms < MIN_TTL_MS) return { ok: false, error: 'too_short' };
  if (ms > MAX_TTL_MS) return { ok: false, error: 'too_long' };
  return { ok: true, ttl: `${Math.round(ms / 1000)}s`, ms };
}

export function previewExpiry(ttlMs: number, nowMs: number): number {
  return nowMs + ttlMs;
}
