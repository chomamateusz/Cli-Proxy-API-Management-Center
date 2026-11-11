import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import { buildLastHourActivity } from '@/features/quota/quotaActivity';

const file = (name: string, lastHour: number[], earlier = 0): AuthFileItem => ({
  name,
  recentRequests: [...Array(6).fill(earlier), ...lastHour].map((success) => ({
    success,
    failed: 0,
  })),
});

describe('last-hour activity', () => {
  test('counts only the last hour and marks the busiest account per provider', () => {
    const activity = buildLastHourActivity([
      { key: 'claude:a', type: 'claude', file: file('a', [1, 1, 1, 1, 1, 1], 50) },
      { key: 'claude:b', type: 'claude', file: file('b', [2, 3, 4, 5, 2, 2]) },
      { key: 'codex:c', type: 'codex', file: file('c', [0, 0, 0, 0, 0, 1]) },
    ]);

    expect(activity.get('claude:a')?.requests).toBe(6);
    expect(activity.get('claude:b')).toEqual({ requests: 18, share: 0.75, busiest: true });
    expect(activity.get('claude:a')?.busiest).toBe(false);
    expect(activity.get('codex:c')).toEqual({ requests: 1, share: 1, busiest: true });
  });

  test('failed requests count as traffic', () => {
    const busy: AuthFileItem = { name: 'f', recentRequests: [{ success: 1, failed: 2 }] };
    expect(
      buildLastHourActivity([{ key: 'k', type: 'claude', file: busy }]).get('k')?.requests
    ).toBe(3);
  });

  test('an idle provider has no busiest account and no share', () => {
    const activity = buildLastHourActivity([
      { key: 'claude:a', type: 'claude', file: { name: 'a' } },
    ]);
    expect(activity.get('claude:a')).toEqual({ requests: 0, share: null, busiest: false });
  });
});
