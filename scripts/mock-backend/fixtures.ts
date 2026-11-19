// Every email is an invented address under example.com and every token is a placeholder; nothing
// here is a real account. Times are offsets from server start so countdowns stay realistic.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface WindowFixture {
  used: number;
  resetInMs: number | null;
}

export interface ClaudeGrantFixture {
  label: string;
  left: number;
  endsInMs: number;
  requiresLimit?: boolean;
}

const FULL_RESET = 'One full limit reset (November 2026)';
const FABLE_RESET =
  'New model launch: one Fable reset for Max, Team Premium and Enterprise Premium';
const TENURE_12_RESET = "New model launch: one more Fable reset at 12 months' tenure";
const TENURE_6_RESET = "New model launch: one more Fable reset at 6 months' tenure";

export type EndSourceFixture = 'manual' | 'claude-anniversary' | 'codex-api' | 'plan-ended';

export type EndFixture =
  | { source: 'claude-anniversary' }
  | { source: Exclude<EndSourceFixture, 'claude-anniversary'>; inMs: number };

export interface WarningFixture {
  code: 'provider_renews' | 'grace_period';
  untilInMs?: number;
}

export interface ExtraUsageFixture {
  monthlyLimitMinor: number | null;
  disabledReason: string | null;
}

export interface ClaudeFixture {
  email: string;
  note?: string;
  authIndex: string;
  plan: 'max5' | 'max20';
  sevenDay: WindowFixture;
  fable: WindowFixture;
  /** Null: the account reports no five-hour window. */
  fiveHour: WindowFixture | null;
  opus?: WindowFixture;
  grants: ClaudeGrantFixture[];
  extraUsage: ExtraUsageFixture;
  /** Requests per ten-minute bucket, newest last. */
  traffic: number[];
  end?: EndFixture;
  /** Offset of the Stripe subscription_created_at; absent means no profile sample yet. */
  subscribedInMs?: number;
  planActive?: boolean;
  /** Remaining seconds of a credential-wide cooldown reported in the credential list. */
  coolingForSeconds?: number;
}

export interface CodexFixture {
  accountId: string;
  email: string;
  note?: string;
  authIndex: string;
  plan: 'pro' | 'prolite';
  weekly: WindowFixture;
  renewsInMs: number;
  manualResets: number;
  manualResetExpiresInMs: number;
  traffic: number[];
  end?: EndFixture;
  warnings?: WarningFixture[];
}

const quiet = () => Array.from({ length: 20 }, () => 0);
const busy = (peak: number) =>
  Array.from({ length: 20 }, (_, index) => (index > 13 ? peak - ((index * 3) % peak) : 0));

const EXTRA_USAGE_OFF: ExtraUsageFixture = { monthlyLimitMinor: null, disabledReason: null };

