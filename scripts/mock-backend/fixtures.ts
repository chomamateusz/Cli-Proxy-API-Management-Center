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
    grants: [{ label: 'model', left: 1, endsInMs: 118 * DAY_MS }],
    traffic: busy(9),
  },
  {
    email: 'ops.lead@harbor.test',
    authIndex: 'claude-2',
    sevenDay: { used: 0, resetInMs: 2 * DAY_MS },
    fable: { used: 0, resetInMs: 2 * DAY_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 2 * DAY_MS },
    grants: [
      { label: 'account', left: 1, endsInMs: 35 * DAY_MS },
      { label: 'model', left: 3, endsInMs: 118 * DAY_MS },
    ],
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
    grants: [{ label: 'model', left: 1, endsInMs: 118 * DAY_MS }],
    traffic: busy(3),
  },
  {
    email: 'night-shift@harbor.test',
    note: 'research',
    authIndex: 'claude-4',
    sevenDay: { used: 89, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    fable: { used: 78, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    fiveHour: { used: 64, resetInMs: 2 * HOUR_MS },
    opus: { used: 91, resetInMs: 7 * HOUR_MS + 12 * MINUTE_MS },
    grants: [{ label: 'model', left: 1, endsInMs: 118 * DAY_MS }],
    traffic: busy(14),
  },
  {
    email: 'alex@lumen.test',
    note: 'personal',
    authIndex: 'claude-5',
    sevenDay: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    fable: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 1 * DAY_MS + 11 * HOUR_MS },
    grants: [{ label: 'model', left: 2, endsInMs: 118 * DAY_MS }],
    traffic: quiet(),
  },
  {
    email: 'sam-o@grove.test',
    authIndex: 'claude-6',
    sevenDay: { used: 1, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    fable: { used: 1, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    opus: { used: 0, resetInMs: 4 * DAY_MS + 20 * HOUR_MS },
    grants: [{ label: 'model', left: 1, endsInMs: 118 * DAY_MS }],
    traffic: busy(2),
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
  cooldown:
    disable-cooling: false
oauth:
  auth-dir: ./mock-auths
`;
