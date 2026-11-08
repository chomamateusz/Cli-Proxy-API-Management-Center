import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSlidersHorizontal } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ClientKeyPolicy, PolicyCredential } from '@/types/clientKeys';
import {
  deriveCredentialCell,
  isCellAllowed,
  planCredentialToggle,
  rowReadonlyReason,
  type CredentialCell,
} from '../matrix';
import type { PolicyChange } from '../hooks/useClientKeysData';
import {
  credentialCellId,
  keyLabelFor,
  policySelectValue,
  resolveSelectedPolicy,
} from '../presentation';
import styles from './CredentialsPanel.module.scss';

interface CredentialsPanelProps {
  policies: ClientKeyPolicy[];
  credentials: PolicyCredential[];
  credentialsError: string | null;
  selectedKey: string | null;
  pending: ReadonlyMap<string, unknown>;
  cellErrors: ReadonlyMap<string, string>;
  onSelectKey: (value: string) => void;
  onEditPatterns: (policy: ClientKeyPolicy) => void;
  onReload: () => void;
  applyPolicyChange: (change: PolicyChange) => boolean;
}

export function CredentialsPanel({
  policies,
  credentials,
  credentialsError,
  selectedKey,
  pending,
  cellErrors,
  onSelectKey,
  onEditPatterns,
  onReload,
  applyPolicyChange,
}: CredentialsPanelProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const policy = resolveSelectedPolicy(policies, selectedKey);

  if (credentialsError !== null) {
    return (
      <EmptyState
        title={t('client_keys.credentials.load_failed', { message: credentialsError })}
        action={
          <Button variant="secondary" onClick={onReload}>
            {t('client_keys.retry')}
          </Button>
        }
      />
    );
  }
  if (credentials.length === 0 || !policy) {
    return (
      <EmptyState
        title={t('client_keys.credentials.empty_title')}
        description={t('client_keys.credentials.empty_desc')}
        action={
          <Link to="/auth-files" className="btn btn-secondary">
            {t('client_keys.credentials.empty_action')}
          </Link>
        }
      />
    );
  }

  const readonly = rowReadonlyReason(policy, policies);
  const keyLabel = keyLabelFor(t, policy);
  const rows = credentials.map((credential) => ({
    credential,
    cell: deriveCredentialCell(policy, credential, readonly),
  }));
  const allowed = rows.filter((row) => isCellAllowed(row.cell)).length;
  const providers = [...new Set(credentials.map((credential) => credential.provider))].sort(
    (a, b) =>
      getTypeLabel(t, a).localeCompare(getTypeLabel(t, b), undefined, { sensitivity: 'base' })
  );
  const options = policies.map((entry) => {
    const reason = rowReadonlyReason(entry, policies);
    const label = keyLabelFor(t, entry);
    return {
      value: policySelectValue(entry),
      label: reason ? `${label} (${t(`client_keys.matrix.readonly_${reason}`)})` : label,
    };
  });

  const toggle = (credential: PolicyCredential, cell: CredentialCell, cellId: string) => {
    if (pending.has(cellId)) return;
    const patch = planCredentialToggle(cell, credential);
    if (!patch) return;
    applyPolicyChange({
      keyName: policy.name,
      cellIds: [cellId],
      patch,
      announce: t(
        cell.state === 'allowed'
          ? 'client_keys.announce.credential_blocked'
          : 'client_keys.announce.credential_allowed',
        { key: keyLabel, credential: credential.displayName }
      ),
    });
  };

  const statusText = (cell: CredentialCell, cellId: string) => {
    const error = cellErrors.get(cellId);
    if (pending.has(cellId)) return t('client_keys.matrix.state_pending');
    if (error) return error;
    if (cell.state !== 'locked') return '';
    if (cell.lock.reason === 'pattern') {
      return t('client_keys.credentials.state_pattern', { pattern: cell.lock.patterns[0] });
    }
    if (cell.lock.reason === 'allowlist') return t('client_keys.credentials.state_allowlist');
    return t(`client_keys.matrix.readonly_${cell.lock.why}`);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={`form-group ${styles.keySelect}`}>
          <label id={`${baseId}-key`}>{t('client_keys.credentials.key_select_label')}</label>
          <Select
            value={policySelectValue(policy)}
            options={options}
            onChange={onSelectKey}
            ariaLabelledBy={`${baseId}-key`}
          />
        </div>
        <p className={styles.summary}>
          {t('client_keys.credentials.summary', { allowed, total: credentials.length })}
        </p>
        <Button variant="secondary" onClick={() => onEditPatterns(policy)}>
          <span className={styles.buttonContent}>
            <IconSlidersHorizontal size={14} />
            {t('client_keys.credentials.edit_patterns')}
          </span>
        </Button>
      </div>
      {providers.map((provider, groupIndex) => (
        <section
          key={provider}
          className={styles.group}
          aria-labelledby={`${baseId}-group-${groupIndex}`}
        >
          <h3 id={`${baseId}-group-${groupIndex}`} className={styles.groupTitle}>
            {getTypeLabel(t, provider)}
          </h3>
          <ul className={styles.list}>
            {rows
              .filter((row) => row.credential.provider === provider)
              .map(({ credential, cell }, index) => {
                const cellId = credentialCellId(policy.name, credential.writeToken);
                const statusId = `${baseId}-status-${groupIndex}-${index}`;
                const status = statusText(cell, cellId);
                return (
                  <li key={credential.name} className={styles.item}>
                    <ToggleSwitch
                      checked={isCellAllowed(cell)}
                      disabled={cell.state === 'locked'}
                      ariaLabel={t('client_keys.credentials.toggle_label', {
                        key: keyLabel,
                        credential: credential.displayName,
                      })}
                      ariaDescribedBy={statusId}
                      onChange={() => toggle(credential, cell, cellId)}
                    />
                    <div className={styles.identity}>
                      <span className={styles.primary} title={credential.displayName}>
                        {credential.displayName}
                      </span>
                      {credential.secondaryName ? (
                        <span className={styles.secondary} title={credential.name}>
                          {credential.secondaryName}
                        </span>
                      ) : null}
                    </div>
                    <span className={styles.badges}>
                      {credential.disabled ? (
                        <span className={styles.badge}>
                          {t('client_keys.credentials.disabled_badge')}
                        </span>
                      ) : null}
                      {credential.runtimeOnly ? (
                        <span className={styles.badge}>
                          {t('client_keys.credentials.runtime_badge')}
                        </span>
                      ) : null}
                    </span>
                    <span
                      id={statusId}
                      className={cellErrors.has(cellId) ? styles.statusError : styles.status}
                    >
                      {status}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
