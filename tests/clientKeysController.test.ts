import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  createClientKeysController,
  type ClientKeysDeps,
} from '../src/features/clientKeys/clientKeysController';
import { patternCellId, queuedPolicyGuardKey } from '../src/features/clientKeys/presentation';
import type {
  ClientKeyPolicy,
  IssuedKey,
  PolicyCredential,
  PolicyPatch,
} from '../src/types/clientKeys';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const manual = <T>() => {
  const waiting: Deferred<T>[] = [];
  return {
    waiting,
    call: () => {
      const next = deferred<T>();
      waiting.push(next);
      return next.promise;
    },
  };
};

const policy = (index: number, name: string, models: string[] = []): ClientKeyPolicy => ({
  index,
  name,
  issuedBy: 'management',
  expiresAt: '',
  expiresAtMs: null,
  hasPolicy: true,
  models,
  excludedModels: [],
  credentials: [],
  excludedCredentials: [],
});

const issued = (name: string): IssuedKey => ({
  name,
  issuedBy: 'management',
  createdAt: '',
  createdAtMs: null,
  expiresAt: '',
  expiresAtMs: null,
  models: ['*'],
  excludedModels: [],
});

const credential = (name: string): PolicyCredential => ({
  name,
  id: name,
  label: '',
  provider: 'claude',
  displayName: name,
  secondaryName: null,
  runtimeOnly: false,
  disabled: false,
  writeToken: name,
  identityNames: [name],
});

const translate = ((key: string) => key) as unknown as TFunction;

interface CatalogCall {
  names: readonly string[];
  onResult: (name: string, models: string[] | null) => void;
}

function setup(overrides: Partial<ClientKeysDeps> = {}) {
  const env = { revision: 1 };
  const catalogCalls: CatalogCall[] = [];
  const patches: { name: string; patch: PolicyPatch; reply: Deferred<ClientKeyPolicy> }[] = [];
  const notifications: string[] = [];
  const deps: ClientKeysDeps = {
    listIssued: async () => [],
    listPolicies: async () => [policy(0, 'k'), policy(1, 'j')],
    listCredentials: async () => [],
    loadCredentialModels: (names, onResult) => {
      catalogCalls.push({ names, onResult });
      return new Promise(() => {});
    },
    issue: async (input) => ({ key: issued(input.name), secret: 'sk-fleet-FAKE' }),
    revoke: async () => 1,
    patchPolicy: (name, patch) => {
      const reply = deferred<ClientKeyPolicy>();
      patches.push({ name, patch, reply });
      return reply.promise;
    },
    connectionRevision: () => env.revision,
    translate: () => translate,
    notifyError: (message) => notifications.push(message),
    keysChanged: () => {},
    ...overrides,
  };
  const controller = createClientKeysController(deps);
  return { controller, env, catalogCalls, patches, notifications };
}

const names = (entries: { name: string }[]) => entries.map((entry) => entry.name);

