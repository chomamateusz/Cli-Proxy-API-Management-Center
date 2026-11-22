import type { AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota/resetInstants';

export interface ResetGrantStatusSample {
  authIndex: string;
  sampledAtMs: number;
  status: AnthropicResetGrantStatus;
}

interface ResetGrantSupply {
  resetsLeft: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  paused?: boolean;
}

export const resetGrantTimeMs = (value: string | null | undefined): number | null => {
  const text = value?.trim();
  const withoutZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  return parseIsoToMs(text && withoutZone.test(text) ? `${text}Z` : text);
};

export const usableResetCount = (grant: ResetGrantSupply, nowMs: number): number => {
  const left = grant.resetsLeft ?? 0;
  return left > 0 &&
    !grant.paused &&
    (resetGrantTimeMs(grant.startsAt) ?? -Infinity) <= nowMs &&
    (resetGrantTimeMs(grant.endsAt) ?? Infinity) > nowMs
    ? left
    : 0;
};
