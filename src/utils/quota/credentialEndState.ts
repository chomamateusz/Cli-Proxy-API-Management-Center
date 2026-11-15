import type {
  CredentialEndSource,
  CredentialEndState,
  ReportedCredentialEnd,
} from '@/types/authFile';

const PROVIDER_CONFIRMED_SOURCES: ReadonlySet<CredentialEndSource> = new Set([
  'codex-api',
  'plan-ended',
]);

/**
 * The list state goes stale as the clock passes the end; this replays the backend rule with
 * the information the list carries. A backend without `fleet_end_state` ends at the date.
 */
export function credentialEndStateAt(
  { endsAtMs, reportedState, reportedEnded, source }: ReportedCredentialEnd,
  nowMs: number
): CredentialEndState {
  if (endsAtMs === null) return 'none';
  if (reportedEnded === true || reportedState === 'ended') return 'ended';
  if (endsAtMs > nowMs) return 'scheduled';
  if (reportedState === undefined) return 'ended';
  if (source !== undefined && PROVIDER_CONFIRMED_SOURCES.has(source)) return 'ended';
  return 'overdue';
}
