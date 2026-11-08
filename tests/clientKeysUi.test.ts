import { afterAll, describe, expect, test } from 'bun:test';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/i18n/index';
import { ClientKeysTabs } from '../src/features/clientKeys/components/ClientKeysTabs';
import { CredentialsPanel } from '../src/features/clientKeys/components/CredentialsPanel';
import {
  IssueKeyReveal,
  IssueKeyRevealFooter,
} from '../src/features/clientKeys/components/IssueKeyDialog';
import { KeysTable } from '../src/features/clientKeys/components/KeysTable';
import { ModelMatrix } from '../src/features/clientKeys/components/ModelMatrix';
import { toPolicyCredential } from '../src/features/clientKeys/credentials';
import { nextGridPosition } from '../src/features/clientKeys/hooks/useGridRovingFocus';
import { buildModelCatalog } from '../src/features/clientKeys/matrix';
import { KeyPolicySheet } from '../src/features/clientKeys/components/KeyPolicySheet';
import {
  blockAllBanners,
  patternCellId,
  pendingPatternValues,
  policyGuardKey,
  projectPatternList,
} from '../src/features/clientKeys/presentation';
import type { ClientKeyPolicy, IssuedKey, PolicyLists } from '../src/types/clientKeys';

const initialLanguage = i18n.language;
await i18n.changeLanguage('en');
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const NOW = Date.parse('2026-11-08T12:00:00Z');
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

const lists = (overrides: Partial<PolicyLists> = {}): PolicyLists => ({
  models: [],
  excludedModels: [],
  credentials: [],
  excludedCredentials: [],
  ...overrides,
});

const policy = (
  index: number,
  name: string,
  overrides: Partial<ClientKeyPolicy> = {}
): ClientKeyPolicy => ({
  index,
  name,
  issuedBy: name ? 'management' : '',
  expiresAt: '',
  expiresAtMs: null,
  hasPolicy: name !== '',
  ...lists(),
  ...overrides,
});

const issued = (name: string, overrides: Partial<IssuedKey> = {}): IssuedKey => ({
  name,
  issuedBy: 'management',
  createdAt: '2026-10-31T14:02:00Z',
  createdAtMs: Date.parse('2026-10-31T14:02:00Z'),
  expiresAt: '',
  expiresAtMs: null,
  models: ['*'],
  excludedModels: [],
  ...overrides,
});

const WORK = toPolicyCredential({
  name: 'claude-work.json',
  id: 'claude-work.json',
  type: 'claude',
  email: 'work@example.com',
  account: 'secret-account-value',
});
const CODEX = toPolicyCredential({
  name: 'codex-1a2b3c4d-me@example.com-team.json',
  id: 'codex-1',
  type: 'codex',
  email: 'me@example.com',
});

const POLICIES = [
  policy(0, 'mac-pro-m1', { models: ['*'], excludedModels: ['claude-fable-*'] }),
  policy(1, 'ci-runner', { models: ['claude-*'] }),
  policy(2, ''),
];

const CATALOG = buildModelCatalog([WORK, CODEX], {
  'claude-work.json': ['claude-opus', 'claude-fable-5'],
  'codex-1a2b3c4d-me@example.com-team.json': ['gpt-5', 'gpt-5-mini'],
});

const noop = () => {};

describe('KeysTable', () => {
  const html = render(
    createElement(KeysTable, {
      issuedKeys: [
        issued('mac-pro-m1', { excludedModels: ['claude-fable-*'] }),
        issued('old-ci', {
          expiresAt: '2026-11-05T12:00:00Z',
          expiresAtMs: Date.parse('2026-11-05T12:00:00Z'),
        }),
      ],
      policies: POLICIES,
      revoking: new Set<string>(),
      nowMs: NOW,
      onRevoke: noop,
    })
  );

  test('renders names, never, expired and policy chips', () => {
    expect(html).toContain('mac-pro-m1');
    expect(html).toContain('old-ci');
    expect(html).toContain('Never');
    expect(html).toContain('Expired');
    expect(html).toContain('All models');
    expect(html).toContain('claude-fable-*');
    expect(html).toContain('<th scope="row"');
  });

  test('revoke buttons name the key', () => {
    expect(html).toContain('aria-label="Revoke key mac-pro-m1"');
    expect(html).toContain('aria-label="Revoke key old-ci"');
  });

  test('points to keys managed in the configuration', () => {
    expect(html).toContain('Client keys managed in the configuration: 1.');
    expect(html).toContain('href="/config"');
  });
});

