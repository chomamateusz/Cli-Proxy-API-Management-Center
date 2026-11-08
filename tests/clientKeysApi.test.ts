import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { clientKeysApi } from '../src/services/api/clientKeys';

const restores: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  restores.splice(0).forEach((spy) => spy.mockRestore());
});

const ISSUED = {
  name: 'mac-pro-m1',
  'issued-by': 'management',
  'created-at': '2026-10-31T14:02:00.123456789Z',
  'expires-at': '',
  models: ['*', 3, null],
  'excluded-models': ['claude-fable-*'],
};

const POLICY = {
  index: 2,
  name: 'mac-pro-m1',
  has_policy: true,
  'issued-by': 'management',
  'expires-at': '2027-10-31T14:02:00Z',
  models: ['*'],
  'excluded-models': [' Claude-Fable-* ', {}],
  credentials: 'not-a-list',
  'excluded-credentials': ['claude-team.json'],
};

describe('clientKeysApi', () => {
  test('listIssued normalizes kebab-case and drops invalid entries', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue([ISSUED, { name: '' }, 'junk']);
    restores.push(get);
    const keys = await clientKeysApi.listIssued();
    expect(get).toHaveBeenCalledWith('/issued-keys');
    expect(keys).toEqual([
      {
        name: 'mac-pro-m1',
        issuedBy: 'management',
        createdAt: '2026-10-31T14:02:00.123456789Z',
        createdAtMs: Date.parse('2026-10-31T14:02:00.123Z'),
        expiresAt: '',
        expiresAtMs: null,
        models: ['*'],
        excludedModels: ['claude-fable-*'],
      },
    ]);
    expect(Object.keys(keys[0])).not.toContain('key');
  });

  test('listIssued treats a non-array response as empty', async () => {
    restores.push(spyOn(apiClient, 'get').mockResolvedValue({ error: 'x' }));
    expect(await clientKeysApi.listIssued()).toEqual([]);
  });

  test('listPolicies keeps raw strings and drops non-strings', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue([POLICY, { index: -1 }, { index: 1.5 }]);
    restores.push(get);
    const policies = await clientKeysApi.listPolicies();
    expect(get).toHaveBeenCalledWith('/client-key-policies');
    expect(policies).toEqual([
      {
        index: 2,
        name: 'mac-pro-m1',
        issuedBy: 'management',
        expiresAt: '2027-10-31T14:02:00Z',
        expiresAtMs: Date.parse('2027-10-31T14:02:00Z'),
        hasPolicy: true,
        models: ['*'],
        excludedModels: [' Claude-Fable-* '],
        credentials: [],
        excludedCredentials: ['claude-team.json'],
      },
    ]);
  });

  test('issue posts the body and returns the secret separately', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({ ...ISSUED, key: 'sk-fleet-test' });
    restores.push(post);
    const result = await clientKeysApi.issue({ name: 'mac-pro-m1', ttl: '3600s', models: ['*'] });
    expect(post).toHaveBeenCalledWith('/issued-keys', {
      name: 'mac-pro-m1',
      models: ['*'],
      ttl: '3600s',
    });
    expect(result.secret).toBe('sk-fleet-test');
    expect(Object.keys(result.key)).not.toContain('key');
    expect(result.key.name).toBe('mac-pro-m1');
  });

  test('issue throws when the key is missing', async () => {
    restores.push(spyOn(apiClient, 'post').mockResolvedValue({ ...ISSUED }));
    await expect(clientKeysApi.issue({ name: 'a', ttl: null, models: ['*'] })).rejects.toThrow(
      'missing key'
    );
    restores.splice(0).forEach((spy) => spy.mockRestore());
    restores.push(spyOn(apiClient, 'post').mockResolvedValue({ ...ISSUED, key: 42 }));
    await expect(clientKeysApi.issue({ name: 'a', ttl: null, models: ['*'] })).rejects.toThrow(
      'missing key'
    );
  });

  test('revoke deletes by encoded name and returns the count', async () => {
    const del = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok', revoked: 1 });
    restores.push(del);
    expect(await clientKeysApi.revoke('a.b-c')).toBe(1);
    expect(del).toHaveBeenCalledWith('/issued-keys/a.b-c');
  });

  test('patchPolicy sends the serialized patch and normalizes the entry', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok', ...POLICY });
    restores.push(patch);
    const name = 'odd name/with#chars';
    const result = await clientKeysApi.patchPolicy(name, {
      add: { excludedModels: ['gpt-5'] },
      remove: { excludedCredentials: [' Raw '] },
    });
    expect(patch).toHaveBeenCalledWith('/client-key-policies/' + encodeURIComponent(name), {
      add: { 'excluded-models': ['gpt-5'] },
      remove: { 'excluded-credentials': [' Raw '] },
    });
    expect(result.index).toBe(2);
    expect(result.excludedModels).toEqual([' Claude-Fable-* ']);
  });

  test('patchPolicy never sends an empty patch', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({});
    restores.push(patch);
    await expect(clientKeysApi.patchPolicy('a', { add: { models: [] } })).rejects.toThrow(
      RangeError
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
