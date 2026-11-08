import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconLock, IconSlidersHorizontal } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/Table';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import type { ClientKeyPolicy, ModelCatalog, PolicyCredential } from '@/types/clientKeys';
import {
  countPatterns,
  deriveModelCell,
  planModelToggle,
  rowReadonlyReason,
  summarizeRow,
  type ModelCell,
} from '../matrix';
import { isUnrestrictedAllowlist } from '../policyMatching';
import type { PolicyChange } from '../hooks/useClientKeysData';
import { useGridRovingFocus } from '../hooks/useGridRovingFocus';
import { blockAllBanners, keyLabelFor, modelCellId } from '../presentation';
import { MatrixCell } from './MatrixCell';
import { MatrixToolbar } from './MatrixToolbar';
import styles from './ModelMatrix.module.scss';

interface ModelMatrixProps {
  policies: ClientKeyPolicy[];
  credentials: PolicyCredential[];
  catalog: ModelCatalog;
  catalogProgress: { done: number; total: number } | null;
  catalogFailures: string[];
  credentialsError: string | null;
  pending: ReadonlyMap<string, unknown>;
  cellErrors: ReadonlyMap<string, string>;
  nowMs: number;
  theme: ResolvedTheme;
  canIssue: boolean;
  onIssue: () => void;
  onRetryCatalog: () => void;
  onEditPolicy: (policy: ClientKeyPolicy) => void;
  applyPolicyChange: (change: PolicyChange) => boolean;
}