describe('client keys controller: list ordering', () => {
  test('an older refresh never overwrites the response of a newer one', async () => {
    const issuedCalls = manual<IssuedKey[]>();
    const policyCalls = manual<ClientKeyPolicy[]>();
    const { controller } = setup({ listIssued: issuedCalls.call, listPolicies: policyCalls.call });
    controller.start(true);
    issuedCalls.waiting[0].resolve([issued('a'), issued('b')]);
    policyCalls.waiting[0].resolve([policy(0, 'a'), policy(1, 'b')]);
    await flush();
    expect(names(controller.getSnapshot().policies)).toEqual(['a', 'b']);

    await controller.issueKey({ name: 'c', ttl: null, models: ['*'] });
    const revoked = controller.revokeKey('b');
    await flush();
    expect(issuedCalls.waiting).toHaveLength(3);

    issuedCalls.waiting[2].resolve([issued('a'), issued('c')]);
    policyCalls.waiting[2].resolve([policy(0, 'a'), policy(1, 'c')]);
    await revoked;
    expect(names(controller.getSnapshot().policies)).toEqual(['a', 'c']);

    issuedCalls.waiting[1].resolve([issued('a'), issued('b'), issued('c')]);
    policyCalls.waiting[1].resolve([policy(0, 'a'), policy(1, 'b'), policy(2, 'c')]);
    await flush();
    expect(names(controller.getSnapshot().policies)).toEqual(['a', 'c']);
    expect(names(controller.getSnapshot().issuedKeys)).toEqual(['a', 'c']);
  });

  test('a reload that started before an issue does not hide the issued key', async () => {
    const issuedCalls = manual<IssuedKey[]>();
    const policyCalls = manual<ClientKeyPolicy[]>();
    const { controller } = setup({ listIssued: issuedCalls.call, listPolicies: policyCalls.call });
    controller.start(true);
    issuedCalls.waiting[0].resolve([issued('existing')]);
    policyCalls.waiting[0].resolve([policy(0, 'existing')]);
    await flush();

    void controller.load();
    await controller.issueKey({ name: 'new-key', ttl: null, models: ['*'] });
    issuedCalls.waiting[2].resolve([issued('existing'), issued('new-key')]);
    policyCalls.waiting[2].resolve([policy(0, 'existing'), policy(1, 'new-key')]);
    await flush();
    expect(names(controller.getSnapshot().policies)).toEqual(['existing', 'new-key']);

    issuedCalls.waiting[1].resolve([issued('existing')]);
    policyCalls.waiting[1].resolve([policy(0, 'existing')]);
    await flush();
    expect(names(controller.getSnapshot().policies)).toEqual(['existing', 'new-key']);
    expect(controller.getSnapshot().status).toBe('ready');
  });
});

describe('client keys controller: model catalog', () => {
  const twoCredentials = async () => [credential('c1'), credential('c2')];

  test('a retry racing a reload never publishes a partial catalog', async () => {
    const { controller, catalogCalls } = setup({ listCredentials: twoCredentials });
    controller.start(true);
    await flush();
    catalogCalls[0].onResult('c1', ['m1']);
    catalogCalls[0].onResult('c2', null);
    expect(controller.getSnapshot().catalogModels).toEqual({ c1: ['m1'], c2: null });

    controller.retryCatalog();
    expect(catalogCalls[1].names).toEqual(['c2']);
    void controller.load();
    await flush();
    expect(catalogCalls[2].names).toEqual(['c1', 'c2']);
    expect(controller.getSnapshot().catalogProgress).toEqual({ done: 0, total: 2 });

    catalogCalls[1].onResult('c2', ['m2-retry']);
    expect(controller.getSnapshot().catalogProgress).toEqual({ done: 0, total: 2 });
    expect(controller.getSnapshot().catalogModels).toEqual({ c1: ['m1'], c2: null });

    catalogCalls[2].onResult('c1', ['m1']);
    catalogCalls[2].onResult('c2', ['m2']);
    expect(controller.getSnapshot().catalogProgress).toBeNull();
    expect(controller.getSnapshot().catalogModels).toEqual({ c1: ['m1'], c2: ['m2'] });
  });

  test('a retry completes on top of the loaded catalog', async () => {
    const { controller, catalogCalls } = setup({ listCredentials: twoCredentials });
    controller.start(true);
    await flush();
    catalogCalls[0].onResult('c1', ['m1']);
    catalogCalls[0].onResult('c2', null);
    controller.retryCatalog();
    expect(controller.getSnapshot().catalogProgress).toEqual({ done: 0, total: 1 });
    catalogCalls[1].onResult('c2', ['m2']);
    expect(controller.getSnapshot().catalogProgress).toBeNull();
    expect(controller.getSnapshot().catalogModels).toEqual({ c1: ['m1'], c2: ['m2'] });
  });

  test('a reload whose credential list fails ends the catalog progress', async () => {
    let failCredentials = false;
    const { controller, catalogCalls } = setup({
      listCredentials: async () => {
        if (failCredentials) throw Object.assign(new Error('boom'), { status: 500 });
        return [credential('c1'), credential('c2')];
      },
    });
    controller.start(true);
    await flush();
    catalogCalls[0].onResult('c1', ['m1']);
    expect(controller.getSnapshot().catalogProgress).toEqual({ done: 1, total: 2 });

    failCredentials = true;
    await controller.load();
    const afterFailure = controller.getSnapshot();
    expect(afterFailure.catalogProgress).toBeNull();
    expect(afterFailure.catalogModels).toEqual({});
    expect(afterFailure.credentialsError).toBe('boom');
    expect(afterFailure.status).toBe('ready');

    catalogCalls[0].onResult('c2', ['m2']);
    expect(controller.getSnapshot().catalogProgress).toBeNull();
    expect(controller.getSnapshot().catalogModels).toEqual({});
  });
});

