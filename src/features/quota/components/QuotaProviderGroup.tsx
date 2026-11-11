import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import { toneForRemaining, type PoolTotal, type ProviderSummary } from '../quotaOverview';
import type { QuotaExtrasColumn } from './QuotaAccountRow';
import styles from './QuotaProviderGroup.module.scss';

export interface QuotaColumn {
  id: string;
  label: string;
}

export interface BusiestAccount {
  name: string;
  requests: number;
  share: number | null;
}

export interface QuotaProviderGroupProps {
  type: QuotaProviderType;
  summary: ProviderSummary;
  metricColumns: readonly QuotaColumn[];
  extrasColumn: QuotaExtrasColumn;
  busiest: BusiestAccount | null;
  resolvedTheme: ResolvedTheme;
  showExtraBuckets: boolean;
  onToggleExtraBuckets: () => void;
  brand?: string;
  children: ReactNode;
}

const formatPercent = (value: number) => `${Math.round(value)}%`;

const EXTRAS_LABEL_KEYS: Record<NonNullable<QuotaExtrasColumn>, string> = {
  'claude-resets': 'quota_overview.resets_column',
  'codex-resets': 'quota_overview.resets_column',
  'xai-credits': 'xai_quota.monthly_credits',
};

const quotaGridTemplate = (metricCount: number, hasExtras: boolean) =>
  [
    'minmax(160px, 1.35fr)',
    `repeat(${Math.max(1, metricCount)}, minmax(120px, 1fr))`,
    hasExtras ? 'minmax(120px, 0.9fr)' : '',
    'minmax(72px, auto)',
  ]
    .filter(Boolean)
    .join(' ');

function PoolValue({ pool }: { pool: PoolTotal }) {
  const { t } = useTranslation();
  if (pool.remaining === null || pool.capacity === 0) {
    return (
      <span className={styles.pool}>
        <span className={styles.poolValue} data-tone="unknown">
          --
        </span>
      </span>
    );
  }
  return (
    <span className={styles.pool}>
      <span
        className={styles.poolValue}
        data-tone={toneForRemaining((pool.remaining / pool.capacity) * 100)}
      >
        {formatPercent(pool.remaining)}
      </span>{' '}
      {t('quota_overview.of_pool', { capacity: formatPercent(pool.capacity) })}
    </span>
  );
}

export function QuotaProviderGroup(props: QuotaProviderGroupProps) {
  const {
    type,
    summary,
    metricColumns,
    extrasColumn,
    busiest,
    resolvedTheme,
    showExtraBuckets,
    onToggleExtraBuckets,
    brand,
    children,
  } = props;
  const { t, i18n } = useTranslation();
  const typeLabel = getTypeLabel(t, type);
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  const nextReset = summary.nextResetAtMs;
  const style = {
    '--quota-columns': quotaGridTemplate(metricColumns.length, extrasColumn !== null),
    ...(brand ? { '--brand': brand } : {}),
  } as CSSProperties;

  return (
    <section className={styles.group} style={style} aria-labelledby={`quota-group-${type}`}>
      <header className={styles.summary}>
        <h2 id={`quota-group-${type}`} className={styles.provider}>
          <span
            className={styles.iconWrap}
            style={
              isThemeSurfaceIconProvider(type)
                ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                : undefined
            }
          >
            {iconSrc ? (
              <img src={iconSrc} alt="" className={styles.icon} />
            ) : (
              <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          {typeLabel}
          <span className={styles.count}>{summary.credentialCount}</span>
        </h2>

        {summary.pool && <PoolValue pool={summary.pool} />}

        {nextReset !== null && (
          <span className={styles.fact}>
            {summary.nextResetGain !== null && summary.nextResetGain > 0
              ? t('quota_overview.next_reset_gain', {
                  gain: formatPercent(summary.nextResetGain),
                })
              : t('quota_overview.next_reset')}
            {' · '}
            {new Date(nextReset).toLocaleString(i18n.resolvedLanguage, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}

        {summary.secondaryPool && (
          <span className={styles.fact}>
            {summary.secondaryPool.label}{' '}
            <span className={styles.factValue}>
              {summary.secondaryPool.remaining === null
                ? '--'
                : formatPercent(summary.secondaryPool.remaining)}
            </span>
          </span>
        )}

        {busiest && (
          <span className={styles.fact} title={t('quota_overview.busiest_hint')}>
            {t('quota_overview.busiest')} <span className={styles.factValue}>{busiest.name}</span>{' '}
            {t('quota_overview.requests_short', { count: busiest.requests })}
            {busiest.share !== null && ` · ${formatPercent(busiest.share * 100)}`}
          </span>
        )}

        {summary.hasExtraBuckets && (
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={showExtraBuckets}
            onClick={onToggleExtraBuckets}
          >
            {t(
              showExtraBuckets
                ? 'quota_overview.hide_extra_buckets'
                : 'quota_overview.show_extra_buckets'
            )}
          </button>
        )}
      </header>

      <div className={styles.columns} aria-hidden="true">
        <span>{t('quota_overview.credential_column')}</span>
        {metricColumns.length > 0 ? (
          metricColumns.map((column) => <span key={column.id}>{column.label}</span>)
        ) : (
          <span>{t('quota_overview.quota_column')}</span>
        )}
        {extrasColumn && <span>{t(EXTRAS_LABEL_KEYS[extrasColumn])}</span>}
        <span />
      </div>

      <div className={styles.rows}>{children}</div>
    </section>
  );
}
