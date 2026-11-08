import { describe, expect, test } from 'bun:test';
import {
  blockAllPattern,
  buildModelCatalog,
  countPatterns,
  deriveCredentialCell,
  deriveModelCell,
  mergePolicies,
  rowReadonlyReason,
  summarizeRow,
} from '../src/features/clientKeys/matrix';
import { toPolicyCredential } from '../src/features/clientKeys/credentials';
import type {
  ClientKeyPolicy,
  ModelColumn,
  PolicyCredential,
  PolicyLists,
} from '../src/types/clientKeys';

const lists = (overrides: Partial<PolicyLists> = {}): PolicyLists => ({
  models: [],
  excludedModels: [],
  credentials: [],
  excludedCredentials: [],
  ...overrides,
});

const entry = (
  name: string,
  index: number,
  overrides: Partial<PolicyLists> = {}
): ClientKeyPolicy => ({
  index,
  name,
  issuedBy: '',
  expiresAt: '',
  expiresAtMs: null,
  hasPolicy: true,
  ...lists(overrides),
});

const WORK = toPolicyCredential({
  name: 'claude-work.json',
  id: 'claude-work.json',
  type: 'claude',
  email: 'work@example.com',
});
const TEAM = toPolicyCredential({
  name: 'claude-team.json',
  id: 'claude-team.json',
  type: 'claude',
  email: 'team@example.com',
});
const RUNTIME = toPolicyCredential({
  name: 'gemini-rt',
  id: 'gemini-rt',
  type: 'gemini',
  label: 'Gemini runtime',
  runtimeOnly: true,
});
const CREDENTIALS: PolicyCredential[] = [WORK, TEAM, RUNTIME];

const column = (id: string, credentialNames = ['claude-work.json']): ModelColumn => ({
  id,
  provider: 'claude',
  providers: ['claude'],
  credentialNames,
});

describe('buildModelCatalog', () => {
  test('unions, dedupes case-insensitively, groups once and sorts', () => {
    const codex = toPolicyCredential({ name: 'codex.json', id: 'codex.json', type: 'codex' });
    const broken = toPolicyCredential({ name: 'broken.json', id: 'broken.json', type: 'xai' });
    const catalog = buildModelCatalog(
      [WORK, codex, broken, TEAM],
      {
        'claude-work.json': ['claude-opus', ' Shared-Model ', 'claude-10', 'claude-9'],
        'codex.json': ['gpt-5', 'shared-model'],
        'broken.json': null,
        'claude-team.json': ['claude-opus'],
      },
      (provider) => provider.toUpperCase()
    );
    expect(catalog.groups.map((group) => group.provider)).toEqual(['claude', 'codex']);
    expect(catalog.groups[0].columns.map((col) => col.id)).toEqual([
      'claude-9',
      'claude-10',
      'claude-opus',
      'Shared-Model',
    ]);
    const shared = catalog.groups[0].columns.find((col) => col.id === 'Shared-Model');
    expect(shared?.providers).toEqual(['claude', 'codex']);
    expect(shared?.credentialNames).toEqual(['claude-work.json', 'codex.json']);
    expect(catalog.groups[1].columns.map((col) => col.id)).toEqual(['gpt-5']);
    expect(catalog.ids).toEqual(['claude-9', 'claude-10', 'claude-opus', 'Shared-Model', 'gpt-5']);
    const opus = catalog.groups[0].columns.find((col) => col.id === 'claude-opus');
    expect(opus?.credentialNames).toEqual(['claude-work.json', 'claude-team.json']);
  });
});

describe('deriveModelCell', () => {
  const cell = (overrides: Partial<PolicyLists>, id: string, credentialNames?: string[]) =>
    deriveModelCell(lists(overrides), column(id, credentialNames), CREDENTIALS, null);

  test('fleet default: a wildcard exclusion locks, everything else is allowed', () => {
    const p = { models: ['*'], excludedModels: ['claude-fable-*'] };
    expect(cell(p, 'claude-fable-5')).toEqual({
      state: 'locked',
      allowed: false,
      lock: { reason: 'pattern', patterns: ['claude-fable-*'] },
      exactEntries: [],
    });
    expect(cell(p, 'claude-opus')).toEqual({
      state: 'allowed',
      unreachable: false,
      exactEntries: [],
    });
  });

  test('exact exclusions are toggleable and keep every raw case variant', () => {
    expect(cell({ excludedModels: ['gpt-5'] }, 'gpt-5')).toEqual({
      state: 'blocked',
      exactEntries: ['gpt-5'],
    });
    expect(cell({ excludedModels: ['GPT-5', 'gpt-5'] }, 'gpt-5')).toEqual({
      state: 'blocked',
      exactEntries: ['GPT-5', 'gpt-5'],
    });
  });

  test('an exact entry next to a wildcard is locked by the pattern', () => {
    expect(cell({ excludedModels: ['gpt-5', 'gpt-*'] }, 'gpt-5')).toMatchObject({
      state: 'locked',
      lock: { reason: 'pattern', patterns: ['gpt-*'] },
      exactEntries: ['gpt-5'],
    });
  });

  test('a restrictive allowlist locks misses and keeps exact hits for the sheet', () => {
    expect(cell({ models: ['claude-*'] }, 'gpt-5')).toMatchObject({
      state: 'locked',
      allowed: false,
      lock: { reason: 'allowlist' },
    });
    expect(cell({ models: ['claude-*'] }, 'claude-x').state).toBe('allowed');
    expect(cell({ models: ['claude-*'], excludedModels: ['gpt-5'] }, 'gpt-5')).toEqual({
      state: 'locked',
      allowed: false,
      lock: { reason: 'allowlist' },
      exactEntries: ['gpt-5'],
    });
  });

  test('excluding * locks every cell', () => {
    for (const id of ['a', 'claude-opus', 'gpt-5(high)']) {
      expect(cell({ excludedModels: ['*'] }, id)).toMatchObject({
        state: 'locked',
        lock: { reason: 'pattern', patterns: ['*'] },
      });
    }
  });

  test('a suffixed column blocked only through its base is a pattern lock', () => {
    expect(cell({ excludedModels: ['gpt-5'] }, 'gpt-5(high)')).toMatchObject({
      state: 'locked',
      lock: { reason: 'pattern', patterns: ['gpt-5'] },
      exactEntries: [],
    });
  });

  test('unreachable when every offering credential is excluded', () => {
    const names = ['claude-work.json', 'claude-team.json'];
    expect(
      cell({ excludedCredentials: ['claude-work', 'claude-team.json'] }, 'claude-opus', names)
    ).toEqual({ state: 'allowed', unreachable: true, exactEntries: [] });
    expect(cell({ excludedCredentials: ['claude-work'] }, 'claude-opus', names)).toEqual({
      state: 'allowed',
      unreachable: false,
      exactEntries: [],
    });
  });

  test('read-only rows lock every cell and keep the allowed state', () => {
    const p = entry('', 0);
    const all = [p, entry('dup', 1), entry('dup', 2), entry('..', 3)];
    expect(rowReadonlyReason(p, all)).toBe('unnamed');
    expect(rowReadonlyReason(all[1], all)).toBe('duplicate');
    expect(rowReadonlyReason(all[3], all)).toBe('dots');
    expect(rowReadonlyReason(entry('ok', 4), all)).toBeNull();
    for (const why of ['unnamed', 'duplicate', 'dots'] as const) {
      expect(deriveModelCell(lists(), column('gpt-5'), CREDENTIALS, why)).toEqual({
        state: 'locked',
        allowed: true,
        lock: { reason: 'readonly', why },
        exactEntries: [],
      });
    }
  });
});

