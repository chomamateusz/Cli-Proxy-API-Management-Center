import type {
  AuthFileItem,
  CredentialEndSource,
  CredentialEndState,
  CredentialEndWarning,
} from '@/types';
import {
  credentialEndStateAt,
  formatRelativeInstant,
  parseIsoToMs,
  resolveCodexSubscriptionActiveUntil,
  resolveResetMs,
} from '@/utils/quota';
import { isRecord } from '@/utils/helpers';
import type { QuotaProviderType } from './providers/types';

export interface CredentialEnd {
  endsAtMs: number | null;
  state: CredentialEndState;
  ended: boolean;
  source: CredentialEndSource | null;
  warnings: CredentialEndWarning[];
}

export function readCredentialEndMs(file: AuthFileItem): number | null {
  return parseIsoToMs(file.fleetEndsAt);
}

export function readCredentialEndState(file: AuthFileItem, nowMs: number): CredentialEndState {
  return credentialEndStateAt(
    {
      endsAtMs: readCredentialEndMs(file),
      reportedState: file.fleetEndState,
      reportedEnded: file.fleetEnded,
      source: file.fleetEndsAtSource,
    },
    nowMs
  );
}

export function readCredentialEnd(file: AuthFileItem, nowMs: number): CredentialEnd {
  const endsAtMs = readCredentialEndMs(file);
  const state = readCredentialEndState(file, nowMs);
  return {
    endsAtMs,
    state,
    ended: state === 'ended',
    source: endsAtMs === null ? null : (file.fleetEndsAtSource ?? null),
    warnings: file.fleetEndWarnings ?? [],
  };
}

export const CREDENTIAL_END_FIELDS = [
  'fleet_ends_at',
  'fleet_ended',
  'fleet_end_state',
  'fleet_ends_at_source',
  'fleet_cancelled_at',
  'fleetEndsAt',
  'fleetEnded',
  'fleetEndState',
  'fleetEndsAtSource',
  'fleetCancelledAt',
] as const;

export function canMarkCancelled(type: QuotaProviderType, file: AuthFileItem): boolean {
  return type === 'claude' && file.fleetEndState !== undefined;
}

export function withoutEndedCredentials<T extends { file: AuthFileItem }>(
  entries: readonly T[],
  nowMs: number
): T[] {
  return entries.filter((entry) => !readCredentialEnd(entry.file, nowMs).ended);
}

export function withCredentialEnd(
  file: AuthFileItem,
  fleetEndsAt: string | null,
  nowMs: number
): AuthFileItem {
  const next: AuthFileItem = { ...file };
  for (const field of CREDENTIAL_END_FIELDS) delete next[field];
  const endsAtMs = parseIsoToMs(fleetEndsAt);
  if (fleetEndsAt === null || endsAtMs === null) {
    const warnings = (file.fleetEndWarnings ?? []).filter(
      (warning) => warning.code !== 'provider_renews'
    );
    delete next.fleetEndWarnings;
    return warnings.length > 0 ? { ...next, fleetEndWarnings: warnings } : next;
  }
  return {
    ...next,
    fleetEndsAt,
    fleetEnded: false,
    fleetEndState: endsAtMs > nowMs ? 'scheduled' : 'overdue',
    fleetEndsAtSource: 'manual',
  };
}

export interface ResetExpiry {
  count: number;
  expiresAtMs: number | null;
}

/** An expiry the provider leaves open never lapses on its own, so it outlives any end. */
export function countResetsOutlivingEnd(
  endsAtMs: number | null,
  resets: readonly ResetExpiry[],
  nowMs: number
): number {
  if (endsAtMs === null) return 0;
  const lostAfterMs = Math.max(endsAtMs, nowMs);
  return resets
    .filter((reset) => reset.expiresAtMs === null || reset.expiresAtMs > lostAfterMs)
    .reduce((sum, reset) => sum + Math.max(0, reset.count), 0);
}

export function codexResetExpiries(quota: unknown): ResetExpiry[] {
  if (!isRecord(quota) || quota.status !== 'success') return [];
  const credits = quota.rateLimitResetCredits;
  if (!Array.isArray(credits)) return [];
  return credits.flatMap((credit): ResetExpiry[] => {
    if (!isRecord(credit) || credit.status !== 'available') return [];
    const expiresAtMs = parseIsoToMs(credit.expiresAt);
    return expiresAtMs === null ? [] : [{ count: 1, expiresAtMs }];
  });
}

export function claudeResetExpiries(
  lines: readonly { resetsLeft: number | null; endsAt: string | null }[]
): ResetExpiry[] {
  return lines.flatMap((line) =>
    line.resetsLeft === null || line.resetsLeft <= 0
      ? []
      : [{ count: line.resetsLeft, expiresAtMs: parseIsoToMs(line.endsAt) }]
  );
}

export function unusedResetsAtEnd(
  end: Pick<CredentialEnd, 'endsAtMs' | 'state'>,
  resets: readonly ResetExpiry[],
  nowMs: number
): number {
  if (end.state !== 'scheduled' && end.state !== 'overdue') return 0;
  return countResetsOutlivingEnd(end.endsAtMs, resets, nowMs);
}

export function paidUntilMsFor(
  type: QuotaProviderType,
  quota: unknown,
  file: AuthFileItem
): number | null {
  if (type !== 'codex') return null;
  const loaded =
    isRecord(quota) && quota.status === 'success'
      ? resolveResetMs([quota.subscriptionActiveUntil])
      : null;
  return loaded ?? resolveResetMs([resolveCodexSubscriptionActiveUntil(file)]);
}

export function toUtcSeconds(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function localInputToMs(value: string): number | null {
  const match = LOCAL_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const roundTrips =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;
  return roundTrips ? date.getTime() : null;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function msToLocalInput(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function formatEndAbsolute(ms: number, locale?: string): string {
  try {
    return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export interface CredentialEndDisplay {
  absolute: string;
  relative: string;
  ended: boolean;
}

export function buildCredentialEndDisplay(
  endsAtMs: number,
  ended: boolean,
  nowMs: number,
  locale?: string
): CredentialEndDisplay {
  return {
    absolute: formatEndAbsolute(endsAtMs, locale),
    relative: formatRelativeInstant(endsAtMs, nowMs, locale),
    ended,
  };
}

export function unusedResetsForCredential(
  type: QuotaProviderType,
  end: Pick<CredentialEnd, 'endsAtMs' | 'state'>,
  quota: unknown,
  claudeLines: readonly { resetsLeft: number | null; endsAt: string | null }[],
  nowMs: number
): number {
  if (type === 'claude') return unusedResetsAtEnd(end, claudeResetExpiries(claudeLines), nowMs);
  if (type === 'codex') return unusedResetsAtEnd(end, codexResetExpiries(quota), nowMs);
  return 0;
}
