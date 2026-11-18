// Every email uses the reserved `.test` TLD and every token is a placeholder; nothing here is a
// real account. Times are offsets from server start so countdowns stay realistic.

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

export type EndSourceFixture = 'manual' | 'claude-anniversary' | 'codex-api' | 'plan-ended';

export type EndFixture =
  | { source: 'claude-anniversary' }
  | { source: Exclude<EndSourceFixture, 'claude-anniversary'>; inMs: number };

export interface WarningFixture {
  code: 'provider_renews' | 'grace_period';
  untilInMs?: number;
}

export interface ClaudeFixture {
  email: string;
  note?: string;
  authIndex: string;
  sevenDay: WindowFixture;
  fable: WindowFixture;
  fiveHour: WindowFixture;
  opus: WindowFixture;
  grants: ClaudeGrantFixture[];
  /** Requests per ten-minute bucket, newest last. */
  traffic: number[];
  end?: EndFixture;
  /** Offset of the Stripe subscription_created_at; absent means no profile sample yet. */
  subscribedInMs?: number;
  planActive?: boolean;
}

export interface CodexFixture {
  accountId: string;
  email: string;
  note?: string;
  authIndex: string;
  weekly: WindowFixture;
  fiveHour: WindowFixture;
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

export const claudeFixtures: ClaudeFixture[] = [
  {
    email: 'mary-jane@studio.test',
    note: 'studio',
    authIndex: 'claude-1',
    sevenDay: { used: 45, resetInMs: 19 * HOUR_MS + 12 * MINUTE_MS },
    fable: { used: 8, resetInMs: 19 * HOUR_MS + 12 * MINUTE_MS },
    fiveHour: { used: 12, resetInMs: 3 * HOUR_MS },
    opus: { used: 30, resetInMs: 19 * HOUR_MS + 12 * MINUTE_MS },
    grants: [
      { label: FULL_RESET, left: 1, endsInMs: 29 * DAY_MS },
      { label: FABLE_RESET, left: 1, endsInMs: 117 * DAY_MS },
    ],
    traffic: busy(9),
    subscribedInMs: -38 * DAY_MS - 5 * HOUR_MS,
  },
  {
    email: 'ops.lead@harbor.test',
    authIndex: 'claude-2',
    sevenDay: { used: 0, resetInMs: 2 * DAY_MS },
    fable: { used: 0, resetInMs: 2 * DAY_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 2 * DAY_MS },
    grants: [{ label: FULL_RESET, left: 1, endsInMs: 29 * DAY_MS }],
    traffic: quiet(),
  },
  {
    email: 'build-bot@foundry.test',
    note: 'ci runner',
    authIndex: 'claude-3',
    sevenDay: { used: 0, resetInMs: 5 * DAY_MS + 10 * HOUR_MS },
    fable: { used: 0, resetInMs: 5 * DAY_MS + 10 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 5 * DAY_MS + 10 * HOUR_MS },
    grants: [
      { label: FULL_RESET, left: 1, endsInMs: 29 * DAY_MS },
      { label: FABLE_RESET, left: 1, endsInMs: 117 * DAY_MS, requiresLimit: true },
    ],
    traffic: busy(3),
    subscribedInMs: -78 * DAY_MS + 12 * HOUR_MS,
    end: { source: 'claude-anniversary' },
  },
  {
    email: 'night-shift@harbor.test',
    note: 'research',
    authIndex: 'claude-4',
    sevenDay: { used: 89, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    fable: { used: 78, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    fiveHour: { used: 64, resetInMs: 2 * HOUR_MS },
    opus: { used: 91, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    grants: [{ label: FULL_RESET, left: 1, endsInMs: 29 * DAY_MS }],
    traffic: busy(14),
    subscribedInMs: -200 * DAY_MS,
  },
  {
    email: 'alex@lumen.test',
    note: 'personal',
    authIndex: 'claude-5',
    sevenDay: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    fable: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    grants: [{ label: FABLE_RESET, left: 2, endsInMs: 117 * DAY_MS }],
    traffic: quiet(),
    subscribedInMs: -61 * DAY_MS,
    end: { inMs: -1 * DAY_MS, source: 'manual' },
  },
  {
    email: 'sam-o@grove.test',
    authIndex: 'claude-6',
    sevenDay: { used: 1, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    fable: { used: 1, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    grants: [{ label: FULL_RESET, left: 1, endsInMs: 29 * DAY_MS }],
    traffic: busy(2),
    subscribedInMs: -95 * DAY_MS,
    end: { inMs: -3 * DAY_MS, source: 'plan-ended' },
    planActive: false,
  },
];

export const codexFixtures: CodexFixture[] = [
  {
    accountId: 'ae5d455f',
    email: 'tooling@lumen.test',
    note: 'tooling',
    authIndex: 'codex-1',
    weekly: { used: 17, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    fiveHour: { used: 4, resetInMs: 4 * HOUR_MS },
    renewsInMs: 21 * DAY_MS,
    manualResets: 0,
    manualResetExpiresInMs: 0,
    traffic: busy(6),
    warnings: [{ code: 'grace_period', untilInMs: 3 * DAY_MS }],
  },
  {
    accountId: '0b7c21aa',
    email: 'mary-jane@studio.test',
    authIndex: 'codex-2',
    weekly: { used: 100, resetInMs: 2 * DAY_MS + 1 * HOUR_MS },
    fiveHour: { used: 100, resetInMs: 1 * HOUR_MS },
    renewsInMs: 9 * DAY_MS,
    manualResets: 2,
    manualResetExpiresInMs: 12 * DAY_MS,
    traffic: quiet(),
    end: { inMs: 5 * DAY_MS, source: 'manual' },
    warnings: [{ code: 'provider_renews' }],
  },
  {
    accountId: '9f4e0c13',
    email: 'build-bot@foundry.test',
    authIndex: 'codex-3',
    weekly: { used: 72, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    fiveHour: { used: 20, resetInMs: 2 * HOUR_MS },
    renewsInMs: 15 * DAY_MS,
    manualResets: 1,
    manualResetExpiresInMs: 30 * DAY_MS,
    traffic: busy(4),
    end: { inMs: 10 * DAY_MS + 5 * HOUR_MS, source: 'codex-api' },
  },
];

export const xaiFixture = {
  email: 'tooling@grove.test',
  authIndex: 'xai-1',
  weeklyUsed: 38,
  weeklyResetInMs: 5 * DAY_MS + 2 * HOUR_MS,
};

export const kimiFixture = {
  email: 'tooling@grove.test',
  authIndex: 'kimi-1',
  weeklyResetInMs: 5 * DAY_MS - 1 * HOUR_MS,
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
      { provider: 'codex', model: 'gpt-5.5', authIndexes: ['codex-3'], weight: 1 },
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
  kimi: ['kimi-k3'],
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
  strategy: round-robin
  retry:
    request-retry: 3
  use-or-lose:
    drain-ending-credentials: true
  cooldown:
    disable-cooling: false
oauth:
  auth-dir: ./mock-auths
`;