describe('ModelMatrix', () => {
  const html = render(
    createElement(ModelMatrix, {
      policies: POLICIES,
      credentials: [WORK, CODEX],
      catalog: CATALOG,
      catalogProgress: null,
      catalogFailures: [],
      credentialsError: null,
      pending: new Map(),
      cellErrors: new Map(),
      nowMs: NOW,
      theme: 'light',
      canIssue: true,
      onIssue: noop,
      onRetryCatalog: noop,
      onEditPolicy: noop,
      applyPolicyChange: () => true,
    })
  );
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  const checkboxes = inputs.filter((input) => input.includes('type="checkbox"'));

  test('is a labelled grid with grouped, titled model headers', () => {
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="Model access per client key"');
    for (const id of CATALOG.ids) {
      expect(html).toMatch(new RegExp(`<th scope="col"[^>]*title="${id}"`));
    }
    expect(html).toMatch(/<th scope="colgroup" colSpan="2"/i);
  });

  test('has exactly one cell in the tab order', () => {
    expect(checkboxes).toHaveLength(POLICIES.length * CATALOG.ids.length);
    expect(checkboxes.filter((input) => input.includes('tabindex="0"'))).toHaveLength(1);
  });

  test('locked cells stay focusable and explain the pattern', () => {
    const fable = checkboxes.find((input) =>
      input.includes('aria-label="mac-pro-m1, claude-fable-5')
    );
    expect(fable).toContain('aria-disabled="true"');
    expect(fable).toContain('blocked by pattern claude-fable-*');
    expect(checkboxes.some((input) => input.includes('disabled=""'))).toBe(false);
    const outside = checkboxes.find((input) => input.includes('aria-label="ci-runner, gpt-5,'));
    expect(outside).toContain('outside the allowlist');
  });

  test('read-only rows have no toggleable cell', () => {
    const unnamed = checkboxes.filter((input) => input.includes('aria-label="Unnamed key #3'));
    expect(unnamed).toHaveLength(CATALOG.ids.length);
    expect(unnamed.every((input) => input.includes('aria-disabled="true"'))).toBe(true);
  });
});

describe('ModelMatrix block-all banners', () => {
  const duplicates = [
    policy(0, 'dup', { excludedModels: ['*'] }),
    policy(1, 'dup', { excludedModels: ['**'] }),
    policy(2, 'open'),
  ];

  test('duplicate names get distinct banner ids', () => {
    const banners = blockAllBanners(i18n.t, duplicates);
    expect(banners.map((banner) => banner.key)).toEqual(['dup', 'dup']);
    expect(new Set(banners.map((banner) => banner.id)).size).toBe(2);
  });

  test('every blocked key gets its own banner', () => {
    const html = render(
      createElement(ModelMatrix, {
        policies: duplicates,
        credentials: [WORK, CODEX],
        catalog: CATALOG,
        catalogProgress: null,
        catalogFailures: [],
        credentialsError: null,
        pending: new Map(),
        cellErrors: new Map(),
        nowMs: NOW,
        theme: 'light',
        canIssue: true,
        onIssue: noop,
        onRetryCatalog: noop,
        onEditPolicy: noop,
        applyPolicyChange: () => true,
      })
    );
    expect(html.match(/dup blocks every model/g)).toHaveLength(2);
  });
});

describe('CredentialsPanel', () => {
  const html = render(
    createElement(CredentialsPanel, {
      policies: POLICIES,
      credentials: [WORK, CODEX],
      credentialsError: null,
      selectedKey: 'mac-pro-m1',
      pending: new Map(),
      cellErrors: new Map(),
      onSelectKey: noop,
      onEditPatterns: noop,
      onReload: noop,
      applyPolicyChange: () => true,
    })
  );

  test('shows the email as primary text and the file name only as secondary', () => {
    expect(html).toContain('>work@example.com</span>');
    expect(html).toContain('title="claude-work.json">claude-work</span>');
    expect(html).not.toContain('>claude-work.json<');
    expect(html).toContain('>me@example.com</span>');
  });

  test('never renders account fields', () => {
    expect(html).not.toContain('secret-account-value');
    expect(html.toLowerCase()).not.toContain('account');
  });

  test('labels every toggle with key and credential', () => {
    expect(html).toContain('aria-label="mac-pro-m1 may use work@example.com"');
  });
});

describe('IssueKeyReveal', () => {
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(IssueKeyReveal, {
        secret: 'sk-fleet-FAKE',
        acknowledged: false,
        onAcknowledge: noop,
      }),
      createElement(IssueKeyRevealFooter, { acknowledged: false, onDone: noop })
    )
  );

  test('shows the full secret read-only with the one-time warning', () => {
    const input = html.match(/<input[^>]*value="sk-fleet-FAKE"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('readOnly=""');
    expect(html).toContain('This is the only time the key is shown.');
    expect(html).toContain('I have stored this key');
  });

  test('the Copy button is described by the one-time warning', () => {
    const describedBy = html.match(/<button[^>]*aria-describedby="([^"]+)"/)?.[1] ?? '';
    expect(describedBy).not.toBe('');
    expect(html).toContain(`<p id="${describedBy}">This is the only time the key is shown.`);
  });

  test('Done stays disabled until acknowledged', () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>Done<\/span><\/button>/);
  });
});

