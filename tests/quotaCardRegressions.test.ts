import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  planResetGrantLines,
  usableGrantCount,
  type ResetGrantActionBlock,
} from '@/features/quota/providers/claude/resetGrantAvailability';
import {
  parseAnthropicResetGrantStatus,
  type AnthropicResetGrant,
} from '@/services/api/claudeResetGrants';

const NOW = Date.UTC(2026, 10, 19, 12);
const source = (file: string) =>
  readFile(join(import.meta.dir, '../src/features/quota', file), 'utf8');

const grant = (overrides: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id: 'reset',
  label: 'Reset',
  resetsTotal: 2,
  resetsLeft: 1,
  startsAt: new Date(NOW - 1000).toISOString(),
  endsAt: new Date(NOW + 1000).toISOString(),
  clears: ['five_hour'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  ...overrides,
});

const lines = (grants: AnthropicResetGrant[]) =>
  planResetGrantLines(
    { ...parseAnthropicResetGrantStatus({ eligible: false, at_limit: true })!, grants },
    undefined,
    NOW,
    null,
    String
  );

describe('reset count independent of account blockers', () => {
  test.each([
    'ineligible',
    'paused',
    'cooldown',
    'busy',
    'other_pending',
  ] satisfies ResetGrantActionBlock[])('%s does not mask expired or future grants', (block) => {
    const planned = lines([
      grant({ id: 'active' }),
      grant({ id: 'expired', endsAt: new Date(NOW).toISOString() }),
      grant({ id: 'future', startsAt: new Date(NOW + 1).toISOString() }),
      grant({ id: 'spent', resetsLeft: 0 }),
    ]).map((line) => ({ ...line, block }));
    expect(usableGrantCount(planned, NOW)).toBe(1);
    expect(usableGrantCount(planned, NOW + 1000)).toBe(0);
  });

  test('starts at the boundary, excludes pending ghosts and accepts unknown dates', () => {
    const active = lines([grant({ startsAt: new Date(NOW).toISOString(), endsAt: null })]);
    expect(usableGrantCount(active, NOW)).toBe(1);
    const pending = planResetGrantLines(
      null,
      { grantId: 'missing', label: 'Missing', expired: false },
      NOW,
      null,
      String
    );
    expect(usableGrantCount(pending, NOW)).toBe(0);
  });
});

describe('Cards page wiring', () => {
  test('ranking uses all classified entries, and visibility filters run afterwards', async () => {
    const page = await source('QuotaPage.tsx');
    const ranking = page.slice(
      page.indexOf('const routerRanking ='),
      page.indexOf('const routerPlacements =')
    );
    expect(ranking).toContain('entries.map(');
    expect(ranking).not.toContain('filteredEntries');
    const sorting = page.slice(
      page.indexOf('const sortedEntries ='),
      page.indexOf('const { pageItems')
    );
    expect(sorting).toMatch(/filterEntriesBySearch\(\s*filterEntriesByTab\(/);
    expect(sorting).toContain('routerRanking.map(');
    expect(sorting).toContain('search');
  });

  test('group counts and pools share the retained-reading predicate', async () => {
    const page = await source('QuotaPage.tsx');
    expect(page).toContain('const loaded = hasQuotaReadings(entry.type, quota)');
    expect(page).toContain(
      'loadedCount: group.entries.filter((entry) => slotsOf(entry).loaded).length'
    );
  });

  test('descriptive branch comments are removed and the sort comment is restored', async () => {
    const slots = await source('quotaSlots.ts');
    const card = await source('components/QuotaCard.tsx');
    for (const text of [
      'Enabled, not ended and loaded',
      'Null means the provider',
      "The provider body's row id",
    ]) {
      expect(slots).not.toContain(text);
    }
    for (const text of ['Column label per slot', 'Claude banked resets join']) {
      expect(card).not.toContain(text);
    }
    const constants = await source('constants.ts');
    expect(constants).toContain(
      '/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */'
    );
  });

  test('Cards groups allow 270px tracks and constrain identity and meta content', async () => {
    const group = await source('components/QuotaCardGroup.module.scss');
    expect(group).toContain('repeat(auto-fill, minmax(min(100%, 270px), 1fr))');
    const card = await source('components/QuotaCard.module.scss');
    expect(card).toMatch(/\.fileName\s*\{[^}]*min-width: 0;[^}]*@include text-ellipsis;/s);
    expect(card).toMatch(/\.orderBadge\s*\{[^}]*min-width: 0;[^}]*overflow: hidden;/s);
    expect(card).toMatch(/\.metaItem\s*\{[^}]*overflow: hidden;/s);
    expect(card).toMatch(/> :last-child\s*\{[^}]*min-width: 0;[^}]*@include text-ellipsis;/s);
  });
});
