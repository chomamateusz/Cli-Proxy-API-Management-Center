import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { clientKeysApi, serializePolicyPatch } from '@/services/api/clientKeys';
import { routingApi } from '@/services/api/routing';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type {
  ClientKeyPolicy,
  IssueKeyInput,
  IssuedKey,
  IssuedKeySecret,
  ModelCatalog,
  PolicyCredential,
  PolicyPatch,
} from '@/types/clientKeys';
import { toPolicyCredential } from '../credentials';
import {
  classifyClientKeyError,
  clientKeyErrorMessage,
  type ClassifiedClientKeyError,
} from '../errors';
import { createKeyedSerialQueue } from '../keyedQueue';
import { buildModelCatalog, mergePolicies, rowReadonlyReason } from '../matrix';

export type ClientKeysStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'forbidden' | 'error';

export interface PendingOp {
  keyName: string;
}

export interface PolicyChange {
  keyName: string;
  cellIds: string[];
  patch: PolicyPatch;
  announce: string;
}

export type RevokeOutcome = { ok: true } | { ok: false; error: ClassifiedClientKeyError };

type CatalogModels = Record<string, string[] | null>;

const EMPTY_PENDING: ReadonlyMap<string, PendingOp> = new Map();
const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map();

const withEntries = <V>(map: ReadonlyMap<string, V>, ids: string[], value: V | null) => {
  const next = new Map(map);
  ids.forEach((id) => (value === null ? next.delete(id) : next.set(id, value)));
  return next;
};

