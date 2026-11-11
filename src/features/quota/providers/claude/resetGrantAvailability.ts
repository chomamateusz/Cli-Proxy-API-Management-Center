import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';

export type ResetGrantBlock =
  | NonNullable<ReturnType<typeof anthropicResetGrantBlocker>>
  | 'not_started'
  | 'grant_expired'
  | 'cooldown';

export function resetGrantBlock(
  status: AnthropicResetGrantStatus,
  grantId: string,
  now: number
): ResetGrantBlock | null {
  const blocker = anthropicResetGrantBlocker(status, grantId);
  if (blocker) return blocker;
  const grant = status.grants.find((item) => item.id === grantId);
  if (grant?.startsAt && Date.parse(grant.startsAt) > now) return 'not_started';
  if (grant?.endsAt && Date.parse(grant.endsAt) <= now) return 'grant_expired';
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return 'cooldown';
  return null;
}

export type ResetGrantLock = 'busy' | 'unavailable';
export type ResetGrantActionBlock =
  ResetGrantBlock | ResetGrantLock | 'other_pending' | 'retry_expired';

export interface ResetGrantPending {
  grantId: string;
  label: string;
  expired: boolean;
}

export interface ResetGrantLine {
  id: string;
  label: string;
  resetsLeft: number | null;
  resetsTotal: number | null;
  endsAt: string | null;
  retry: boolean;
  block: ResetGrantActionBlock | null;
}

/** A pending claim stays listed after upstream drops its grant, so Retry stays reachable. */
export function planResetGrantLines(
  status: AnthropicResetGrantStatus | null,
  pending: ResetGrantPending | undefined,
  now: number,
  lock: ResetGrantLock | null,
  fallbackLabel: (index: number) => string
): ResetGrantLine[] {
  const action = (id: string): Pick<ResetGrantLine, 'retry' | 'block'> => {
    if (pending) {
      return id === pending.grantId
        ? { retry: true, block: pending.expired ? 'retry_expired' : lock }
        : { retry: false, block: 'other_pending' };
    }
    return {
      retry: false,
      block: lock ?? (status ? resetGrantBlock(status, id, now) : 'unknown_grant'),
    };
  };
  const lines: ResetGrantLine[] = (status?.grants ?? [])
    .filter((grant) => grant.resetsLeft > 0 || grant.id === pending?.grantId)
    .map((grant) => ({
      id: grant.id,
      label: grant.label,
      resetsLeft: grant.resetsLeft,
      resetsTotal: grant.resetsTotal,
      endsAt: grant.endsAt,
      ...action(grant.id),
    }));
  if (pending && !lines.some((line) => line.id === pending.grantId)) {
    lines.push({
      id: pending.grantId,
      label: pending.label,
      resetsLeft: null,
      resetsTotal: null,
      endsAt: null,
      ...action(pending.grantId),
    });
  }
  return lines
    .sort((a, b) => (parseIsoToMs(a.endsAt) ?? Infinity) - (parseIsoToMs(b.endsAt) ?? Infinity))
    .map((line, index) => ({ ...line, label: line.label || fallbackLabel(index + 1) }));
}
