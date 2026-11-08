import type { TFunction } from 'i18next';
import { serializePolicyPatch } from '@/services/api/clientKeys';
import type {
  ClientKeyPolicy,
  IssueKeyInput,
  IssuedKey,
  IssuedKeySecret,
  PolicyCredential,
  PolicyPatch,
} from '@/types/clientKeys';
import {
  classifyClientKeyError,
  clientKeyErrorMessage,
  type ClassifiedClientKeyError,
} from './errors';
import { createKeyedSerialQueue } from './keyedQueue';
import { mergePolicies, rowReadonlyReason } from './matrix';

export type ClientKeysStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'forbidden' | 'error';

export interface PendingOp {
  keyName: string;
}

export interface PolicyChange {
  keyName: string;
  cellIds: string[];
  patch: PolicyPatch;
  announce: string;
  onSettled?: (saved: boolean) => void;
}

export type RevokeOutcome = { ok: true } | { ok: false; error: ClassifiedClientKeyError };

export type CatalogModels = Record<string, string[] | null>;

export interface ClientKeysState {
  status: ClientKeysStatus;
  error: string | null;
  credentialsError: string | null;
  issuedKeys: IssuedKey[];
  policies: ClientKeyPolicy[];
  credentials: PolicyCredential[];
  catalogModels: CatalogModels;
  catalogProgress: { done: number; total: number } | null;
  pending: ReadonlyMap<string, PendingOp>;
  cellErrors: ReadonlyMap<string, string>;
  revoking: ReadonlySet<string>;
  announcement: string;
}

export interface ClientKeysDeps {
  listIssued: () => Promise<IssuedKey[]>;
  listPolicies: () => Promise<ClientKeyPolicy[]>;
  listCredentials: () => Promise<PolicyCredential[]>;
  loadCredentialModels: (
    names: readonly string[],
    onResult: (name: string, models: string[] | null) => void
  ) => Promise<void>;
  issue: (input: IssueKeyInput) => Promise<IssuedKeySecret>;
  revoke: (name: string) => Promise<unknown>;
  patchPolicy: (name: string, patch: PolicyPatch) => Promise<ClientKeyPolicy>;
  connectionRevision: () => number;
  translate: () => TFunction;
  notifyError: (message: string) => void;
  keysChanged: () => void;
}

const EMPTY_PENDING: ReadonlyMap<string, PendingOp> = new Map();
const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map();
const EMPTY_REVOKING: ReadonlySet<string> = new Set();

export const initialClientKeysState = (): ClientKeysState => ({
  status: 'idle',
  error: null,
  credentialsError: null,
  issuedKeys: [],
  policies: [],
  credentials: [],
  catalogModels: {},
  catalogProgress: null,
  pending: EMPTY_PENDING,
  cellErrors: EMPTY_ERRORS,
  revoking: EMPTY_REVOKING,
  announcement: '',
});

const withEntries = <V>(map: ReadonlyMap<string, V>, ids: string[], value: V | null) => {
  const next = new Map(map);
  ids.forEach((id) => (value === null ? next.delete(id) : next.set(id, value)));
  return next;
};

const connectionChangedError = () =>
  new DOMException('The management connection changed.', 'AbortError');

function createRequestSequence() {
  let latest = 0;
  return () => {
    const id = ++latest;
    return () => id === latest;
  };
}