export function useClientKeysData() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connected = connectionStatus === 'connected';

  const [status, setStatus] = useState<ClientKeysStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [issuedKeys, setIssuedKeys] = useState<IssuedKey[]>([]);
  const [policies, setPolicies] = useState<ClientKeyPolicy[]>([]);
  const [credentials, setCredentials] = useState<PolicyCredential[]>([]);
  const [catalogModels, setCatalogModels] = useState<CatalogModels>({});
  const [catalogProgress, setCatalogProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [pending, setPending] = useState<ReadonlyMap<string, PendingOp>>(EMPTY_PENDING);
  const [cellErrors, setCellErrors] = useState<ReadonlyMap<string, string>>(EMPTY_ERRORS);
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');

  const tRef = useRef(t);
  const requestRef = useRef(0);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef(status);
  const policiesRef = useRef(policies);
  const pendingRef = useRef(pending);
  const modelsRef = useRef<CatalogModels>({});
  const stampCounterRef = useRef(0);
  const stampsRef = useRef(new Map<string, number>());
  const queueRef = useRef(createKeyedSerialQueue());

  useEffect(() => {
    tRef.current = t;
    statusRef.current = status;
    policiesRef.current = policies;
    pendingRef.current = pending;
  });

  const sessionGuard = useCallback(() => {
    const revision = apiClient.getConnectionRevision();
    const generation = generationRef.current;
    return () =>
      mountedRef.current &&
      generation === generationRef.current &&
      revision === apiClient.getConnectionRevision();
  }, []);

  const loadCatalog = useCallback((names: string[], isCurrent: () => boolean) => {
    if (names.length === 0) {
      setCatalogProgress(null);
      setCatalogModels({ ...modelsRef.current });
      return;
    }
    let done = 0;
    setCatalogProgress({ done, total: names.length });
    void routingApi.loadCredentialModels(names, (name, models) => {
      if (!isCurrent()) return;
      done += 1;
      modelsRef.current = { ...modelsRef.current, [name]: models };
      if (done < names.length) {
        setCatalogProgress({ done, total: names.length });
        return;
      }
      setCatalogProgress(null);
      setCatalogModels(modelsRef.current);
    });
  }, []);

  const applyLists = useCallback(
    (issued: IssuedKey[], fetched: ClientKeyPolicy[], since: number) => {
      setIssuedKeys(issued);
      setPolicies((local) => mergePolicies(fetched, local, stampsRef.current, since));
    },
    []
  );

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const sessionCurrent = sessionGuard();
    const isCurrent = () => requestId === requestRef.current && sessionCurrent();
    if (!connected) {
      setStatus('idle');
      return;
    }
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    const since = stampCounterRef.current;
    const [issued, fetched, files] = await Promise.allSettled([
      clientKeysApi.listIssued(),
      clientKeysApi.listPolicies(),
      authFilesApi.list(),
    ]);
    if (!isCurrent()) return;
    const keyFailures = [issued, fetched].flatMap((result) =>
      result.status === 'rejected' ? [classifyClientKeyError(result.reason)] : []
    );
    const blocking =
      keyFailures.find((failure) => failure.kind === 'unsupported') ??
      keyFailures.find((failure) => failure.kind === 'forbidden');
    if (blocking) {
      setStatus(blocking.kind as 'unsupported' | 'forbidden');
      return;
    }
    if (issued.status === 'rejected' || fetched.status === 'rejected') {
      setError(keyFailures[0]?.message ?? '');
      setStatus('error');
      return;
    }
    applyLists(issued.value, fetched.value, since);
    setError(null);
    if (files.status === 'rejected') {
      setCredentials([]);
      setCredentialsError(classifyClientKeyError(files.reason).message);
      setStatus('ready');
      return;
    }
    const nextCredentials = files.value.files.map(toPolicyCredential);
    setCredentials(nextCredentials);
    setCredentialsError(null);
    setStatus('ready');
    modelsRef.current = {};
    loadCatalog(
      nextCredentials.map((credential) => credential.name),
      isCurrent
    );
  }, [applyLists, connected, loadCatalog, sessionGuard]);

  const retryCatalog = useCallback(() => {
    const failed = Object.keys(modelsRef.current).filter(
      (name) => modelsRef.current[name] === null
    );
    loadCatalog(failed, sessionGuard());
  }, [loadCatalog, sessionGuard]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    modelsRef.current = {};
    stampsRef.current = new Map();
    queueRef.current = createKeyedSerialQueue();
    setStatus('idle');
    setError(null);
    setCredentialsError(null);
    setIssuedKeys([]);
    setPolicies([]);
    setCredentials([]);
    setCatalogModels({});
    setCatalogProgress(null);
    setPending(EMPTY_PENDING);
    setCellErrors(EMPTY_ERRORS);
    setRevoking(new Set());
    void load();
    return () => {
      requestRef.current += 1;
      generationRef.current += 1;
      mountedRef.current = false;
    };
  }, [load]);

  const refreshKeys = useCallback(async () => {
    const isCurrent = sessionGuard();
    const since = stampCounterRef.current;
    try {
      const [issued, fetched] = await Promise.all([
        clientKeysApi.listIssued(),
        clientKeysApi.listPolicies(),
      ]);
      if (isCurrent()) applyLists(issued, fetched, since);
    } catch (err) {
      if (!isCurrent()) return;
      const classified = classifyClientKeyError(err);
      if (classified.kind === 'connection_changed') return;
      showNotification(clientKeyErrorMessage(tRef.current, classified), 'error');
    }
  }, [applyLists, sessionGuard, showNotification]);

  const issueKey = useCallback(
    async (input: IssueKeyInput): Promise<IssuedKeySecret> => {
      const isCurrent = sessionGuard();
      const result = await clientKeysApi.issue(input);
      if (isCurrent()) {
        useConfigStore.getState().clearCache('api-keys');
        setAnnouncement(tRef.current('client_keys.announce.key_issued', { name: result.key.name }));
        void refreshKeys();
      }
      return result;
    },
    [refreshKeys, sessionGuard]
  );

  const revokeKey = useCallback(
    async (name: string): Promise<RevokeOutcome> => {
      const isCurrent = sessionGuard();
      setRevoking((current) => new Set(current).add(name));
      try {
        await clientKeysApi.revoke(name);
        if (isCurrent()) {
          useConfigStore.getState().clearCache('api-keys');
          setAnnouncement(tRef.current('client_keys.announce.key_revoked', { name }));
          await refreshKeys();
        }
        return { ok: true };
      } catch (err) {
        const classified = classifyClientKeyError(err);
        if (classified.kind === 'not_found' && isCurrent()) void refreshKeys();
        return { ok: false, error: classified };
      } finally {
        if (isCurrent()) {
          setRevoking((current) => {
            const next = new Set(current);
            next.delete(name);
            return next;
          });
        }
      }
    },
    [refreshKeys, sessionGuard]
  );

  const applyPolicyChange = useCallback(
    ({ keyName, cellIds, patch, announce }: PolicyChange): boolean => {
      if (statusRef.current !== 'ready') return false;
      if (cellIds.some((id) => pendingRef.current.has(id))) return false;
      const all = policiesRef.current;
      const policy = all.find((entry) => entry.name === keyName);
      if (!policy || rowReadonlyReason(policy, all) !== null) return false;
      try {
        if (serializePolicyPatch(patch) === null) return false;
      } catch {
        return false;
      }
      const isCurrent = sessionGuard();
      pendingRef.current = withEntries(pendingRef.current, cellIds, { keyName });
      setPending(pendingRef.current);
      setCellErrors((current) => withEntries(current, cellIds, null));
      void queueRef.current
        .run(keyName, () => clientKeysApi.patchPolicy(keyName, patch))
        .then(
          (updated) => {
            if (!isCurrent()) return;
            stampCounterRef.current += 1;
            stampsRef.current.set(keyName, stampCounterRef.current);
            setPolicies((current) =>
              current.map((entry) => (entry.name === keyName ? updated : entry))
            );
            setIssuedKeys((current) =>
              current.map((key) =>
                key.name === keyName
                  ? { ...key, models: updated.models, excludedModels: updated.excludedModels }
                  : key
              )
            );
            useConfigStore.getState().clearCache('api-keys');
            setAnnouncement(announce);
          },
          (err: unknown) => {
            if (!isCurrent()) return;
            const classified = classifyClientKeyError(err);
            if (classified.kind === 'connection_changed') return;
            const message = clientKeyErrorMessage(tRef.current, classified, { name: keyName });
            showNotification(message, 'error');
            if (classified.kind === 'not_found' || classified.kind === 'ambiguous_name') {
              void load();
              return;
            }
            setCellErrors((current) => withEntries(current, cellIds, message));
            setAnnouncement(message);
          }
        )
        .finally(() => {
          if (!isCurrent()) return;
          pendingRef.current = withEntries(pendingRef.current, cellIds, null);
          setPending(pendingRef.current);
        });
      return true;
    },
    [load, sessionGuard, showNotification]
  );

  const catalog: ModelCatalog = useMemo(
    () => buildModelCatalog(credentials, catalogModels, (provider) => getTypeLabel(t, provider)),
    [catalogModels, credentials, t]
  );
  const catalogFailures = useMemo(
    () => Object.keys(catalogModels).filter((name) => catalogModels[name] === null),
    [catalogModels]
  );

  return {
    status,
    connected,
    error,
    credentialsError,
    issuedKeys,
    policies,
    credentials,
    catalog,
    catalogProgress,
    catalogFailures,
    pending,
    cellErrors,
    revoking,
    announcement,
    reload: load,
    retryCatalog,
    issueKey,
    revokeKey,
    applyPolicyChange,
  };
}

export type ClientKeysData = ReturnType<typeof useClientKeysData>;
