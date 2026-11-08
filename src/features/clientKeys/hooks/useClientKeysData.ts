import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { clientKeysApi } from '@/services/api/clientKeys';
import { routingApi } from '@/services/api/routing';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ModelCatalog } from '@/types/clientKeys';
import { createClientKeysController } from '../clientKeysController';
import { toPolicyCredential } from '../credentials';
import { buildModelCatalog } from '../matrix';

export type {
  ClientKeysStatus,
  PendingOp,
  PolicyChange,
  RevokeOutcome,
} from '../clientKeysController';

export function useClientKeysData() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connected = connectionStatus === 'connected';

  const [controller] = useState(() =>
    createClientKeysController({
      listIssued: () => clientKeysApi.listIssued(),
      listPolicies: () => clientKeysApi.listPolicies(),
      listCredentials: async () => (await authFilesApi.list()).files.map(toPolicyCredential),
      loadCredentialModels: (names, onResult) => routingApi.loadCredentialModels(names, onResult),
      issue: (input) => clientKeysApi.issue(input),
      revoke: (name) => clientKeysApi.revoke(name),
      patchPolicy: (name, patch) => clientKeysApi.patchPolicy(name, patch),
      connectionRevision: () => apiClient.getConnectionRevision(),
      translate: () => t,
      notifyError: (message) => showNotification(message, 'error'),
      keysChanged: () => useConfigStore.getState().clearCache('api-keys'),
    })
  );

  useEffect(() => {
    controller.updateDeps({
      translate: () => t,
      notifyError: (message) => showNotification(message, 'error'),
    });
  }, [controller, showNotification, t]);

  useEffect(() => {
    controller.start(connected);
    return () => controller.stop();
  }, [connected, controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  const catalog: ModelCatalog = useMemo(
    () =>
      buildModelCatalog(state.credentials, state.catalogModels, (provider) =>
        getTypeLabel(t, provider)
      ),
    [state.catalogModels, state.credentials, t]
  );
  const catalogFailures = useMemo(
    () => Object.keys(state.catalogModels).filter((name) => state.catalogModels[name] === null),
    [state.catalogModels]
  );

  return {
    status: state.status,
    connected,
    error: state.error,
    credentialsError: state.credentialsError,
    issuedKeys: state.issuedKeys,
    policies: state.policies,
    credentials: state.credentials,
    catalog,
    catalogProgress: state.catalogProgress,
    catalogFailures,
    pending: state.pending,
    cellErrors: state.cellErrors,
    revoking: state.revoking,
    announcement: state.announcement,
    reload: controller.load,
    retryCatalog: controller.retryCatalog,
    issueKey: controller.issueKey,
    revokeKey: controller.revokeKey,
    applyPolicyChange: controller.applyPolicyChange,
  };
}

export type ClientKeysData = ReturnType<typeof useClientKeysData>;
