import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildQuotaCardGroups,
  defaultSeparateProviders,
  presentProviders,
  toggleSeparateProvider,
} from '@/features/quota/quotaGroups';
import {
  readPersistedQuotaGroups,
  readQuotaUiState,
  writePersistedQuotaGroups,
  writeQuotaUiState,
} from '@/features/quota/uiState';
import { QUOTA_SORT_MODES } from '@/features/quota/constants';
import type { QuotaProviderType } from '@/features/quota/providers/types';

const originalWindow = (globalThis as { window?: unknown }).window;

function installStorage() {
  const backing = () => {
    const store = new Map<string, string>();
    return {
      store,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  };
  const local = backing();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: local,
    sessionStorage: backing(),
  };
  return local;
}

let local: ReturnType<typeof installStorage>;

beforeEach(() => {
  local = installStorage();
});

afterAll(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

const entries = (...types: QuotaProviderType[]) =>
  types.map((type, index) => ({ type, name: `${type}-${index}` }));

describe('group selection', () => {
  test('by default a provider with two or more accounts gets its own group', () => {
    expect(defaultSeparateProviders(entries('xai', 'codex', 'claude', 'codex', 'claude'))).toEqual([
      'claude',
      'codex',
    ]);
    expect(defaultSeparateProviders(entries('claude', 'xai'))).toEqual([]);
  });

  test('chips list the providers present, in tab order', () => {
    expect(presentProviders(entries('xai', 'kimi', 'claude'))).toEqual(['claude', 'xai', 'kimi']);
  });

  test('toggling keeps tab order', () => {
    expect(toggleSeparateProvider(['codex'], 'claude')).toEqual(['claude', 'codex']);
    expect(toggleSeparateProvider(['claude', 'codex'], 'claude')).toEqual(['codex']);
  });

  test('the choice persists in localStorage and is validated on read', () => {
    expect(readPersistedQuotaGroups()).toBeNull();
    writePersistedQuotaGroups(['codex', 'claude']);
    expect(readPersistedQuotaGroups()).toEqual(['claude', 'codex']);
    writePersistedQuotaGroups([]);
    expect(readPersistedQuotaGroups()).toEqual([]);
    local.store.set('quotaPage.groups', JSON.stringify(['claude', 'nope', 7]));
    expect(readPersistedQuotaGroups()).toEqual(['claude']);
    local.store.set('quotaPage.groups', '{"claude":true}');
    expect(readPersistedQuotaGroups()).toBeNull();
    local.store.set('quotaPage.groups', 'not json');
    expect(readPersistedQuotaGroups()).toBeNull();
  });

  test('router order is the first sort mode and the model family is session state', () => {
    expect(QUOTA_SORT_MODES[0]).toBe('router');
    writeQuotaUiState({ routerFamily: 'fable' });
    expect(readQuotaUiState()?.routerFamily).toBe('fable');
    writeQuotaUiState({ routerFamily: 'opus' as never });
    expect(readQuotaUiState()?.routerFamily).toBeUndefined();
  });
});

describe('group rows', () => {
  const list = entries('claude', 'claude', 'codex', 'codex', 'xai', 'kimi');

  test('separate providers in tab order, then All others', () => {
    const groups = buildQuotaCardGroups(list, ['codex', 'claude'], 'all');
    expect(groups.map((group) => [group.id, group.kind, group.entries.length])).toEqual([
      ['claude', 'provider', 2],
      ['codex', 'provider', 2],
      ['others', 'others', 2],
    ]);
  });

  test('an empty All others is not rendered', () => {
    const groups = buildQuotaCardGroups(entries('claude', 'codex'), ['claude', 'codex'], 'all');
    expect(groups.map((group) => group.id)).toEqual(['claude', 'codex']);
  });

  test('with no provider toggled there is one group named All accounts', () => {
    const groups = buildQuotaCardGroups(list, [], 'all');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'all', kind: 'all', type: null });
    expect(groups[0].entries).toHaveLength(list.length);
  });

  test('a provider tab shows a single group', () => {
    const codex = list.filter((entry) => entry.type === 'codex');
    const groups = buildQuotaCardGroups(codex, [], 'codex');
    expect(groups.map((group) => [group.id, group.kind, group.type])).toEqual([
      ['codex', 'provider', 'codex'],
    ]);
  });
});
