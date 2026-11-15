/**
 * Auth-file types.
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'devin'
  | 'meta'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileCooldown {
  scope: 'model' | 'credential';
  modelKey?: string;
  reason: string;
  retryAt: string;
  remainingSeconds: number;
  backoffLevel?: number;
  httpStatus?: number;
}

export interface AuthFileCooldownSnapshot {
  /** Server observation time, not the start of the cooldown. */
  observedAt?: string;
  /** Local receipt time anchors relative timers without relying on synchronized clocks. */
  receivedAtMs: number;
  /** null = runtime state unknown; [] = known, with no active timers. */
  records: AuthFileCooldown[] | null;
}

export const CREDENTIAL_END_STATES = ['none', 'scheduled', 'overdue', 'ended'] as const;
export type CredentialEndState = (typeof CREDENTIAL_END_STATES)[number];

export const CREDENTIAL_END_SOURCES = [
  'manual',
  'claude-anniversary',
  'codex-api',
  'plan-ended',
] as const;
export type CredentialEndSource = (typeof CREDENTIAL_END_SOURCES)[number];

export interface ReportedCredentialEnd {
  endsAtMs: number | null;
  reportedState?: CredentialEndState;
  reportedEnded?: boolean;
  source?: CredentialEndSource;
}

export interface CredentialEndWarning {
  code: string;
  until?: string;
}

export interface AuthFileItem {
  name: string;
  siwcBindSupported?: boolean;
  useSiwc?: boolean;
  siwcBound?: boolean;
  siwcExpiresAt?: string;
  type?: AuthFileType | string;
  provider?: string;
  /**
   * Account email supplied by the file scanner or credential registry.
   * Never display or search account/account_type: API-key credentials may expose
   * the API key itself through those fields.
   */
  email?: string;
  /** GCP / Vertex project ID, used when account email is absent. */
  projectId?: string;
  size?: number;
  authIndex?: string | number | null;
  /** Generic plugin quota capability advertised by CPA's auth-files API. */
  supportsQuota?: boolean;
  quotaProvider?: string;
  /** Backend-selected quota plugin; authoritative when supplied by v8 credentials. */
  quotaPluginId?: string;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  priority?: number;
  weight?: number;
  note?: string;
  /** Subscription end (RFC3339 UTC); absent means no end is known. */
  fleetEndsAt?: string;
  /** Backend verdict at list time that the credential has ended and left routing. */
  fleetEnded?: boolean;
  fleetEndState?: CredentialEndState;
  fleetEndsAtSource?: CredentialEndSource;
  fleetCancelledAt?: string;
  fleetEndWarnings?: CredentialEndWarning[];
  /** Claude subscription_created_at from the latest provider profile sample. */
  fleetBillingAnchor?: string;
  /** Last successful provider subscription sample. */
  fleetEndCheckedAt?: string;
  success?: unknown;
  failed?: unknown;
  /** Cumulative success/failure counts normalized by the API boundary. */
  successCount?: number;
  failureCount?: number;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  /** Absent on older servers. Never interpreted as credential health. */
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  observed_at?: unknown;
  observedAt?: string;
}
