import { useId, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconTrash2 } from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { ClientKeyPolicy, IssuedKey, PolicyLists } from '@/types/clientKeys';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { MINUTE_MS } from '@/utils/time/durations';
import { formatKeyInstant } from '../formatInstant';
import { PolicySummary } from './PolicySummary';
import styles from './KeysTable.module.scss';

const SOON_MS = 7 * 24 * 60 * 60 * 1000;

interface KeysTableProps {
  issuedKeys: IssuedKey[];
  policies: ClientKeyPolicy[];
  revoking: ReadonlySet<string>;
  nowMs: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onRevoke: (name: string) => void;
}

const policyListsFor = (key: IssuedKey, policies: ClientKeyPolicy[]): PolicyLists =>
  policies.find((policy) => policy.name === key.name) ?? {
    models: key.models,
    excludedModels: key.excludedModels,
    credentials: [],
    excludedCredentials: [],
  };

export function KeysTable({
  issuedKeys,
  policies,
  revoking,
  nowMs,
  headingRef,
  onRevoke,
}: KeysTableProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const locale = i18n.language;
  const rows = [...issuedKeys].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
  const otherKeys = policies.filter((policy) => policy.issuedBy === '').length;

  const instant = (raw: string, ms: number | null, past = false) => {
    if (ms === null) return <span title={raw}>{raw}</span>;
    return (
      <span title={raw} className={styles.instant}>
        <span>{formatKeyInstant(ms, locale)}</span>
        <span className={styles.relative}>
          {past
            ? formatRelativeInstant(Math.min(ms, nowMs), nowMs, locale, { nowWithinMs: MINUTE_MS })
            : formatRelativeInstant(ms, nowMs, locale)}
        </span>
      </span>
    );
  };

  const expiry = (key: IssuedKey) => {
    if (key.expiresAt === '') {
      return <span className={styles.muted}>{t('client_keys.keys.never_expires')}</span>;
    }
    if (key.expiresAtMs === null) return <span title={key.expiresAt}>{key.expiresAt}</span>;
    if (key.expiresAtMs <= nowMs) {
      return (
        <span title={key.expiresAt} className={styles.instant}>
          <span className={styles.expiredChip}>{t('client_keys.keys.expired')}</span>
          <span className={styles.relative}>
            {formatRelativeInstant(key.expiresAtMs, nowMs, locale)}
          </span>
        </span>
      );
    }
    if (key.expiresAtMs - nowMs <= SOON_MS) {
      return (
        <span
          className={styles.soon}
          title={`${key.expiresAt} · ${t('client_keys.keys.expires_soon')}`}
        >
          {instant(key.expiresAt, key.expiresAtMs)}
        </span>
      );
    }
    return instant(key.expiresAt, key.expiresAtMs);
  };

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
        {t('client_keys.keys.heading')}
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          title={t('client_keys.keys.empty_title')}
          description={t('client_keys.keys.empty_desc')}
        />
      ) : (
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('client_keys.keys.col_name')}</TableHead>
              <TableHead scope="col">{t('client_keys.keys.col_issued_by')}</TableHead>
              <TableHead scope="col">{t('client_keys.keys.col_created')}</TableHead>
              <TableHead scope="col">{t('client_keys.keys.col_expires')}</TableHead>
              <TableHead scope="col">{t('client_keys.keys.col_policy')}</TableHead>
              <TableHead scope="col" alignRight>
                <span className={styles.srOnly}>{t('client_keys.keys.col_actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((key) => (
              <TableRow key={key.name}>
                <th scope="row" className={styles.nameCell}>
                  {key.name}
                </th>
                <TableCell>{key.issuedBy}</TableCell>
                <TableCell>{instant(key.createdAt, key.createdAtMs, true)}</TableCell>
                <TableCell>{expiry(key)}</TableCell>
                <TableCell>
                  <PolicySummary lists={policyListsFor(key, policies)} />
                </TableCell>
                <TableCell alignRight>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={revoking.has(key.name)}
                    aria-label={t('client_keys.keys.revoke_aria', { name: key.name })}
                    onClick={() => onRevoke(key.name)}
                  >
                    <span className={styles.buttonContent}>
                      <IconTrash2 size={14} />
                      {t('client_keys.keys.revoke')}
                    </span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {otherKeys > 0 ? (
        <p className={styles.note}>
          {t('client_keys.keys.other_keys_note', { count: otherKeys })}{' '}
          <Link to="/config">{t('client_keys.keys.other_keys_link')}</Link>
        </p>
      ) : null}
    </section>
  );
}
