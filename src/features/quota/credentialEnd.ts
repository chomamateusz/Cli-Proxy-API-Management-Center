import type { AuthFileItem } from '@/types';
import {
  formatRelativeInstant,
  parseIsoToMs,
  resolveCodexSubscriptionActiveUntil,
  resolveResetMs,
} from '@/utils/quota';
import { isRecord } from '@/utils/helpers';
import type { QuotaProviderType } from './providers/types';

export interface CredentialEnd {
  endsAtMs: number | null;
  ended: boolean;
}

export function readCredentialEndMs(file: AuthFileItem): number | null {
  return parseIsoToMs(file.fleetEndsAt);
}

export function readCredentialEnd(file: AuthFileItem, nowMs: number): CredentialEnd {
  const endsAtMs = readCredentialEndMs(file);
  if (endsAtMs === null) return { endsAtMs: null, ended: false };
  return { endsAtMs, ended: file.fleetEnded === true || endsAtMs <= nowMs };
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
  delete next.fleet_ends_at;
  delete next.fleet_ended;
  delete next.fleetEndsAt;
  delete next.fleetEnded;
  const endsAtMs = parseIsoToMs(fleetEndsAt);
  if (fleetEndsAt === null || endsAtMs === null) return next;
  return { ...next, fleetEndsAt, fleetEnded: endsAtMs <= nowMs };
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
