import { describe, expect, test } from 'bun:test';
import {
  appendQuotaReading,
  lastQuotaReadingAtFrom,
  parseQuotaReadingLog,
  quotaFetchedAtMs,
  QUOTA_READING_RETENTION_MS,
} from '@/features/quota/quotaReadings';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';

const MINUTE = 60 * 1000;

describe('appendQuotaReading', () => {
  test('drops readings past retention and repeats within a minute', () => {
    const now = 10 * QUOTA_READING_RETENTION_MS;
    const old = { at: now - QUOTA_READING_RETENTION_MS - MINUTE, remaining: 90 };
    const recent = { at: now - 30 * 1000, remaining: 80 };
    expect(appendQuotaReading([old, recent], { at: now, remaining: 80 })).toEqual([recent]);
    expect(appendQuotaReading([recent], { at: now, remaining: 79 })).toEqual([
      recent,
      { at: now, remaining: 79 },
    ]);
  });

  test('keeps only the ends of a run of equal readings', () => {
    const first = { at: 0, remaining: 70 };
    const second = { at: 10 * MINUTE, remaining: 70 };
    const third = { at: 20 * MINUTE, remaining: 70 };
    expect(appendQuotaReading([first], second)).toEqual([first, second]);
    expect(appendQuotaReading([first, second], third)).toEqual([first, third]);
  });

  test('a load seen late keeps its fetch time and never displaces newer readings', () => {
    const fetchedAt = Date.parse('2026-10-12T09:00:00Z');
    const claude: ClaudeQuotaState = {
      status: 'success',
      windows: [],
      observedAt: new Date(fetchedAt).toISOString(),
    };
    const codex: CodexQuotaState = { status: 'success', windows: [], loadedAtMs: fetchedAt };
    expect(quotaFetchedAtMs('claude', claude)).toBe(fetchedAt);
    expect(quotaFetchedAtMs('codex', codex)).toBe(fetchedAt);

    const newer = [{ at: fetchedAt + 3 * 60 * MINUTE, remaining: 60 }];
    expect(appendQuotaReading(newer, { at: fetchedAt, remaining: 90 })).toEqual(newer);
    expect(appendQuotaReading(newer, { at: newer[0].at, remaining: 59 })).toEqual(newer);
  });
});

describe('parseQuotaReadingLog', () => {
  test('keeps valid, unexpired readings and ignores junk', () => {
    const now = 10 * QUOTA_READING_RETENTION_MS;
    const raw = JSON.stringify({
      'work.json': {
        'five-hour': [
          { at: now - MINUTE, remaining: 50 },
          { at: now - QUOTA_READING_RETENTION_MS - MINUTE, remaining: 60 },
          { at: 'soon', remaining: 1 },
        ],
        weekly: 'nope',
      },
      broken: [1, 2],
    });
    expect(parseQuotaReadingLog(raw, now)).toEqual({
      'work.json': { 'five-hour': [{ at: now - MINUTE, remaining: 50 }] },
    });
    expect(parseQuotaReadingLog('{not json', now)).toEqual({});
  });

  test('the last reading of an account is its newest across windows', () => {
    const log = {
      'work.json': {
        'seven-day': [{ at: 5, remaining: 90 }],
        weekly: [
          { at: 1, remaining: 80 },
          { at: 9, remaining: 70 },
        ],
      },
    };
    expect(lastQuotaReadingAtFrom(log, 'work.json')).toBe(9);
    expect(lastQuotaReadingAtFrom(log, 'other.json')).toBeNull();
  });
});