export function ModelMatrix({
  policies,
  credentials,
  catalog,
  catalogProgress,
  catalogFailures,
  credentialsError,
  pending,
  cellErrors,
  nowMs,
  theme,
  canIssue,
  onIssue,
  onRetryCatalog,
  onEditPolicy,
  applyPolicyChange,
}: ModelMatrixProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [provider, setProvider] = useState('');

  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return catalog.groups
      .filter((group) => !provider || group.provider === provider)
      .map((group) => ({
        ...group,
        columns: group.columns.filter((column) => column.id.toLowerCase().includes(query)),
      }))
      .filter((group) => group.columns.length > 0);
  }, [catalog, filter, provider]);
  const columns = useMemo(() => groups.flatMap((group) => group.columns), [groups]);
  const grid = useGridRovingFocus(policies.length, columns.length);

  const onToggle = useCallback(
    (keyName: string, modelId: string, cell: ModelCell) => {
      const patch = planModelToggle(cell, modelId);
      if (!patch) return;
      const announceKey =
        cell.state === 'allowed'
          ? 'client_keys.announce.model_blocked'
          : 'client_keys.announce.model_allowed';
      applyPolicyChange({
        keyName,
        cellIds: [modelCellId(keyName, modelId)],
        patch,
        announce: t(announceKey, { key: keyName, model: modelId }),
      });
    },
    [applyPolicyChange, t]
  );

  if (policies.length === 0) {
    return (
      <EmptyState
        title={t('client_keys.matrix.empty_keys_title')}
        description={t('client_keys.matrix.empty_keys_desc')}
        action={
          <Button onClick={onIssue} disabled={!canIssue}>
            {t('client_keys.issue_button')}
          </Button>
        }
      />
    );
  }
  if (catalogProgress) {
    return (
      <div className={styles.loading} aria-busy="true">
        <p role="status">
          {t('client_keys.matrix.models_loading', {
            done: catalogProgress.done,
            total: catalogProgress.total,
          })}
        </p>
        {policies.map((policy) => (
          <Skeleton key={policy.index} height={36} />
        ))}
      </div>
    );
  }

  const blockedAll = blockAllBanners(t, policies);
  const providerOptions = catalog.groups.map((group) => ({
    value: group.provider,
    label: getTypeLabel(t, group.provider),
  }));

  return (
    <div className={styles.matrix}>
      <header className={styles.viewHeader}>
        <h2 className={styles.viewTitle}>{t('client_keys.matrix.heading')}</h2>
        <p className={styles.viewDescription}>{t('client_keys.matrix.description')}</p>
      </header>
      {blockedAll.map((item) => (
        <div key={item.id} className={styles.warningBanner} role="note">
          {t('client_keys.matrix.all_blocked_banner', { key: item.key, pattern: item.pattern })}
        </div>
      ))}
      {credentialsError !== null ? (
        <div className={styles.warningBanner} role="status">
          {t('client_keys.credentials.load_failed', { message: credentialsError })}
        </div>
      ) : null}
      {catalogFailures.length > 0 ? (
        <div className={styles.warningBanner} role="status">
          <span>{t('client_keys.matrix.models_partial', { count: catalogFailures.length })}</span>
          <Button variant="secondary" size="sm" onClick={onRetryCatalog}>
            {t('common.refresh')}
          </Button>
        </div>
      ) : null}
      {catalog.ids.length === 0 ? (
        <EmptyState
          title={t('client_keys.matrix.empty_models_title')}
          description={t('client_keys.matrix.empty_models_desc')}
          action={
            <Link to="/auth-files" className="btn btn-secondary">
              {t('client_keys.matrix.empty_models_action')}
            </Link>
          }
        />
      ) : (
        <>
          <MatrixToolbar
            filter={filter}
            provider={provider}
            providers={providerOptions}
            onFilterChange={setFilter}
            onProviderChange={setProvider}
          />
          {columns.length === 0 ? (
            <EmptyState title={t('client_keys.matrix.empty_filter')} />
          ) : (
            <Table
              role="grid"
              aria-label={t('client_keys.matrix.grid_label')}
              aria-rowcount={policies.length + 2}
              aria-colcount={columns.length + 1}
              className={styles.grid}
              onKeyDown={grid.onKeyDown}
              onFocus={grid.onFocus}
              cols={
                <>
                  <col className={styles.keyCol} />
                  {columns.map((column) => (
                    <col key={column.id} className={styles.modelCol} />
                  ))}
                </>
              }
            >
              <TableHeader>
                <TableRow>
                  <td rowSpan={2} className={styles.corner} />
                  {groups.map((group) => {
                    const icon = getAuthFileIcon(group.provider, theme);
                    return (
                      <th
                        key={group.provider}
                        scope="colgroup"
                        colSpan={group.columns.length}
                        className={styles.groupHead}
                      >
                        <span className={styles.groupLabel}>
                          {icon ? <img src={icon} alt="" width={14} height={14} /> : null}
                          {getTypeLabel(t, group.provider)}
                          <span className={styles.groupCount}>{group.columns.length}</span>
                        </span>
                      </th>
                    );
                  })}
                </TableRow>
                <TableRow>
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      className={styles.modelHead}
                      title={
                        column.providers.length > 1
                          ? `${column.id}\n${t('client_keys.matrix.offered_by', {
                              providers: column.providers
                                .map((item) => getTypeLabel(t, item))
                                .join(', '),
                            })}`
                          : column.id
                      }
                    >
                      <span className={styles.modelId}>{column.id}</span>
                    </th>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy, row) => {
                  const readonly = rowReadonlyReason(policy, policies);
                  const keyLabel = keyLabelFor(t, policy);
                  const summary = summarizeRow(policy, catalog);
                  const expired = policy.expiresAtMs !== null && policy.expiresAtMs <= nowMs;
                  return (
                    <TableRow key={`${policy.index}-${policy.name}`}>
                      <th scope="row" className={styles.rowHead}>
                        <span className={policy.name ? styles.keyName : styles.keyUnnamed}>
                          {keyLabel}
                        </span>
                        <span className={styles.rowMeta}>
                          {t('client_keys.matrix.row_summary', summary)}
                        </span>
                        <span className={styles.badges}>
                          {!isUnrestrictedAllowlist(policy.models) ? (
                            <span className={styles.badge} title={policy.models.join(', ')}>
                              {t('client_keys.matrix.allowlist_badge')}
                            </span>
                          ) : null}
                          {expired ? (
                            <span className={styles.badgeDanger}>
                              {t('client_keys.keys.expired')}
                            </span>
                          ) : null}
                          {readonly ? (
                            <span className={styles.badgeMuted}>
                              <IconLock size={11} />
                              {t(`client_keys.matrix.readonly_${readonly}`)}
                            </span>
                          ) : null}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={styles.patternsButton}
                          aria-label={t('client_keys.matrix.edit_policy', { key: keyLabel })}
                          onClick={() => onEditPolicy(policy)}
                        >
                          <span className={styles.buttonContent}>
                            <IconSlidersHorizontal size={13} />
                            {t('client_keys.matrix.patterns_badge', {
                              count: countPatterns(policy),
                            })}
                          </span>
                        </Button>
                      </th>
                      {columns.map((column, col) => {
                        const id = modelCellId(policy.name, column.id);
                        return (
                          <MatrixCell
                            key={column.id}
                            row={row}
                            col={col}
                            keyName={policy.name}
                            keyLabel={keyLabel}
                            modelId={column.id}
                            cell={deriveModelCell(policy, column, credentials, readonly)}
                            pending={!readonly && pending.has(id)}
                            error={readonly ? null : (cellErrors.get(id) ?? null)}
                            tabIndex={grid.tabIndexFor(row, col)}
                            onToggle={onToggle}
                          />
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
