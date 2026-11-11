// Log in from the dev server with a custom connection to http://127.0.0.1:<MOCK_PORT> and any key.

import { parse as parseYaml } from 'yaml';
import {
  CREDENTIAL_MODELS,
  MOCK_CONFIG_YAML,
  claudeFixtures,
  codexFixtures,
  issuedKeyFixtures,
  kimiFixture,
  xaiFixture,
  type WindowFixture,
} from './fixtures';

const PORT = Number(process.env.MOCK_PORT ?? 8317);
const HOST = process.env.MOCK_HOST ?? '127.0.0.1';
const PREFIX = '/v8/management';
const BUCKET_MS = 10 * 60 * 1000;
const startedAt = Date.now();
let configYaml = MOCK_CONFIG_YAML;
const consumedCodexResets = new Map<string, number>();
const issuedKeys = issuedKeyFixtures.map((key) => ({
  name: key.name,
  'issued-by': key['issued-by'],
  'created-at': new Date(startedAt + key.createdInMs).toISOString(),
  'expires-at': key.expiresInMs === null ? '' : new Date(startedAt + key.expiresInMs).toISOString(),
  models: key.models,
  'excluded-models': [] as string[],
}));

const iso = (offsetMs: number) => new Date(startedAt + offsetMs).toISOString();
const unix = (offsetMs: number) => Math.floor((startedAt + offsetMs) / 1000);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'x-cpa-version, x-cpa-build-date, x-cpa-support-plugin',
  'x-cpa-version': 'v8.0.0-mock',
  'x-cpa-support-plugin': 'false',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const recentRequests = (traffic: readonly number[]) => {
  const current = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  return traffic.map((count, index) => ({
    time: new Date(current - (traffic.length - 1 - index) * BUCKET_MS).toISOString(),
    success: count,
    failed: 0,
  }));
};

const entry = (provider: string, name: string, authIndex: string, email: string) => ({
  id: name,
  auth_index: authIndex,
  name,
  type: provider,
  provider,
  label: email,
  email,
  status: 'active',
  status_message: '',
  disabled: false,
  unavailable: false,
  runtime_only: false,
  source: 'file',
  size: 2048,
  account_type: 'oauth',
  modtime: new Date(startedAt - 3 * 24 * 60 * 60 * 1000).toISOString(),
  success: 0,
  failed: 0,
  recent_requests: recentRequests(Array.from({ length: 20 }, () => 0)),
});

const credentials = () => [
  ...claudeFixtures.map((fixture) => ({
    ...entry('claude', `claude-${fixture.email}.json`, fixture.authIndex, fixture.email),
    ...(fixture.note ? { note: fixture.note } : {}),
    success: fixture.traffic.reduce((sum, count) => sum + count, 0),
    recent_requests: recentRequests(fixture.traffic),
  })),
  ...codexFixtures.map((fixture) => ({
    ...entry(
      'codex',
      `codex-${fixture.accountId}-${fixture.email}-pro.json`,
      fixture.authIndex,
      fixture.email
    ),
    ...(fixture.note ? { note: fixture.note } : {}),
    chatgpt_account_id: fixture.accountId,
    success: fixture.traffic.reduce((sum, count) => sum + count, 0),
    recent_requests: recentRequests(fixture.traffic),
  })),
  entry('xai', `xai-${xaiFixture.email}.json`, xaiFixture.authIndex, xaiFixture.email),
  entry('kimi', `kimi-${kimiFixture.email}.json`, kimiFixture.authIndex, kimiFixture.email),
];

const upstream = (status: number, body: unknown) => ({
  status_code: status,
  header: {},
  body: JSON.stringify(body),
});

const claudeWindow = ({ used, resetInMs }: WindowFixture) => ({
  utilization: used,
  resets_at: resetInMs === null ? null : iso(resetInMs),
});

const codexWindow = ({ used, resetInMs }: WindowFixture, seconds: number) => ({
  used_percent: used,
  limit_window_seconds: seconds,
  reset_at: unix(resetInMs ?? 0),
});

