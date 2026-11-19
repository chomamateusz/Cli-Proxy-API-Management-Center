import { QUOTA_TAB_ORDER, type QuotaTabId } from './constants';
import type { QuotaProviderType } from './providers/types';

export type QuotaGroupKind = 'provider' | 'others' | 'all';

export interface QuotaCardGroup<T extends { type: QuotaProviderType }> {
  id: string;
  kind: QuotaGroupKind;
  type: QuotaProviderType | null;
  entries: T[];
}

export function presentProviders(entries: readonly { type: QuotaProviderType }[]) {
  return QUOTA_TAB_ORDER.filter((type) => entries.some((entry) => entry.type === type));
}

export function defaultSeparateProviders(
  entries: readonly { type: QuotaProviderType }[]
): QuotaProviderType[] {
  return QUOTA_TAB_ORDER.filter(
    (type) => entries.filter((entry) => entry.type === type).length >= 2
  );
}

export function toggleSeparateProvider(
  separate: readonly QuotaProviderType[],
  type: QuotaProviderType
): QuotaProviderType[] {
  const next = separate.includes(type)
    ? separate.filter((item) => item !== type)
    : [...separate, type];
  return QUOTA_TAB_ORDER.filter((item) => next.includes(item));
}

export function buildQuotaCardGroups<T extends { type: QuotaProviderType }>(
  entries: readonly T[],
  separate: readonly QuotaProviderType[],
  tab: QuotaTabId
): QuotaCardGroup<T>[] {
  if (tab !== 'all') {
    return entries.length === 0
      ? []
      : [{ id: tab, kind: 'provider', type: tab, entries: [...entries] }];
  }
  const groups: QuotaCardGroup<T>[] = QUOTA_TAB_ORDER.filter((type) =>
    separate.includes(type)
  ).flatMap((type) => {
    const own = entries.filter((entry) => entry.type === type);
    return own.length > 0 ? [{ id: type, kind: 'provider' as const, type, entries: own }] : [];
  });
  const rest = entries.filter((entry) => !separate.includes(entry.type));
  if (rest.length > 0) {
    groups.push({
      id: groups.length === 0 ? 'all' : 'others',
      kind: groups.length === 0 ? 'all' : 'others',
      type: null,
      entries: rest,
    });
  }
  return groups;
}
