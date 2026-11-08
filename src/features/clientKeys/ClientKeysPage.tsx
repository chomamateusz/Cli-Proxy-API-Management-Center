import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconPlus } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useRevealGroup } from '@/hooks/motion';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useNotificationStore, useThemeStore } from '@/stores';
import type { ClientKeyPolicy } from '@/types/clientKeys';
import { clientKeyErrorMessage } from './errors';
import { formatKeyInstant } from './formatInstant';
import { useClientKeysData } from './hooks/useClientKeysData';
import {
  clientKeysPanelId,
  clientKeysTabId,
  parseClientKeysView,
  type ClientKeysView,
  type PolicySheetSection,
} from './presentation';
import { ClientKeysTabs } from './components/ClientKeysTabs';
import { CredentialsPanel } from './components/CredentialsPanel';
import { IssueKeyDialog } from './components/IssueKeyDialog';
import { KeyPolicySheet } from './components/KeyPolicySheet';
import { KeysTable } from './components/KeysTable';
import { ModelMatrix } from './components/ModelMatrix';
import styles from './ClientKeysPage.module.scss';

interface SheetTarget {
  name: string;
  index: number;
  section: PolicySheetSection;
}

const findTarget = (policies: ClientKeyPolicy[], target: SheetTarget | null) => {
  if (!target) return null;
  if (target.name) return policies.find((policy) => policy.name === target.name) ?? null;
  return policies.find((policy) => policy.name === '' && policy.index === target.index) ?? null;
};