const answerClaude = (claude: (typeof claudeFixtures)[number], url: string) => {
  if (url.startsWith('https://api.anthropic.com/api/oauth/usage')) {
    return upstream(200, {
      five_hour: claudeWindow(claude.fiveHour),
      seven_day: claudeWindow(claude.sevenDay),
      seven_day_opus: claudeWindow(claude.opus),
      limits: [
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: claude.fable.used,
          resets_at: claude.fable.resetInMs === null ? null : iso(claude.fable.resetInMs),
          is_active: true,
          scope: { model: { id: null, display_name: 'Fable 5' } },
        },
      ],
      cedar_ember: {
        eligible: true,
        at_limit: claude.sevenDay.used >= 100,
        grants: claude.grants.map((grant, index) => ({
          id: `grant_${claude.authIndex.replace(/\W/g, '')}_${index}`,
          label: grant.label,
          resets_total: grant.left,
          resets_left: grant.left,
          starts_at: iso(-7 * 24 * 60 * 60 * 1000),
          ends_at: iso(grant.endsInMs),
          clears: ['five_hour', 'seven_day'],
          paused: false,
          usable_now: true,
          use_requires_limit: false,
        })),
        weekly_resets_at:
          claude.sevenDay.resetInMs === null ? null : iso(claude.sevenDay.resetInMs),
        cooldown_until: null,
      },
    });
  }
  if (url === 'https://api.anthropic.com/api/oauth/profile') {
    return upstream(200, {
      account: { has_claude_max: true, has_claude_pro: false },
      organization: {
        organization_type: 'claude_max',
        subscription_status: 'active',
        uuid: `00000000-0000-4000-8000-00000000000${claude.authIndex.slice(-1)}`,
      },
    });
  }
  return null;
};

const answerCodex = (codex: (typeof codexFixtures)[number], url: string) => {
  const consumed = consumedCodexResets.get(codex.authIndex) ?? 0;
  const remainingResets = Math.max(0, codex.manualResets - consumed);
  if (url === 'https://chatgpt.com/backend-api/wham/usage') {
    const weekly = consumed > 0 ? { used: 0, resetInMs: 7 * 24 * 60 * 60 * 1000 } : codex.weekly;
    const fiveHour = consumed > 0 ? { used: 0, resetInMs: 5 * 60 * 60 * 1000 } : codex.fiveHour;
    return upstream(200, {
      plan_type: 'pro',
      rate_limit: {
        allowed: weekly.used < 100,
        limit_reached: weekly.used >= 100,
        primary_window: codexWindow(fiveHour, 18000),
        secondary_window: codexWindow(weekly, 604800),
      },
      code_review_rate_limit: null,
      additional_rate_limits: [],
      rate_limit_reset_credits: {
        available_count: remainingResets,
        applicable_available_count: remainingResets,
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    });
  }
  if (url.startsWith('https://chatgpt.com/backend-api/subscriptions')) {
    return upstream(200, { active_until: iso(codex.renewsInMs) });
  }
  if (url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits') {
    return upstream(200, {
      available_count: remainingResets,
      credits: Array.from({ length: remainingResets }, (_, index) => ({
        id: `credit-${codex.authIndex}-${index}`,
        reset_type: 'codex_rate_limits',
        status: 'available',
        granted_at: iso(-2 * 24 * 60 * 60 * 1000),
        expires_at: iso(codex.manualResetExpiresInMs + index * 24 * 60 * 60 * 1000),
      })),
    });
  }
  if (url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume') {
    consumedCodexResets.set(codex.authIndex, consumed + 1);
    return upstream(200, { status: 'consumed' });
  }
  return null;
};

const answerXai = (url: string) => {
  const weekStart = iso(xaiFixture.weeklyResetInMs - 7 * 24 * 60 * 60 * 1000);
  const weekEnd = iso(xaiFixture.weeklyResetInMs);
  if (url.startsWith('https://cli-chat-proxy.grok.com/v1/billing?format=credits')) {
    return upstream(200, {
      config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: weekStart, end: weekEnd },
        creditUsagePercent: xaiFixture.weeklyUsed,
        billingPeriodStart: weekStart,
        billingPeriodEnd: weekEnd,
        onDemandCap: { val: 0 },
      },
    });
  }
  if (url.startsWith('https://cli-chat-proxy.grok.com/v1/billing')) {
    return upstream(200, {
      config: {
        monthlyLimit: { val: 3000 },
        used: { val: 1140 },
        onDemandCap: { val: 0 },
        billingPeriodStart: iso(-10 * 24 * 60 * 60 * 1000),
        billingPeriodEnd: iso(20 * 24 * 60 * 60 * 1000),
      },
    });
  }
  return upstream(200, {});
};

