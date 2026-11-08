import { describe, expect, test } from 'bun:test';

const LOCALES = ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'] as const;

const flattenLeaves = (value: unknown, prefix = ''): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? { [prefix]: String(value ?? '') } : {};
  }
  return Object.entries(value).reduce<Record<string, string>>((leaves, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return { ...leaves, ...flattenLeaves(child, path) };
  }, {});
};

const tokens = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

const isClientKeysLeaf = (key: string) =>
  key.startsWith('client_keys.') || key === 'nav.client_keys' || key === 'nav_meta.client_keys';

const load = async (locale: string) =>
  flattenLeaves(await Bun.file(`src/i18n/locales/${locale}.json`).json());

describe('client keys locales', () => {
  test('English defines the client keys namespace without plural suffixes', async () => {
    const english = Object.keys(await load('en')).filter(isClientKeysLeaf);
    expect(english.length).toBeGreaterThan(150);
    expect(english.filter((key) => /_(zero|one|two|few|many|other)$/.test(key))).toEqual([]);
  });

  test.each(LOCALES)('%s has every leaf with the same interpolation tokens', async (locale) => {
    const english = await load('en');
    const translated = await load(locale);
    const keys = Object.keys(english).filter(isClientKeysLeaf);
    expect(keys.filter((key) => !(key in translated))).toEqual([]);
    expect(keys.filter((key) => tokens(english[key]) !== tokens(translated[key] ?? ''))).toEqual(
      []
    );
    expect(keys.filter((key) => !translated[key]?.trim())).toEqual([]);
  });

  test.each(LOCALES)('%s translates every sentence instead of copying English', async (locale) => {
    const english = await load('en');
    const translated = await load(locale);
    const copies = Object.keys(english)
      .filter(isClientKeysLeaf)
      .filter((key) => /[A-Za-z]{3,}/.test(english[key].replace(/\{\{[^}]+\}\}/g, '')))
      .filter((key) => translated[key] === english[key]);
    expect(copies).toEqual([]);
  });
});
