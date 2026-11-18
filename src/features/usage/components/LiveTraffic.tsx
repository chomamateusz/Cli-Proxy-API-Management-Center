import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { clientKeyErrorMessage } from '@/features/clientKeys/errors';
import type { RecentRequest } from '@/types/fleetUsage';
import { accountLabel } from '../recentRequests';
import type { RecentRequestsState } from '../hooks/useRecentRequests';
import { formatCompact } from '../usageSeries';
import { formatClockSeconds, formatInteger } from '../usageFormat';
import styles from './LiveTraffic.module.scss';

export interface LiveTrafficProps {
  state: RecentRequestsState;
  paused: boolean;
  onTogglePause: () => void;
  keyFilter: string;
  keyOptions: readonly string[];
  onKeyFilterChange: (key: string) => void;
  accountNames: ReadonlyMap<string, string>;
}

const formatLatency = (ms: number) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

function TrafficRow({
  row,
  fresh,
  account,
  locale,
}: {
  row: RecentRequest;
  fresh: boolean;
  account: string;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <TableRow className={styles.row} data-fresh={fresh || undefined}>
      <TableCell className={styles.time}>{formatClockSeconds(row.requestedAtMs, locale)}</TableCell>
      <TableCell className={styles.key}>
        <span title={row.key}>{row.key}</span>
      </TableCell>
      <TableCell className={styles.model}>
        <span title={row.model}>{row.model}</span>
        {row.responseModel && (
          <span className={styles.responseModel} title={row.responseModel}>
            → {row.responseModel}
          </span>
        )}
      </TableCell>
      <TableCell className={styles.account}>
        <span title={account}>{account || '—'}</span>
      </TableCell>
      <TableCell>
        {row.failed ? (
          <span className={styles.failed}>{row.statusCode ?? t('usage.live.failed')}</span>
        ) : (
          <span className={styles.ok}>{t('usage.live.ok')}</span>
        )}
      </TableCell>
      <TableCell alignRight className={styles.num}>
        <span title={row.ttftMs ? t('usage.live.ttft', { value: row.ttftMs }) : undefined}>
          {formatLatency(row.latencyMs)}
        </span>
      </TableCell>
      <TableCell alignRight className={styles.num}>
        <span title={formatInteger(row.inputTokens, locale)}>{formatCompact(row.inputTokens)}</span>
        {' / '}
        <span title={formatInteger(row.outputTokens, locale)}>
          {formatCompact(row.outputTokens)}
        </span>
        {' / '}
        <span title={formatInteger(row.cacheReadTokens, locale)}>
          {formatCompact(row.cacheReadTokens)}
        </span>
      </TableCell>
      <TableCell>
        {row.stream && <span className={styles.stream}>{t('usage.live.stream')}</span>}
      </TableCell>
    </TableRow>
  );
}

export function LiveTraffic({
  state,
  paused,
  onTogglePause,
  keyFilter,
  keyOptions,
  onKeyFilterChange,
  accountNames,
}: LiveTrafficProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { feed, error } = state;

  const renderBody = () => {
    if (error && !feed.loaded) {
      return (
        <EmptyState
          title={t('usage.live.load_failed')}
          description={
            error.kind === 'unsupported' ? t('usage.unsupported') : clientKeyErrorMessage(t, error)
          }
        />
      );
    }
    if (!feed.loaded) {
      return <p className={styles.placeholder}>{t('usage.loading')}</p>;
    }
    if (feed.rows.length === 0) return <EmptyState title={t('usage.live.empty')} />;
    return (
      <Table className={styles.table} aria-label={t('usage.live.title')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('usage.live.time')}</TableHead>
            <TableHead>{t('usage.live.key')}</TableHead>
            <TableHead>{t('usage.live.model')}</TableHead>
            <TableHead>{t('usage.live.account')}</TableHead>
            <TableHead>{t('usage.live.status')}</TableHead>
            <TableHead alignRight>{t('usage.live.latency')}</TableHead>
            <TableHead alignRight>{t('usage.live.tokens')}</TableHead>
            <TableHead>
              <span className={styles.srOnly}>{t('usage.live.stream')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {feed.rows.map((row) => (
            <TrafficRow
              key={row.seq}
              row={row}
              fresh={feed.fresh.has(row.seq)}
              account={accountLabel(row, accountNames)}
              locale={locale}
            />
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <section className={styles.section} aria-labelledby="usage-live-title">
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h2 id="usage-live-title" className={styles.title}>
            {t('usage.live.title')}
          </h2>
          <p className={styles.note}>{t('usage.live.note')}</p>
        </div>
        <div className={styles.controls}>
          <Select
            value={keyFilter}
            options={[
              { value: '', label: t('usage.live.all_keys') },
              ...keyOptions.map((name) => ({ value: name, label: name })),
            ]}
            onChange={onKeyFilterChange}
            ariaLabel={t('usage.live.key_filter')}
            size="sm"
          />
          <Button variant="secondary" size="sm" onClick={onTogglePause} aria-pressed={paused}>
            {paused ? t('usage.live.resume') : t('usage.live.pause')}
          </Button>
        </div>
      </header>
      {error && feed.loaded && (
        <p className={styles.inlineError} role="status">
          {t('usage.live.poll_failed')}
        </p>
      )}
      {renderBody()}
    </section>
  );
}