describe('client keys controller: policy changes', () => {
  const change = (keyName: string, cell: string, onSettled?: (saved: boolean) => void) => ({
    keyName,
    cellIds: [cell],
    patch: { add: { excludedModels: [cell] } },
    announce: `${keyName}:${cell}`,
    onSettled,
  });

  test('queued patches never reach the server of the next session', async () => {
    const { controller, env, patches } = setup();
    controller.start(true);
    await flush();
    const settled: boolean[] = [];
    expect(controller.applyPolicyChange(change('k', 'a', (saved) => settled.push(saved)))).toBe(
      true
    );
    expect(controller.applyPolicyChange(change('k', 'b', (saved) => settled.push(saved)))).toBe(
      true
    );
    await flush();
    expect(patches).toHaveLength(1);

    controller.stop();
    env.revision += 1;
    controller.start(true);
    await flush();
    patches[0].reply.reject(new DOMException('changed', 'AbortError'));
    await flush();
    await flush();

    expect(patches).toHaveLength(1);
    expect(settled).toEqual([false, false]);
    expect(controller.getSnapshot().pending.size).toBe(0);
  });

  test('a revision change alone stops queued patches', async () => {
    const { controller, env, patches } = setup();
    controller.start(true);
    await flush();
    controller.applyPolicyChange(change('k', 'a'));
    controller.applyPolicyChange(change('k', 'b'));
    await flush();
    env.revision += 1;
    patches[0].reply.resolve(policy(0, 'k'));
    await flush();
    await flush();
    expect(patches).toHaveLength(1);
  });

  test('pending cells clear exactly when their own patch settles', async () => {
    const { controller, patches } = setup();
    controller.start(true);
    await flush();
    controller.applyPolicyChange(change('k', 'a'));
    controller.applyPolicyChange(change('j', 'b'));
    await flush();
    patches[0].reply.resolve(policy(0, 'k'));
    patches[1].reply.resolve(policy(1, 'j'));
    await flush();
    expect(controller.applyPolicyChange(change('k', 'c'))).toBe(true);
    expect([...controller.getSnapshot().pending.keys()]).toEqual(['c']);
    expect(controller.applyPolicyChange(change('k', 'c'))).toBe(false);
  });

  test('a failed patch keeps the cell error and reports onSettled(false)', async () => {
    const { controller, patches, notifications } = setup();
    controller.start(true);
    await flush();
    const settled: boolean[] = [];
    controller.applyPolicyChange(change('k', 'a', (saved) => settled.push(saved)));
    await flush();
    patches[0].reply.reject(
      Object.assign(new Error('bad'), { status: 400, apiCode: 'invalid_config' })
    );
    await flush();
    expect(settled).toEqual([false]);
    expect(controller.getSnapshot().cellErrors.get('a')).toBe('client_keys.errors.invalid_config');
    expect(notifications).toEqual(['client_keys.errors.invalid_config']);
  });

  test('changes are refused before the lists are ready', () => {
    const { controller } = setup({ listPolicies: () => new Promise(() => {}) });
    controller.start(true);
    expect(controller.applyPolicyChange(change('k', 'a'))).toBe(false);
  });
});

