import type { AuthFileItem } from '@/types';

// The backend keeps ten-minute request buckets per credential, oldest first, the newest in progress.
const LAST_HOUR_BUCKETS = 6;

export interface AccountActivity {
  requests: number;
  /** Share of the provider's requests in the last hour, 0-1; null when the provider was idle. */
  share: number | null;
  busiest: boolean;
}

export interface ActivityAccount {
  key: string;
  type: string;
  file: AuthFileItem;
}

const lastHourRequests = (file: AuthFileItem) =>
  (file.recentRequests ?? [])
    .slice(-LAST_HOUR_BUCKETS)
    .reduce((sum, bucket) => sum + bucket.success + bucket.failed, 0);

export function buildLastHourActivity(
  accounts: readonly ActivityAccount[]
): Map<string, AccountActivity> {
  const requestsByKey = new Map(accounts.map(({ key, file }) => [key, lastHourRequests(file)]));
  const totals = new Map<string, number>();
  const busiestByType = new Map<string, { key: string; requests: number }>();
  accounts.forEach(({ key, type }) => {
    const requests = requestsByKey.get(key) ?? 0;
    totals.set(type, (totals.get(type) ?? 0) + requests);
    const leader = busiestByType.get(type);
    if (requests > 0 && (!leader || requests > leader.requests)) {
      busiestByType.set(type, { key, requests });
    }
  });
  return new Map(
    accounts.map(({ key, type }) => {
      const requests = requestsByKey.get(key) ?? 0;
      const total = totals.get(type) ?? 0;
      return [
        key,
        {
          requests,
          share: total > 0 ? requests / total : null,
          busiest: busiestByType.get(type)?.key === key,
        },
      ];
    })
  );
}
