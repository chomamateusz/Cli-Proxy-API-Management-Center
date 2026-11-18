import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types/authFile';
import type { RecentRequest, RecentRequestsPage } from '@/types/fleetUsage';
import { normalizeAuthIndex } from '@/utils/authIndex';

export const LIVE_ROW_CAP = 500;
export const LIVE_POLL_MS = 5_000;

export function mergeRecentRequests(
  existing: readonly RecentRequest[],
  incoming: readonly RecentRequest[],
  cap = LIVE_ROW_CAP
): RecentRequest[] {
  const bySeq = new Map<number, RecentRequest>();
  existing.forEach((row) => bySeq.set(row.seq, row));
  incoming.forEach((row) => bySeq.set(row.seq, row));
  return [...bySeq.values()].sort((left, right) => right.seq - left.seq).slice(0, cap);
}

export interface LiveFeedState {
  rows: RecentRequest[];
  cursor: number;
  loaded: boolean;
  fresh: ReadonlySet<number>;
}

export const EMPTY_LIVE_FEED: LiveFeedState = {
  rows: [],
  cursor: 0,
  loaded: false,
  fresh: new Set(),
};

export const proxyRestarted = (state: LiveFeedState, page: RecentRequestsPage) =>
  page.latestSeq < state.cursor;

export const afterSeqFor = (state: LiveFeedState) => (state.loaded ? state.cursor : 0);

export function applyRecentPage(
  state: LiveFeedState,
  page: RecentRequestsPage,
  cap = LIVE_ROW_CAP
): LiveFeedState {
  if (proxyRestarted(state, page)) return EMPTY_LIVE_FEED;
  const incoming = page.requests.filter((row) => row.seq > afterSeqFor(state));
  const known = new Set(state.rows.map((row) => row.seq));
  const fresh = state.loaded
    ? new Set(incoming.filter((row) => !known.has(row.seq)).map((row) => row.seq))
    : new Set<number>();
  const maxSeq = incoming.reduce((max, row) => Math.max(max, row.seq), state.cursor);
  return {
    rows: mergeRecentRequests(state.rows, incoming, cap),
    cursor: Math.max(maxSeq, page.latestSeq),
    loaded: true,
    fresh,
  };
}

export function buildAccountNames(files: readonly AuthFileItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of files) {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file['auth_index']);
    const name = deriveAuthFileIdentity(file).primary;
    if (authIndex && name && !names.has(authIndex)) names.set(authIndex, name);
  }
  return names;
}

export function accountLabel(row: RecentRequest, names: ReadonlyMap<string, string>): string {
  const resolved = row.authIndex ? names.get(row.authIndex) : undefined;
  return resolved || row.account;
}