describe('client keys controller: allowlist guard with queued changes', () => {
  const patternChange = (op: 'add' | 'remove', value: string) => ({
    keyName: 'k',
    cellIds: [patternCellId('k', 'models', value)],
    patch: { [op]: { models: [value] } },
    announce: `${op}:${value}`,
  });

  test('a removal behind a held addition still warns, so a failed addition cannot open access silently', async () => {
    const { controller, patches } = setup({
      listPolicies: async () => [policy(0, 'k', ['a'])],
    });
    controller.start(true);
    await flush();
    const guard = (op: 'add' | 'remove', value: string) => {
      const snapshot = controller.getSnapshot();
      const current = snapshot.policies.find((entry) => entry.name === 'k');
      if (!current) throw new Error('policy k missing');
      return queuedPolicyGuardKey(current, 'models', snapshot.pending.keys(), op, value);
    };

    expect(controller.applyPolicyChange(patternChange('add', 'b'))).toBe(true);
    await flush();
    expect(patches).toHaveLength(1);

    expect(guard('remove', 'a')).toBe('client_keys.sheet.last_allow_warning');
    expect(controller.applyPolicyChange(patternChange('remove', 'a'))).toBe(true);

    patches[0].reply.reject(Object.assign(new Error('boom'), { status: 500 }));
    await flush();
    await flush();
    expect(patches).toHaveLength(2);
    expect(patches[1].patch).toEqual({ remove: { models: ['a'] } });
    patches[1].reply.resolve(policy(0, 'k', []));
    await flush();

    expect(controller.getSnapshot().policies[0].models).toEqual([]);
    expect(guard('add', 'c')).toBe('client_keys.sheet.first_allow_warning');
  });
});

describe('client keys controller: pattern save errors', () => {
  const failedPatternChange = async () => {
    const listIssued = manual<IssuedKey[]>();
    const listPolicies = manual<ClientKeyPolicy[]>();
    const env = setup({ listIssued: listIssued.call, listPolicies: listPolicies.call });
    env.controller.start(true);
    listIssued.waiting[0].resolve([]);
    listPolicies.waiting[0].resolve([policy(0, 'k', ['a'])]);
    await flush();
    const cell = patternCellId('k', 'models', 'b');
    env.controller.applyPolicyChange({
      keyName: 'k',
      cellIds: [cell],
      patch: { add: { models: ['b'] } },
      announce: '',
    });
    await flush();
    env.patches[0].reply.reject(
      Object.assign(new Error('bad'), { status: 400, apiCode: 'invalid_config' })
    );
    await flush();
    expect(env.controller.getSnapshot().cellErrors.has(cell)).toBe(true);
    return { ...env, cell, listIssued, listPolicies };
  };

  test('a reload clears a stale pattern error', async () => {
    const { controller, cell, listIssued, listPolicies } = await failedPatternChange();
    const reloaded = controller.load();
    listIssued.waiting[1].resolve([]);
    listPolicies.waiting[1].resolve([policy(0, 'k', ['a'])]);
    await reloaded;
    expect(controller.getSnapshot().cellErrors.has(cell)).toBe(false);
  });

  test('a key refresh clears a stale pattern error', async () => {
    const { controller, cell, listIssued, listPolicies } = await failedPatternChange();
    const issued = controller.issueKey({ name: 'n', ttl: null, models: ['*'] });
    await issued;
    listIssued.waiting[1].resolve([]);
    listPolicies.waiting[1].resolve([policy(0, 'k', ['a'])]);
    await flush();
    expect(controller.getSnapshot().cellErrors.has(cell)).toBe(false);
  });

  test('dismissing a pattern error removes it', async () => {
    const { controller, cell } = await failedPatternChange();
    controller.dismissCellErrors([cell]);
    expect(controller.getSnapshot().cellErrors.has(cell)).toBe(false);
  });
});

describe('client keys controller: secrets', () => {
  test('the issued secret is returned but never stored', async () => {
    const { controller } = setup();
    controller.start(true);
    await flush();
    const result = await controller.issueKey({ name: 'n', ttl: null, models: ['*'] });
    expect(result.secret).toBe('sk-fleet-FAKE');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('sk-fleet-FAKE');
  });
});