export const claudeFixtures: ClaudeFixture[] = [
  {
    email: 'studio-one@example.com',
    note: 'studio',
    authIndex: 'claude-1',
    plan: 'max5',
    sevenDay: { used: 48, resetInMs: 2 * DAY_MS + 4 * HOUR_MS },
    fable: { used: 30, resetInMs: 2 * DAY_MS + 4 * HOUR_MS },
    fiveHour: { used: 35, resetInMs: 2 * HOUR_MS },
    opus: { used: 30, resetInMs: 2 * DAY_MS + 4 * HOUR_MS },
    grants: [
      { label: FULL_RESET, left: 1, endsInMs: 21 * DAY_MS },
      { label: FABLE_RESET, left: 1, endsInMs: 109 * DAY_MS },
    ],
    extraUsage: EXTRA_USAGE_OFF,
    traffic: busy(9),
    subscribedInMs: -38 * DAY_MS - 5 * HOUR_MS,
  },
  {
    email: 'studio-two@example.com',
    authIndex: 'claude-2',
    plan: 'max5',
    sevenDay: { used: 20, resetInMs: 4 * DAY_MS + 2 * HOUR_MS },
    fable: { used: 10, resetInMs: 4 * DAY_MS + 2 * HOUR_MS },
    fiveHour: { used: 97, resetInMs: 1 * HOUR_MS + 20 * MINUTE_MS },
    grants: [{ label: FULL_RESET, left: 1, endsInMs: 21 * DAY_MS }],
    extraUsage: EXTRA_USAGE_OFF,
    traffic: busy(12),
    subscribedInMs: -61 * DAY_MS,
    end: { inMs: 12 * DAY_MS, source: 'manual' },
  },
  {
    email: 'night-shift@example.com',
    note: 'research',
    authIndex: 'claude-3',
    plan: 'max20',
    sevenDay: { used: 72, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    fable: { used: 57, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    fiveHour: null,
    opus: { used: 64, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    grants: [
      { label: FULL_RESET, left: 1, endsInMs: 21 * DAY_MS },
      { label: FABLE_RESET, left: 1, endsInMs: 109 * DAY_MS },
      { label: TENURE_12_RESET, left: 1, endsInMs: 109 * DAY_MS },
      { label: TENURE_6_RESET, left: 1, endsInMs: 109 * DAY_MS },
    ],
    extraUsage: { monthlyLimitMinor: 10_000, disabledReason: 'out_of_credits' },
    traffic: busy(14),
    subscribedInMs: -200 * DAY_MS,
  },
  {
    email: 'build-bot@example.com',
    note: 'ci runner',
    authIndex: 'claude-4',
    plan: 'max20',
    sevenDay: { used: 12, resetInMs: 1 * DAY_MS + 3 * HOUR_MS + 40 * MINUTE_MS },
    fable: { used: 0, resetInMs: 1 * DAY_MS + 3 * HOUR_MS + 40 * MINUTE_MS },
    fiveHour: null,
    grants: [],
    extraUsage: EXTRA_USAGE_OFF,
    traffic: busy(3),
    subscribedInMs: -78 * DAY_MS + 12 * HOUR_MS,
    end: { source: 'claude-anniversary' },
  },
  {
    email: 'ops-lead@example.com',
    authIndex: 'claude-5',
    plan: 'max20',
    sevenDay: { used: 100, resetInMs: 20 * HOUR_MS },
    fable: { used: 100, resetInMs: 20 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: 4 * HOUR_MS },
    grants: [{ label: FABLE_RESET, left: 1, endsInMs: 109 * DAY_MS, requiresLimit: true }],
    extraUsage: EXTRA_USAGE_OFF,
    traffic: quiet(),
    subscribedInMs: -95 * DAY_MS,
  },
  {
    email: 'alex-lumen@example.com',
    note: 'personal',
    authIndex: 'claude-6',
    plan: 'max20',
    sevenDay: { used: 30, resetInMs: 3 * DAY_MS + 6 * HOUR_MS },
    fable: { used: 58, resetInMs: 3 * DAY_MS + 6 * HOUR_MS },
    fiveHour: { used: 5, resetInMs: 3 * HOUR_MS },
    grants: [
      { label: FULL_RESET, left: 1, endsInMs: 21 * DAY_MS },
      { label: FABLE_RESET, left: 1, endsInMs: 109 * DAY_MS },
      { label: TENURE_6_RESET, left: 1, endsInMs: 109 * DAY_MS },
    ],
    extraUsage: EXTRA_USAGE_OFF,
    traffic: busy(2),
    subscribedInMs: -120 * DAY_MS,
    coolingForSeconds: 25 * 60,
  },
];

export const codexFixtures: CodexFixture[] = [
  {
    accountId: 'ae5d455f',
    email: 'tooling-codex@example.com',
    note: 'tooling',
    authIndex: 'codex-1',
    plan: 'prolite',
    weekly: { used: 40, resetInMs: 5 * DAY_MS + 14 * HOUR_MS },
    renewsInMs: 28 * DAY_MS,
    manualResets: 0,
    manualResetExpiresInMs: 0,
    traffic: busy(6),
    warnings: [{ code: 'grace_period', untilInMs: 3 * DAY_MS }],
  },
  {
    accountId: '0b7c21aa',
    email: 'studio-codex@example.com',
    authIndex: 'codex-2',
    plan: 'pro',
    weekly: { used: 100, resetInMs: 2 * DAY_MS + 1 * HOUR_MS },
    renewsInMs: 16 * DAY_MS,
    manualResets: 2,
    manualResetExpiresInMs: 12 * DAY_MS,
    traffic: quiet(),
    end: { inMs: 16 * DAY_MS, source: 'manual' },
    warnings: [{ code: 'provider_renews' }],
  },
];

export const xaiFixture = {
  email: 'grok-one@example.com',
  authIndex: 'xai-1',
  weeklyUsed: 2,
  weeklyResetInMs: 5 * DAY_MS + 2 * HOUR_MS,
};

export const issuedKeyFixtures = [
  {
    name: 'laptop',
    'issued-by': 'admin',
    createdInMs: -12 * DAY_MS,
    expiresInMs: 18 * DAY_MS,
    models: ['claude-*', 'gpt-5*'],
  },
  {
    name: 'ci',
    'issued-by': 'admin',
    createdInMs: -2 * DAY_MS,
    expiresInMs: null,
    models: ['claude-sonnet-*'],
  },
];

export interface UsageKeyFixture {
  name: string;
  peakPerHour: number;
  failureRate: number;
  routes: { provider: 'claude' | 'codex'; model: string; authIndexes: string[]; weight: number }[];
}

export const USAGE_RECORDED_DAYS = 4;

export const usageKeyFixtures: UsageKeyFixture[] = [
  {
    name: 'laptop',
    peakPerHour: 42,
    failureRate: 0.03,
    routes: [
      {
        provider: 'claude',
        model: 'claude-opus-5',
        authIndexes: ['claude-1', 'claude-2'],
        weight: 3,
      },
      { provider: 'codex', model: 'gpt-5.5-codex', authIndexes: ['codex-1', 'codex-2'], weight: 2 },
    ],
  },
  {
    name: 'ci',
    peakPerHour: 30,
    failureRate: 0.08,
    routes: [
      {
        provider: 'claude',
        model: 'claude-sonnet-5',
        authIndexes: ['claude-3', 'claude-4'],
        weight: 1,
      },
    ],
  },
  {
    name: 'old-tablet',
    peakPerHour: 9,
    failureRate: 0.02,
    routes: [
      { provider: 'codex', model: 'gpt-5.5', authIndexes: ['codex-1'], weight: 1 },
      {
        provider: 'claude',
        model: 'claude-fable-5',
        authIndexes: ['claude-5', 'claude-99'],
        weight: 1,
      },
    ],
  },
  {
    name: 'unnamed-3f2a91c0',
    peakPerHour: 4,
    failureRate: 0.2,
    routes: [
      { provider: 'claude', model: 'claude-sonnet-5', authIndexes: ['claude-6'], weight: 1 },
    ],
  },
];

export const CREDENTIAL_MODELS: Record<string, string[]> = {
  claude: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5'],
  codex: ['gpt-5.5', 'gpt-5.5-codex'],
  xai: ['grok-5'],
};

export const MOCK_CONFIG_YAML = `# Mock backend config; all values are fictitious.
config-version: 8
server:
  host: localhost
  port: 8317
management:
  allow-remote: false
access:
  api-keys: [mock-client-key-laptop, mock-client-key-ci, mock-client-key-shared]
routing:
  strategy: use-or-lose
  session-affinity: true
  retry:
    request-retry: 3
  use-or-lose:
    short-window-cap-pct: 95
    drain-ending-credentials: true
  cooldown:
    disable-cooling: false
oauth:
  auth-dir: ./mock-auths
`;
