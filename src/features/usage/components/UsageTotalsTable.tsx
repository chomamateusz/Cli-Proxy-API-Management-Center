import { Fragment, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { getTypeLabel } from '@/features/authFiles/constants';
import { formatCompact, requestCount, type KeyTotalRow, type UsageMetric } from '../usageSeries';
import { formatDate, formatInteger, formatShare, seriesColor } from '../usageFormat';
import styles from './UsageTotalsTable.module.scss';

export interface UsageTotalsTableProps {
  rows: readonly KeyTotalRow[];
  metric: UsageMetric;
  slots: ReadonlyMap<string, number>;
}

function TokenCell({ value, locale }: { value: number; locale: string }) {
  return (
    <TableCell alignRight className={styles.num}>
      <span title={formatInteger(value, locale)}>{formatCompact(value)}</span>
    </TableCell>
  );
}

export function UsageTotalsTable({ rows, metric, slots }: UsageTotalsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <Table className={styles.table} aria-label={t('usage.totals.title')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('usage.totals.key')}</TableHead>
          <TableHead alignRight data-active={metric === 'total' || undefined}>
            {t('usage.metric.total')}
          </TableHead>
          <TableHead alignRight data-active={metric === 'output' || undefined}>
            {t('usage.metric.output')}
          </TableHead>
          <TableHead alignRight data-active={metric === 'requests' || undefined}>
            {t('usage.metric.requests')}
          </TableHead>
          <TableHead alignRight>{t('usage.totals.failed')}</TableHead>
          <TableHead alignRight>{t('usage.totals.share')}</TableHead>
          <TableHead>{t('usage.totals.created')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const open = expanded.has(row.name);
          const detailId = `usage-models-${encodeURIComponent(row.name)}`;
          return (
            <Fragment key={row.name}>
              <TableRow className={styles.keyRow}>
                <TableCell>
                  <div className={styles.keyCell}>
                    <button
                      type="button"
                      className={styles.expand}
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() => toggle(row.name)}
                    >
                      {open ? (
                        <IconChevronUp size={14} aria-hidden="true" />
                      ) : (
                        <IconChevronDown size={14} aria-hidden="true" />
                      )}
                      <span
                        className={styles.swatch}
                        style={{ '--swatch': seriesColor(row.name, slots) } as CSSProperties}
                      />
                      <span className={styles.keyName} title={row.name}>
                        {row.name}
                      </span>
                    </button>
                    {row.revoked && (
                      <span className={styles.revoked}>{t('usage.totals.revoked')}</span>
                    )}
                  </div>
                </TableCell>
                <TokenCell value={row.counters.totalTokens} locale={locale} />
                <TokenCell value={row.counters.outputTokens} locale={locale} />
                <TableCell alignRight className={styles.num}>
                  {formatInteger(requestCount(row.counters), locale)}
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  <span className={row.counters.failedRequests > 0 ? styles.failed : undefined}>
                    {formatInteger(row.counters.failedRequests, locale)}
                  </span>
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  {formatShare(row.share)}
                </TableCell>
                <TableCell className={styles.created}>
                  {row.createdAtMs === null ? '—' : formatDate(row.createdAtMs, locale)}
                </TableCell>
              </TableRow>
              {open &&
                (row.models.length === 0 ? (
                  <TableRow id={detailId} className={styles.modelRow}>
                    <TableCell colSpan={7}>
                      <div className={styles.modelEmpty}>{t('usage.totals.no_models')}</div>
                    </TableCell>
                  </TableRow>
                ) : (
                  row.models.map((model, index) => (
                    <TableRow
                      key={`${model.provider}/${model.model}`}
                      id={index === 0 ? detailId : undefined}
                      className={styles.modelRow}
                    >
                      <TableCell>
                        <div className={styles.modelCell}>
                          <span className={styles.provider}>{getTypeLabel(t, model.provider)}</span>
                          <span className={styles.modelName} title={model.model}>
                            {model.model}
                          </span>
                        </div>
                      </TableCell>
                      <TokenCell value={model.totalTokens} locale={locale} />
                      <TokenCell value={model.outputTokens} locale={locale} />
                      <TableCell alignRight className={styles.num}>
                        {formatInteger(requestCount(model), locale)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatInteger(model.failedRequests, locale)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  ))
                ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