describe('summaries', () => {
  test('summarizeRow counts allowed catalog ids', () => {
    const catalog = { groups: [], ids: ['claude-opus', 'claude-fable-5', 'gpt-5'] };
    expect(summarizeRow(lists({ excludedModels: ['claude-fable-*'] }), catalog)).toEqual({
      allowed: 2,
      total: 3,
    });
    expect(summarizeRow(lists({ models: ['gpt-*'] }), catalog)).toEqual({ allowed: 1, total: 3 });
  });

  test('countPatterns ignores a lone * allowlist entry', () => {
    expect(countPatterns(lists({ models: ['*', 'x-*'], excludedModels: ['a-*', 'b'] }))).toBe(2);
  });

  test('blockAllPattern finds patterns that match everything', () => {
    expect(blockAllPattern(['a', '**'])).toBe('**');
    expect(blockAllPattern(['a*'])).toBeNull();
  });
});

describe('deriveCredentialCell', () => {
  test('an exact stem entry blocks and is toggleable', () => {
    expect(
      deriveCredentialCell(lists({ excludedCredentials: ['claude-work'] }), WORK, null)
    ).toEqual({
      state: 'blocked',
      exactEntries: ['claude-work'],
    });
  });

  test('a wildcard exclusion locks by pattern', () => {
    expect(
      deriveCredentialCell(lists({ excludedCredentials: ['*work*'] }), WORK, null)
    ).toMatchObject({ state: 'locked', lock: { reason: 'pattern', patterns: ['*work*'] } });
  });

  test('an allowlist miss is locked', () => {
    expect(deriveCredentialCell(lists({ credentials: ['claude-team'] }), WORK, null)).toMatchObject(
      {
        state: 'locked',
        allowed: false,
        lock: { reason: 'allowlist' },
      }
    );
    expect(deriveCredentialCell(lists({ credentials: ['claude-team'] }), TEAM, null).state).toBe(
      'allowed'
    );
  });

  test('writeToken is the file basename, or the id for runtime-only credentials', () => {
    const nested = toPolicyCredential({
      name: '/auths/x/codex-a.json',
      id: 'codex-a',
      type: 'codex',
    });
    expect(nested.writeToken).toBe('codex-a.json');
    expect(WORK.writeToken).toBe('claude-work.json');
    expect(RUNTIME.writeToken).toBe('gemini-rt');
    expect(RUNTIME.identityNames).toContain('Gemini runtime');
  });

  test('display name prefers the email and keeps the file name secondary', () => {
    expect(WORK.displayName).toBe('work@example.com');
    expect(WORK.secondaryName).toBe('claude-work');
    expect(RUNTIME.displayName).toBe('Gemini runtime');
    expect(RUNTIME.secondaryName).toBe('gemini-rt');
  });
});

describe('mergePolicies', () => {
  test('stamped local entries win, others are replaced, revoked ones disappear', () => {
    const fetched = [entry('a', 0, { excludedModels: ['server'] }), entry('b', 1)];
    const local = [
      entry('a', 3, { excludedModels: ['local'] }),
      entry('b', 4, { excludedModels: ['stale'] }),
      entry('gone', 5),
    ];
    const merged = mergePolicies(
      fetched,
      local,
      new Map([
        ['a', 7],
        ['b', 2],
      ]),
      5
    );
    expect(merged.map((item) => item.name)).toEqual(['a', 'b']);
    expect(merged[0].excludedModels).toEqual(['local']);
    expect(merged[0].index).toBe(0);
    expect(merged[1].excludedModels).toEqual([]);
  });
});
