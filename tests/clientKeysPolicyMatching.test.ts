import { describe, expect, test } from 'bun:test';
import {
  allowsCredential,
  allowsModel,
  countModelMatches,
  isUnrestrictedAllowlist,
  modelBaseName,
  wildcardMatch,
} from '../src/features/clientKeys/policyMatching';
import type { PolicyLists } from '../src/types/clientKeys';

const policy = (lists: Partial<PolicyLists> = {}): PolicyLists => ({
  models: [],
  excludedModels: [],
  credentials: [],
  excludedCredentials: [],
  ...lists,
});

describe('allowsModel mirrors TestKeyPolicyAllowsModel', () => {
  const cases: Array<[string, Partial<PolicyLists>, string, boolean]> = [
    ['empty', {}, 'anything', true],
    ['allow wildcard', { models: ['claude-*', 'gpt-5*'] }, 'gpt-5.4', true],
    ['allow miss', { models: ['claude-*'] }, 'gpt-5', false],
    ['deny wildcard', { excludedModels: ['claude-fable-*'] }, 'claude-fable-5', false],
    ['deny wins', { models: ['claude-*'], excludedModels: ['*-fable-*'] }, 'claude-fable-5', false],
    ['case insensitive', { models: ['CLAUDE-*'] }, 'Claude-Opus', true],
    ['deny case insensitive', { excludedModels: ['CLAUDE-*'] }, 'Claude-Opus', false],
    ['middle wildcard', { models: ['cl*de-*us'] }, 'claude-opus', true],
    ['empty wildcard', { models: ['gpt*5'] }, 'gpt5', true],
    ['literal question mark', { models: ['gpt-?'] }, 'gpt-5', false],
    ['literal brackets', { models: ['[ab]'] }, 'a', false],
    ['suffix exact allow', { models: ['gpt-5'] }, 'gpt-5(high)', true],
    ['suffix exact deny', { excludedModels: ['gpt-5'] }, 'gpt-5(high)', false],
    ['suffixed exact allow', { models: ['gpt-5(high)'] }, 'gpt-5(high)', true],
    ['suffixed exact deny', { excludedModels: ['gpt-5(high)'] }, 'gpt-5(high)', false],
    ['suffixed wildcard deny', { excludedModels: ['*(high)'] }, 'gpt-5(high)', false],
    ['suffixed wildcard permits plain', { excludedModels: ['*(high)'] }, 'gpt-5', true],
    ['unrelated namespace does not widen allow', { models: ['gpt-5'] }, 'custom/gpt-5', false],
    [
      'unrelated namespace does not match exclusion',
      { excludedModels: ['gpt-5'] },
      'custom/gpt-5',
      true,
    ],
  ];

  test('ports all 19 backend cases', () => {
    expect(cases).toHaveLength(19);
  });

  test.each(cases)('%s', (_name, lists, model, want) => {
    expect(allowsModel(policy(lists), model)).toBe(want);
  });
});

describe('allowsCredential mirrors TestKeyPolicyAllowsCredential', () => {
  const cred = (file: string, id: string, label: string) =>
    file === ''
      ? { name: id, id, label, runtimeOnly: true }
      : { name: file, id, label, runtimeOnly: false };

  const cases: Array<[string, Partial<PolicyLists>, string, string, string, boolean]> = [
    ['empty', {}, '', 'api-id', '', true],
    ['basename', { credentials: ['claude-work.json'] }, '/auths/claude-work.json', 'id', '', true],
    [
      'without extension',
      { credentials: ['claude-work'] },
      '/auths/claude-work.JSON',
      'id',
      '',
      true,
    ],
    ['id', { credentials: ['credential-id'] }, '/auths/other.json', 'credential-id', '', true],
    [
      'wildcard case',
      { credentials: ['CLAUDE-*.JSON'] },
      '/auths/claude-work.json',
      'id',
      '',
      true,
    ],
    [
      'deny wins',
      { credentials: ['claude-*'], excludedCredentials: ['*work*'] },
      '/auths/claude-work.json',
      'id',
      '',
      false,
    ],
    [
      'deny other identity',
      { credentials: ['id'], excludedCredentials: ['claude-work'] },
      '/auths/claude-work.json',
      'id',
      '',
      false,
    ],
    ['synthesized id', { credentials: ['api-*'] }, '', 'api-id', 'label', true],
    ['synthesized label', { credentials: ['work'] }, '', 'api-id', 'WORK', true],
    ['file ignores label', { credentials: ['work'] }, 'other.json', 'id', 'work', false],
    ['path not matched', { credentials: ['/auths/*'] }, '/auths/work.json', 'id', '', false],
    ['home id stem denied', { excludedCredentials: ['work'] }, '', 'work.json', 'unrelated', false],
  ];

  test('ports all 12 backend cases', () => {
    expect(cases).toHaveLength(12);
  });

  test.each(cases)('%s', (_name, lists, file, id, label, want) => {
    expect(allowsCredential(policy(lists), cred(file, id, label))).toBe(want);
  });

  test('a runtime-only credential with its own file name still matches by file', () => {
    const credential = { name: 'runtime.json', id: 'rt-1', label: 'work', runtimeOnly: true };
    expect(allowsCredential(policy({ credentials: ['runtime'] }), credential)).toBe(true);
    expect(allowsCredential(policy({ credentials: ['work'] }), credential)).toBe(false);
  });
});

describe('wildcardMatch edge cases', () => {
  test.each([
    ['', '', true],
    ['*', '', true],
    ['a**b', 'ab', true],
    [' a', 'a', false],
    ['ÄBC-*', 'äbc-1', true],
    ['ŻÓŁW', 'żółw', true],
    ['a*', 'b', false],
  ] as const)('%p vs %p', (pattern, value, want) => {
    expect(wildcardMatch(pattern, value)).toBe(want);
  });
});

describe('modelBaseName', () => {
  test.each([
    ['gpt-5(high)', 'gpt-5'],
    ['gpt-5(high', 'gpt-5(high'],
    ['x()', 'x'],
    ['plain', 'plain'],
  ])('%p -> %p', (model, base) => {
    expect(modelBaseName(model)).toBe(base);
  });
});

describe('isUnrestrictedAllowlist', () => {
  test.each([
    [[], true],
    [['*'], true],
    [['claude-*'], false],
    [['*', 'x'], true],
  ] as const)('%p', (models, want) => {
    expect(isUnrestrictedAllowlist(models)).toBe(want);
  });
});

describe('countModelMatches', () => {
  test('counts a suffixed catalog id through its base name, like allowsModel', () => {
    const ids = ['gpt-5', 'gpt-5(high)', 'gpt-5-mini', 'claude-opus'];
    expect(countModelMatches(ids, 'gpt-5')).toBe(2);
    expect(ids.filter((id) => allowsModel(policy({ models: ['gpt-5'] }), id))).toHaveLength(2);
    expect(countModelMatches(ids, 'gpt-*')).toBe(3);
    expect(countModelMatches(ids, 'zzz')).toBe(0);
  });
});