const answerApiCall = (request: { authIndex?: string; auth_index?: string; url?: string }) => {
  const authIndex = String(request.authIndex ?? request.auth_index ?? '');
  const url = String(request.url ?? '');
  const claude = claudeFixtures.find((fixture) => fixture.authIndex === authIndex);
  const codex = codexFixtures.find((fixture) => fixture.authIndex === authIndex);
  const answer =
    (claude && answerClaude(claude, url)) ||
    (codex && answerCodex(codex, url)) ||
    (authIndex === xaiFixture.authIndex ? answerXai(url) : null);
  if (answer) return answer;
  if (authIndex === kimiFixture.authIndex && url.includes('/coding/v1/usages')) {
    return upstream(200, {
      usage: {
        used: '24',
        limit: '100',
        remaining: '76',
        resetTime: iso(kimiFixture.weeklyResetInMs),
      },
      limits: [],
    });
  }
  return upstream(404, { error: { message: `mock backend has no fixture for ${url}` } });
};

const policies = () => {
  const keys = (parseYaml(configYaml)?.access?.['api-keys'] ?? []) as string[];
  return keys.map((_key, index) => ({
    index,
    name: issuedKeys[index]?.name ?? '',
    'issued-by': issuedKeys[index]?.['issued-by'] ?? '',
    'expires-at': issuedKeys[index]?.['expires-at'] ?? '',
    has_policy: index === 0,
    models: index === 0 ? ['claude-*'] : [],
    'excluded-models': [],
    credentials: index === 0 ? [`claude-${claudeFixtures[0].email}.json`] : [],
    'excluded-credentials': [],
  }));
};

const logLines = () =>
  Array.from({ length: 40 }, (_, index) => {
    const at = new Date(Date.now() - (40 - index) * 37_000).toISOString();
    const status = index % 9 === 0 ? 429 : 200;
    return `${at} [info] POST /v1/messages ${status} ${120 + ((index * 53) % 900)}ms model=claude-sonnet-5`;
  });

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (!url.pathname.startsWith(PREFIX)) return json({ error: 'not found' }, 404);
    const path = url.pathname.slice(PREFIX.length) || '/';
    const method = req.method;

    if (path === '/config' && method === 'GET') return json(parseYaml(configYaml) ?? {});
    if (path === '/config.yaml' && method === 'GET') {
      return new Response(configYaml, {
        headers: { ...corsHeaders, 'Content-Type': 'application/yaml' },
      });
    }
    if (path === '/config.yaml' && method === 'PUT') {
      configYaml = await req.text();
      return json({ status: 'ok' });
    }
    if (path.startsWith('/config')) return json({ status: 'ok' });
    if (path === '/credentials' && method === 'GET') {
      const files = credentials();
      return json({ observed_at: new Date().toISOString(), files, total: files.length });
    }
    if (path === '/credentials/models' && method === 'GET') {
      const name = url.searchParams.get('name') ?? '';
      const provider = name.split('-')[0];
      return json({ models: (CREDENTIAL_MODELS[provider] ?? []).map((id) => ({ id })) });
    }
    if (path === '/requests/api-call' && method === 'POST') {
      return json(answerApiCall(await req.json()));
    }
    if (path === '/issued-keys' && method === 'GET') return json(issuedKeys);
    if (path === '/issued-keys' && method === 'POST') {
      const body = (await req.json()) as { name: string; models: string[] };
      const key = {
        name: body.name,
        'issued-by': 'admin',
        'created-at': new Date().toISOString(),
        'expires-at': '',
        models: body.models,
        'excluded-models': [],
      };
      issuedKeys.push(key);
      return json({ ...key, key: `mock-client-key-${body.name}` });
    }
    if (path.startsWith('/issued-keys/') && method === 'DELETE') {
      const name = decodeURIComponent(path.slice('/issued-keys/'.length));
      const index = issuedKeys.findIndex((key) => key.name === name);
      if (index >= 0) issuedKeys.splice(index, 1);
      return json({ revoked: index >= 0 ? 1 : 0 });
    }
    if (path === '/client-key-policies' && method === 'GET') return json(policies());
    if (path.startsWith('/client-key-policies/') && method !== 'GET') {
      const name = decodeURIComponent(path.slice('/client-key-policies/'.length));
      return json(policies().find((policy) => policy.name === name) ?? policies()[0]);
    }
    if (path === '/routing/cooldown/reset' && method === 'POST') return json({ status: 'ok' });
    if (path === '/observability/usage/api-keys') return json({});
    if (path === '/observability/logs') {
      const lines = logLines();
      return json({ lines, 'line-count': lines.length, 'latest-timestamp': Date.now() / 1000 });
    }
    if (path === '/server/latest-version') return json({ 'latest-version': 'v8.0.0-mock' });
    if (method === 'GET') return json({});
    return json({ status: 'ok' });
  },
});

console.log(`mock management backend on http://${HOST}:${PORT}${PREFIX}`);
