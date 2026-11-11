import type { AuthFileItem } from '@/types';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { isDevinFile, isPluginQuotaFile } from './validators';

const QUOTA_IDENTITY_SEPARATOR = '\0';

/**
 * Devin and backend quota providers can expose multiple credential identities
 * from one physical file, distinguished by auth_index.
 */
export function getQuotaCacheKey(file: AuthFileItem): string {
  if (!isDevinFile(file) && !isPluginQuotaFile(file)) return file.name;
  const authIndex = normalizeRecentRequestAuthIndex(file.authIndex);
  return `${file.name}${QUOTA_IDENTITY_SEPARATOR}${authIndex ?? ''}`;
}

/** Disambiguate same-name cards without ever falling back to account (a secret). */
export function getQuotaDisplayName(file: AuthFileItem): string {
  if (!isDevinFile(file) && !isPluginQuotaFile(file)) return file.name;
  const identity = file.email?.trim() || normalizeRecentRequestAuthIndex(file.authIndex);
  return identity ? `${file.name} · ${identity}` : file.name;
}

export interface QuotaAccountLabel {
  name: string;
  /** What a nickname replaced, so the account stays identifiable. */
  detail: string | null;
}

export function getQuotaAccountLabel(file: AuthFileItem): QuotaAccountLabel {
  const fallback = file.email?.trim() || getQuotaDisplayName(file);
  const note = typeof file.note === 'string' ? file.note.trim() : '';
  return note ? { name: note, detail: fallback } : { name: fallback, detail: null };
}

export interface QuotaAccountIdentity {
  label: QuotaAccountLabel;
  laneName: string;
}

/** One login can own several workspaces, so a label shared by several files also names the file. */
export function getQuotaAccountIdentities(files: readonly AuthFileItem[]): QuotaAccountIdentity[] {
  const labels = files.map(getQuotaAccountLabel);
  const counts = new Map<string, number>();
  labels.forEach(({ name }) => counts.set(name, (counts.get(name) ?? 0) + 1));
  return labels.map((label, index) => {
    if ((counts.get(label.name) ?? 0) < 2) return { label, laneName: label.name };
    const fileName = getQuotaDisplayName(files[index]);
    return { label: { name: label.name, detail: fileName }, laneName: fileName };
  });
}

/** Resolve a cache identity back to the physical filename used by file mutations. */
export function getQuotaCacheFileName(key: string): string {
  const separatorIndex = key.indexOf(QUOTA_IDENTITY_SEPARATOR);
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}