export function createClientKeysController(initialDeps: ClientKeysDeps) {
  let deps = initialDeps;
  let state = initialClientKeysState();
  const listeners = new Set<() => void>();
  let connected = false;
  let active = false;
  let generation = 0;
  let queue = createKeyedSerialQueue();
  let stampCounter = 0;
  let stamps = new Map<string, number>();
  // Lists (issued keys + policies) are written by load and refreshKeys; the model catalog by
  // load and retryCatalog. Separate sequences keep an issue-triggered refresh from stranding a
  // catalog load that is still in progress.
  const nextLoad = createRequestSequence();
  const nextLists = createRequestSequence();
  const nextCatalog = createRequestSequence();

  const emit = () => listeners.forEach((listener) => listener());

  const update = (
    patch: Partial<ClientKeysState> | ((current: ClientKeysState) => Partial<ClientKeysState>)
  ) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    emit();
  };

  const sessionGuard = () => {
    const revision = deps.connectionRevision();
    const owner = generation;
    return () => active && owner === generation && revision === deps.connectionRevision();
  };

  const runCatalog = (names: string[], base: CatalogModels, isCurrent: () => boolean) => {
    if (names.length === 0) {
      update({ catalogProgress: null, catalogModels: base });
      return;
    }
    const models: CatalogModels = { ...base };
    let done = 0;
    update({ catalogProgress: { done, total: names.length } });
    void deps.loadCredentialModels(names, (name, result) => {
      if (!isCurrent()) return;
      done += 1;
      models[name] = result;
      update(
        done < names.length
          ? { catalogProgress: { done, total: names.length } }
          : { catalogProgress: null, catalogModels: { ...models } }
      );
    });
  };

  const clearCatalog = (): Partial<ClientKeysState> => {
    nextCatalog();
    return { catalogProgress: null, catalogModels: {} };
  };

  const applyLists = (issued: IssuedKey[], fetched: ClientKeyPolicy[], since: number) =>
    update((current) => ({
      issuedKeys: issued,
      policies: mergePolicies(fetched, current.policies, stamps, since),
    }));

  const load = async (): Promise<void> => {
    const loadCurrent = nextLoad();
    const listsCurrent = nextLists();
    const sessionCurrent = sessionGuard();
    if (!connected) {
      update({ status: 'idle' });
      return;
    }
    if (state.status !== 'ready') update({ status: 'loading' });
    const since = stampCounter;
    const [issued, fetched, files] = await Promise.allSettled([
      deps.listIssued(),
      deps.listPolicies(),
      deps.listCredentials(),
    ]);
    if (!sessionCurrent() || !loadCurrent()) return;
    if (listsCurrent()) {
      const keyFailures = [issued, fetched].flatMap((result) =>
        result.status === 'rejected' ? [classifyClientKeyError(result.reason)] : []
      );
      const blocking =
        keyFailures.find((failure) => failure.kind === 'unsupported') ??
        keyFailures.find((failure) => failure.kind === 'forbidden');
      if (blocking) {
        update({ ...clearCatalog(), status: blocking.kind as 'unsupported' | 'forbidden' });
        return;
      }
      if (issued.status === 'rejected' || fetched.status === 'rejected') {
        update({ ...clearCatalog(), error: keyFailures[0]?.message ?? '', status: 'error' });
        return;
      }
      applyLists(issued.value, fetched.value, since);
      update({ error: null });
    }
    if (files.status === 'rejected') {
      update({
        ...clearCatalog(),
        credentials: [],
        credentialsError: classifyClientKeyError(files.reason).message,
        status: 'ready',
      });
      return;
    }
    update({ credentials: files.value, credentialsError: null, status: 'ready' });
    const catalogCurrent = nextCatalog();
    runCatalog(
      files.value.map((credential) => credential.name),
      {},
      () => sessionCurrent() && catalogCurrent()
    );
  };

  const retryCatalog = () => {
    if (state.catalogProgress !== null) return;
    const base = state.catalogModels;
    const failed = Object.keys(base).filter((name) => base[name] === null);
    if (failed.length === 0) return;
    const sessionCurrent = sessionGuard();
    const catalogCurrent = nextCatalog();
    runCatalog(failed, base, () => sessionCurrent() && catalogCurrent());
  };

  const refreshKeys = async () => {
    const listsCurrent = nextLists();
    const sessionCurrent = sessionGuard();
    const since = stampCounter;
    try {
      const [issued, fetched] = await Promise.all([deps.listIssued(), deps.listPolicies()]);
      if (sessionCurrent() && listsCurrent()) applyLists(issued, fetched, since);
    } catch (err) {
      if (!sessionCurrent() || !listsCurrent()) return;
      const classified = classifyClientKeyError(err);
      if (classified.kind === 'connection_changed') return;
      deps.notifyError(clientKeyErrorMessage(deps.translate(), classified));
    }
  };

  const issueKey = async (input: IssueKeyInput): Promise<IssuedKeySecret> => {
    const sessionCurrent = sessionGuard();
    const result = await deps.issue(input);
    if (sessionCurrent()) {
      deps.keysChanged();
      update({
        announcement: deps.translate()('client_keys.announce.key_issued', {
          name: result.key.name,
        }),
      });
      void refreshKeys();
    }
    return result;
  };

  const revokeKey = async (name: string): Promise<RevokeOutcome> => {
    const sessionCurrent = sessionGuard();
    update((current) => ({ revoking: new Set(current.revoking).add(name) }));
    try {
      await deps.revoke(name);
      if (sessionCurrent()) {
        deps.keysChanged();
        update({ announcement: deps.translate()('client_keys.announce.key_revoked', { name }) });
        await refreshKeys();
      }
      return { ok: true };
    } catch (err) {
      const classified = classifyClientKeyError(err);
      if (classified.kind === 'not_found' && sessionCurrent()) void refreshKeys();
      return { ok: false, error: classified };
    } finally {
      if (sessionCurrent()) {
        update((current) => {
          const next = new Set(current.revoking);
          next.delete(name);
          return { revoking: next };
        });
      }
    }
  };

  const applyPolicyChange = ({
    keyName,
    cellIds,
    patch,
    announce,
    onSettled,
  }: PolicyChange): boolean => {
    if (state.status !== 'ready') return false;
    if (cellIds.some((id) => state.pending.has(id))) return false;
    const policy = state.policies.find((entry) => entry.name === keyName);
    if (!policy || rowReadonlyReason(policy, state.policies) !== null) return false;
    try {
      if (serializePolicyPatch(patch) === null) return false;
    } catch {
      return false;
    }
    const sessionCurrent = sessionGuard();
    update((current) => ({
      pending: withEntries(current.pending, cellIds, { keyName }),
      cellErrors: withEntries(current.cellErrors, cellIds, null),
    }));
    let saved = false;
    void queue
      .run(keyName, () =>
        sessionCurrent()
          ? deps.patchPolicy(keyName, patch)
          : Promise.reject(connectionChangedError())
      )
      .then(
        (updated) => {
          if (!sessionCurrent()) return;
          saved = true;
          stampCounter += 1;
          stamps.set(keyName, stampCounter);
          update((current) => ({
            policies: current.policies.map((entry) => (entry.name === keyName ? updated : entry)),
            issuedKeys: current.issuedKeys.map((key) =>
              key.name === keyName
                ? { ...key, models: updated.models, excludedModels: updated.excludedModels }
                : key
            ),
            announcement: announce,
          }));
          deps.keysChanged();
        },
        (err: unknown) => {
          if (!sessionCurrent()) return;
          const classified = classifyClientKeyError(err);
          if (classified.kind === 'connection_changed') return;
          const message = clientKeyErrorMessage(deps.translate(), classified, { name: keyName });
          deps.notifyError(message);
          if (classified.kind === 'not_found' || classified.kind === 'ambiguous_name') {
            void load();
            return;
          }
          update((current) => ({
            cellErrors: withEntries(current.cellErrors, cellIds, message),
            announcement: message,
          }));
        }
      )
      .finally(() => {
        if (sessionCurrent()) {
          update((current) => ({ pending: withEntries(current.pending, cellIds, null) }));
        }
        onSettled?.(saved);
      });
    return true;
  };

  const invalidateRequests = () => {
    nextLoad();
    nextLists();
    nextCatalog();
    queue.cancel();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: (isConnected: boolean) => {
      active = true;
      generation += 1;
      connected = isConnected;
      invalidateRequests();
      queue = createKeyedSerialQueue();
      stamps = new Map();
      state = initialClientKeysState();
      emit();
      void load();
    },
    stop: () => {
      active = false;
      generation += 1;
      invalidateRequests();
    },
    updateDeps: (next: Partial<ClientKeysDeps>) => {
      deps = { ...deps, ...next };
    },
    load,
    retryCatalog,
    issueKey,
    revokeKey,
    applyPolicyChange,
  };
}

export type ClientKeysController = ReturnType<typeof createClientKeysController>;
