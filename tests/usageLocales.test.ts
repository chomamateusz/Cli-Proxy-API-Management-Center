import { describe, expect, test } from 'bun:test';

const LOCALES = ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'] as const;
const SHARED_TERMS = new Set(['OK', 'Model', 'Stream']);

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

const isUsageLeaf = (key: string) =>
  key.startsWith('usage.') || key === 'nav.usage' || key === 'nav_meta.usage';

const load = async (locale: string) =>
  flattenLeaves(await Bun.file(`src/i18n/locales/${locale}.json`).json());

const usedKeys = async () => {
  const glob = new Bun.Glob('src/features/usage/**/*.tsx');
  const keys = new Set<string>();
  for await (const path of glob.scan('.')) {
    const source = await Bun.file(path).text();
    for (const match of source.matchAll(/t\(\s*'(usage\.[a-z0-9_.]+)'/g)) keys.add(match[1]);
  }
  return keys;
};

describe('usage locales', () => {
  test('English defines every literal usage key the feature reads', async () => {
    const english = await load('en');
    const missing = [...(await usedKeys())].filter((key) => !(key in english));
    expect(missing).toEqual([]);
  });

  test.each(LOCALES)(
    '%s has every usage leaf with the same interpolation tokens',
    async (locale) => {
      const english = await load('en');
      const translated = await load(locale);
      const keys = Object.keys(english).filter(isUsageLeaf);
      expect(keys.length).toBeGreaterThan(50);
      expect(keys.filter((key) => !translated[key]?.trim())).toEqual([]);
      expect(keys.filter((key) => tokens(english[key]) !== tokens(translated[key] ?? ''))).toEqual(
        []
      );
    }
  );

  test.each(LOCALES)('%s translates usage sentences instead of copying English', async (locale) => {
    const english = await load('en');
    const translated = await load(locale);
    const copies = Object.keys(english)
      .filter(isUsageLeaf)
      .filter((key) => /[A-Za-z]{3,}/.test(english[key].replace(/\{\{[^}]+\}\}/g, '')))
      .filter((key) => !SHARED_TERMS.has(english[key]))
      .filter((key) => translated[key] === english[key]);
    expect(copies).toEqual([]);
  });
});