export function ClientKeysPage() {
  const { t, i18n } = useTranslation();
  const data = useClientKeysData();
  const nowMs = useNow();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const revealRef = useRevealGroup<HTMLDivElement>();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [issueSession, setIssueSession] = useState(0);
  const [issueOpen, setIssueOpen] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const ready = data.status === 'ready';
  const canIssue = ready && data.connected;

  useHeaderRefresh(data.reload);

  // PageTransition keeps the location of a same-path navigation frozen, so the routed page never
  // sees its own query changes; local state is the source of truth and the URL only mirrors it.
  const [view, setView] = useState<ClientKeysView>(() =>
    parseClientKeysView(searchParams.get('view'))
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(() => searchParams.get('key'));

  const syncUrl = useCallback(
    (nextView: ClientKeysView, nextKey: string | null) => {
      setView(nextView);
      setSelectedKey(nextKey);
      setSearchParams(nextKey === null ? { view: nextView } : { view: nextView, key: nextKey }, {
        replace: true,
      });
    },
    [setSearchParams]
  );

  const existingNames = useMemo(
    () =>
      new Set([...data.policies, ...data.issuedKeys].map((entry) => entry.name).filter(Boolean)),
    [data.issuedKeys, data.policies]
  );

  const openIssue = () => {
    setIssueSession((session) => session + 1);
    setIssueOpen(true);
  };

  const openSheet = (policy: ClientKeyPolicy, section: PolicySheetSection) => {
    setSheetTarget({ name: policy.name, index: policy.index, section });
    setSheetOpen(true);
  };

  const requestRevoke = (name: string) => {
    const lastKey = data.policies.length === 1;
    showConfirmation({
      title: t('client_keys.revoke.title'),
      message: (
        <div className={styles.confirmMessage}>
          <p>{t('client_keys.revoke.message', { name })}</p>
          <p className={lastKey ? styles.confirmWarning : styles.confirmNote}>
            {t(
              lastKey ? 'client_keys.revoke.last_key_warning' : 'client_keys.revoke.last_key_note'
            )}
          </p>
        </div>
      ),
      variant: 'danger',
      confirmText: t('client_keys.revoke.confirm'),
      cancelText: t('common.cancel'),
      onConfirm: async () => {
        const outcome = await data.revokeKey(name);
        if (outcome.ok) {
          showNotification(t('client_keys.revoke.success', { name }), 'success');
          window.setTimeout(() => headingRef.current?.focus(), 0);
          return;
        }
        if (outcome.error.kind === 'connection_changed') return;
        showNotification(clientKeyErrorMessage(t, outcome.error, { name }), 'error');
      },
    });
  };

  const sheetPolicy = findTarget(data.policies, sheetTarget);
  const expiresLabel = (policy: ClientKeyPolicy | null) => {
    if (!policy || policy.expiresAt === '') return t('client_keys.keys.never_expires');
    return policy.expiresAtMs === null
      ? policy.expiresAt
      : formatKeyInstant(policy.expiresAtMs, i18n.language);
  };

  const renderPanel = (active: ClientKeysView) => {
    if (active === 'keys') {
      return (
        <KeysTable
          issuedKeys={data.issuedKeys}
          policies={data.policies}
          revoking={data.revoking}
          nowMs={nowMs}
          headingRef={headingRef}
          onRevoke={requestRevoke}
        />
      );
    }
    if (active === 'matrix') {
      return (
        <ModelMatrix
          policies={data.policies}
          credentials={data.credentials}
          catalog={data.catalog}
          catalogProgress={data.catalogProgress}
          catalogFailures={data.catalogFailures}
          credentialsError={data.credentialsError}
          pending={data.pending}
          cellErrors={data.cellErrors}
          nowMs={nowMs}
          theme={resolvedTheme}
          canIssue={canIssue}
          onIssue={openIssue}
          onRetryCatalog={data.retryCatalog}
          onEditPolicy={(policy) => openSheet(policy, 'models')}
          applyPolicyChange={data.applyPolicyChange}
        />
      );
    }
    return (
      <CredentialsPanel
        policies={data.policies}
        credentials={data.credentials}
        credentialsError={data.credentialsError}
        selectedKey={selectedKey}
        pending={data.pending}
        cellErrors={data.cellErrors}
        onSelectKey={(value) => syncUrl('credentials', value)}
        onEditPatterns={(policy) => openSheet(policy, 'credentials')}
        onReload={() => void data.reload()}
        applyPolicyChange={data.applyPolicyChange}
      />
    );
  };

  const renderBody = () => {
    if (!data.connected) return <EmptyState title={t('client_keys.disconnected')} />;
    if (data.status === 'unsupported') {
      return (
        <EmptyState
          title={t('client_keys.unsupported_title')}
          description={t('client_keys.unsupported_desc')}
        />
      );
    }
    if (data.status === 'forbidden') {
      return (
        <EmptyState
          title={t('client_keys.forbidden_title')}
          description={t('client_keys.forbidden_desc')}
        />
      );
    }
    if (data.status === 'error') {
      return (
        <EmptyState
          title={t('client_keys.load_failed', { message: data.error || t('common.unknown_error') })}
          action={
            <Button variant="secondary" onClick={() => void data.reload()}>
              {t('client_keys.retry')}
            </Button>
          }
        />
      );
    }
    if (!ready) {
      return (
        <div className={styles.skeletons} aria-busy="true" aria-label={t('client_keys.loading')}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} height={56} />
          ))}
        </div>
      );
    }
    return (
      <>
        <ClientKeysTabs
          active={view}
          keyCount={data.issuedKeys.length}
          onChange={(next) => syncUrl(next, selectedKey)}
        />
        <div
          role="tabpanel"
          id={clientKeysPanelId(view)}
          aria-labelledby={clientKeysTabId(view)}
          tabIndex={0}
          className={styles.panel}
        >
          {renderPanel(view)}
        </div>
      </>
    );
  };

  return (
    <div className={styles.page} ref={revealRef}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title} data-reveal>
            {t('client_keys.title')}
          </h1>
          <p className={styles.subtitle}>{t('client_keys.subtitle')}</p>
        </div>
        <Button onClick={openIssue} disabled={!canIssue}>
          <span className={styles.buttonContent}>
            <IconPlus size={15} />
            {t('client_keys.issue_button')}
          </span>
        </Button>
      </header>

      {renderBody()}

      <div role="status" aria-live="polite" className={styles.srOnly}>
        {data.announcement}
      </div>

      {issueSession > 0 ? (
        <IssueKeyDialog
          key={issueSession}
          open={issueOpen}
          existingNames={existingNames}
          catalogIds={data.catalog.ids}
          issueKey={data.issueKey}
          onClose={() => setIssueOpen(false)}
        />
      ) : null}

      {sheetTarget ? (
        <KeyPolicySheet
          open={sheetOpen && sheetPolicy !== null}
          policy={sheetPolicy}
          policies={data.policies}
          credentials={data.credentials}
          catalog={data.catalog}
          focusSection={sheetTarget.section}
          pending={data.pending}
          expiresLabel={expiresLabel(sheetPolicy)}
          applyPolicyChange={data.applyPolicyChange}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