describe('ClientKeysTabs', () => {
  const html = renderToStaticMarkup(
    createElement(ClientKeysTabs, { active: 'matrix', keyCount: 4, onChange: noop })
  );

  test('is a tablist with roving tabindex', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Keys (4)');
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((tab) => tab.includes('aria-selected="true"'))).toHaveLength(1);
    expect(tabs.find((tab) => tab.includes('aria-selected="true"'))).toContain('tabindex="0"');
    expect(tabs.filter((tab) => tab.includes('tabindex="-1"'))).toHaveLength(2);
  });
});

describe('grid keyboard', () => {
  test('arrows stop at edges and Home/End respect the modifier', () => {
    const from = { row: 1, col: 1 };
    expect(nextGridPosition('ArrowLeft', false, { row: 0, col: 0 }, 3, 4)).toEqual({
      row: 0,
      col: 0,
    });
    expect(nextGridPosition('ArrowRight', false, from, 3, 4)).toEqual({ row: 1, col: 2 });
    expect(nextGridPosition('ArrowDown', false, { row: 2, col: 0 }, 3, 4)).toEqual({
      row: 2,
      col: 0,
    });
    expect(nextGridPosition('Home', false, from, 3, 4)).toEqual({ row: 1, col: 0 });
    expect(nextGridPosition('End', true, from, 3, 4)).toEqual({ row: 2, col: 3 });
    expect(nextGridPosition('Enter', false, from, 3, 4)).toBeNull();
  });
});

describe('KeyPolicySheet', () => {
  const html = renderToStaticMarkup(
    createElement(KeyPolicySheet, {
      open: true,
      policy: POLICIES[1],
      policies: POLICIES,
      credentials: [WORK, CODEX],
      catalog: CATALOG,
      focusSection: 'models',
      pending: new Map(),
      cellErrors: new Map([
        [patternCellId('ci-runner', 'models', 'claude-*'), 'Could not save claude-*'],
      ]),
      expiresLabel: 'Never',
      applyPolicyChange: () => true,
      onClose: noop,
    })
  );
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

  test('every id is unique', () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  test('every text input has a label pointing at it', () => {
    const inputs = [...html.matchAll(/<input[^>]*\sid="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    expect(inputs).toHaveLength(4);
    for (const id of inputs) {
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test('sections are labelled by their headings', () => {
    const labelledBy = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(labelledBy).toHaveLength(2);
    for (const id of labelledBy) {
      expect(html).toMatch(new RegExp(`<h3[^>]*id="${id}"`));
    }
  });

  test('shows a failed pattern change next to its editor', () => {
    expect(html).toContain('<div class="error-box">Could not save claude-*</div>');
  });
});

describe('queued pattern changes', () => {
  const removalOf = (value: string) => patternCellId('k', 'models', value);

  test('the open-access guard sees removals that are still pending', () => {
    const values = ['model-a', 'model-b'];
    expect(policyGuardKey('models', values, 'remove', 'model-b')).toBeNull();
    const projected = projectPatternList(
      values,
      pendingPatternValues([removalOf('model-a')], 'k', 'models')
    );
    expect(projected).toEqual(['model-b']);
    expect(policyGuardKey('models', projected, 'remove', 'model-b')).toBe(
      'client_keys.sheet.last_allow_warning'
    );
  });

  test('pending additions count towards the projected list', () => {
    const projected = projectPatternList(
      ['model-a'],
      pendingPatternValues([removalOf('model-b'), 'p\u0001other\u0001models\u0001x'], 'k', 'models')
    );
    expect(projected).toEqual(['model-a', 'model-b']);
    expect(policyGuardKey('models', projected, 'remove', 'model-a')).toBeNull();
  });
});

describe('policy guards', () => {
  test('warn before widening or narrowing access', () => {
    expect(policyGuardKey('models', [], 'add', 'claude-*')).toBe(
      'client_keys.sheet.first_allow_warning'
    );
    expect(policyGuardKey('models', ['*'], 'add', 'claude-*')).toBeNull();
    expect(policyGuardKey('models', ['claude-*'], 'remove', 'claude-*')).toBe(
      'client_keys.sheet.last_allow_warning'
    );
    expect(policyGuardKey('models', ['*', 'x'], 'remove', '*')).toBe(
      'client_keys.sheet.star_removal_warning'
    );
    expect(policyGuardKey('excludedModels', [], 'add', '*')).toBe(
      'client_keys.sheet.block_all_warning'
    );
    expect(policyGuardKey('excludedCredentials', [], 'add', 'x*')).toBeNull();
    expect(policyGuardKey('credentials', [], 'add', 'work')).toBe(
      'client_keys.sheet.first_allow_cred_warning'
    );
  });
});
