import { describe, expect, test } from 'bun:test';
import { planCredentialToggle, planModelToggle } from '../src/features/clientKeys/matrix';
import { buildIssueBody, serializePolicyPatch } from '../src/services/api/clientKeys';
import type { PolicyCredential } from '../src/types/clientKeys';

const credential = { writeToken: 'claude-work.json' } as PolicyCredential;

describe('planModelToggle', () => {
  test('allowed adds an exclusion and never touches models', () => {
    const patch = planModelToggle(
      { state: 'allowed', unreachable: false, exactEntries: [] },
      'gpt-5'
    );
    expect(patch).toEqual({ add: { excludedModels: ['gpt-5'] } });
    expect(JSON.stringify(patch)).not.toContain('"models"');
  });

  test('blocked removes every raw exact entry', () => {
    expect(
      planModelToggle({ state: 'blocked', exactEntries: ['GPT-5', 'gpt-5'] }, 'gpt-5')
    ).toEqual({
      remove: { excludedModels: ['GPT-5', 'gpt-5'] },
    });
  });

  test('locked cells give no patch', () => {
    for (const lock of [
      { reason: 'pattern' as const, patterns: ['gpt-*'] },
      { reason: 'allowlist' as const },
      { reason: 'readonly' as const, why: 'unnamed' as const },
    ]) {
      expect(
        planModelToggle({ state: 'locked', allowed: false, lock, exactEntries: ['gpt-5'] }, 'gpt-5')
      ).toBeNull();
    }
  });
});

describe('planCredentialToggle', () => {
  test('allowed excludes the write token', () => {
    expect(planCredentialToggle({ state: 'allowed', exactEntries: [] }, credential)).toEqual({
      add: { excludedCredentials: ['claude-work.json'] },
    });
  });

  test('blocked removes the exact entries', () => {
    expect(
      planCredentialToggle({ state: 'blocked', exactEntries: ['claude-work'] }, credential)
    ).toEqual({ remove: { excludedCredentials: ['claude-work'] } });
  });

  test('locked gives null', () => {
    expect(
      planCredentialToggle(
        { state: 'locked', allowed: true, lock: { reason: 'allowlist' }, exactEntries: [] },
        credential
      )
    ).toBeNull();
  });
});

describe('serializePolicyPatch', () => {
  test('maps camelCase fields to the backend names', () => {
    expect(
      serializePolicyPatch({
        add: { models: ['a'], excludedModels: ['b'] },
        remove: { credentials: ['c'], excludedCredentials: ['d'] },
      })
    ).toEqual({
      add: { models: ['a'], 'excluded-models': ['b'] },
      remove: { credentials: ['c'], 'excluded-credentials': ['d'] },
    });
  });

  test('omits empty lists and empty sides', () => {
    expect(
      serializePolicyPatch({ add: { models: [], excludedModels: ['x'] }, remove: {} })
    ).toEqual({
      add: { 'excluded-models': ['x'] },
    });
  });

  test('returns null for a no-op patch', () => {
    expect(serializePolicyPatch({})).toBeNull();
    expect(
      serializePolicyPatch({ add: { models: [] }, remove: { excludedModels: [] } })
    ).toBeNull();
  });

  test('rejects the same value in add and remove', () => {
    expect(() =>
      serializePolicyPatch({ add: { excludedModels: ['x'] }, remove: { excludedModels: ['x'] } })
    ).toThrow(RangeError);
  });

  test('keeps raw values untouched', () => {
    expect(serializePolicyPatch({ remove: { excludedModels: [' X '] } })).toEqual({
      remove: { 'excluded-models': [' X '] },
    });
  });
});

describe('buildIssueBody', () => {
  test('includes ttl only when set', () => {
    expect(buildIssueBody({ name: 'a', ttl: '3600s', models: ['*'] })).toEqual({
      name: 'a',
      models: ['*'],
      ttl: '3600s',
    });
    expect(buildIssueBody({ name: 'a', ttl: null, models: ['claude-*'] })).toEqual({
      name: 'a',
      models: ['claude-*'],
    });
  });
});
