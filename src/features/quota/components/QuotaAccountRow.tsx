import { useTranslation } from 'react-i18next';
import { IconRefreshCw, IconTimer, IconZap } from '@/components/ui/icons';
import type { ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';
import { formatInstantShort, parseIsoToMs, resolveQuotaErrorMessage } from '@/utils/quota';
import type { QuotaAccountLabel } from '@/utils/quota/identity';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import { formatXaiRemainingAmount } from '../providers/xai/amounts';
import type { AccountActivity } from '../quotaActivity';
import {
  formatCountdown,
  toneForRemaining,
  type QuotaMetric,
  type QuotaRowModel,
} from '../quotaOverview';
import { PrivateText } from './PrivateText';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaAccountRow.module.scss';

const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaExtrasColumn = 'claude-resets' | 'codex-resets' | 'xai-credits' | null;

export interface QuotaAccountRowProps {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  model: QuotaRowModel | null;
  metricColumns: readonly string[];
  extrasColumn: QuotaExtrasColumn;
  label: QuotaAccountLabel;
  providerLabel: string;
  showEmails: boolean;
  nowMs: number;
  activity?: AccountActivity;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}

const formatPercent = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

function MetricCell({ metric, nowMs }: { metric: QuotaMetric; nowMs: number }) {
  const { t } = useTranslation();
  const tone = toneForRemaining(metric.remainingPercent);
  const resetAt = metric.resetAtMs !== null && metric.resetAtMs > nowMs ? metric.resetAtMs : null;
  return (
    <div className={styles.metric} data-tone={tone}>
      <div className={styles.metricLabel} aria-hidden="true">
        {metric.label}
      </div>
      <div className={styles.metricValue}>
        {t('quota_overview.left', { value: formatPercent(metric.remainingPercent) })}
        {tone === 'low' && <span className={styles.lowTag}>{t('quota_overview.low')}</span>}
      </div>
      <div
        className={styles.bar}
        role="meter"
        aria-label={metric.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={metric.remainingPercent ?? undefined}
      >
        <div className={styles.barFill} style={{ width: `${metric.remainingPercent ?? 0}%` }} />
      </div>
      <div
        className={styles.metricReset}
        title={resetAt === null ? undefined : formatInstantShort(resetAt)}
      >
        {resetAt === null
          ? t('quota_overview.no_reset_pending')
          : t('quota_overview.resets_in', { countdown: formatCountdown(resetAt, nowMs) })}
      </div>
    </div>
  );
}

function ResetLine({
  count,
  label,
  endsAtMs,
  nowMs,
}: {
  count: number;
  label: string;
  endsAtMs: number | null;
  nowMs: number;
}) {
  return (
    <div className={styles.resetLine}>
      <span className={styles.resetCount}>{count}</span>
      <span className={styles.resetLabel}>{label}</span>
      {endsAtMs !== null && endsAtMs > nowMs && (
        <span className={styles.resetExpiry} title={formatInstantShort(endsAtMs)}>
          <IconTimer size={12} aria-hidden="true" />
          {formatCountdown(endsAtMs, nowMs)}
        </span>
      )}
    </div>
  );
}

export function QuotaAccountRow(props: QuotaAccountRowProps) {
  const {
    entry,
    quota,
    model,
    metricColumns,
    extrasColumn,
    label,
    providerLabel,
    showEmails,
    nowMs,
    activity,
    canRefresh,
    resetting,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';

  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const canResetCodex =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  const showClaudeReset = entry.type === 'claude' && (claudeReset.count ?? 0) > 0;

  const plan =
    status !== 'success'
      ? null
      : entry.type === 'claude' && (quota as ClaudeQuotaState).planType
        ? t(`claude_quota.${(quota as ClaudeQuotaState).planType}`)
        : entry.type === 'codex'
          ? getCodexPlanLabel(t, (quota as CodexQuotaState).planType)
          : null;
  const subline = [
    providerLabel,
    plan,
    activity && activity.requests > 0
      ? t('quota_overview.requests_last_hour', { count: activity.requests })
      : null,
  ].filter(Boolean);

  const metricsById = new Map(
    [...(model?.metrics ?? []), ...(model?.extra ?? [])].map((metric) => [metric.id, metric])
  );
  const spanStyle = { gridColumn: `span ${Math.max(1, metricColumns.length)}` };

  const renderBody = () => {
    if (status === 'idle') {
      return (
        <div className={styles.bodySpan} style={spanStyle}>
          <button
            type="button"
            className={styles.loadButton}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={13} aria-hidden="true" />
            {t(`${adapter.i18nPrefix}.idle`)}
          </button>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={styles.bodySpan} style={spanStyle} aria-busy="true">
          <span className={styles.skeleton} aria-hidden="true" />
          <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        </div>
      );
    }
    if (status === 'error') {
      return (
        <div className={`${styles.bodySpan} ${styles.errorText}`} style={spanStyle} role="alert">
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: resolveQuotaErrorMessage(
              t,
              quota?.errorStatus,
              quota?.error || t('common.unknown_error')
            ),
          })}
        </div>
      );
    }
    if (!model && quota) {
      return (
        <div className={`${styles.bodySpan} ${styles.fullBody}`} style={spanStyle}>
          <adapter.Body quota={quota} classes={quotaClasses} />
        </div>
      );
    }
    return metricColumns.map((id) => {
      const metric = metricsById.get(id);
      return metric ? (
        <MetricCell key={id} metric={metric} nowMs={nowMs} />
      ) : (
        <div key={id} className={styles.metricEmpty} aria-hidden="true" />
      );
    });
  };

  const renderExtras = () => {
    if (status !== 'success' || !quota) return null;
    if (extrasColumn === 'claude-resets') {
      if (claudeReset.message) {
        return (
          <span className={styles.extrasNote} role="status">
            {t(`claude_reset.${claudeReset.message}`)}
          </span>
        );
      }
      return claudeReset.grants
        .filter((grant) => grant.resetsLeft > 0)
        .map((grant, index) => (
          <ResetLine
            key={grant.id}
            count={grant.resetsLeft}
            label={grant.label || t('claude_reset.grant_number', { index: index + 1 })}
            endsAtMs={parseIsoToMs(grant.endsAt)}
            nowMs={nowMs}
          />
        ));
    }
    if (extrasColumn === 'codex-resets') {
      const codex = quota as CodexQuotaState;
      const available = codex.rateLimitResetCreditsAvailableCount;
      if (!available) return null;
      const nextExpiry = (codex.rateLimitResetCredits ?? [])
        .map((credit) => parseIsoToMs(credit.expiresAt))
        .filter((ms): ms is number => ms !== null && ms > nowMs)
        .sort((a, b) => a - b)[0];
      return (
        <ResetLine
          count={available}
          label={t('quota_overview.resets_available')}
          endsAtMs={nextExpiry ?? null}
          nowMs={nowMs}
        />
      );
    }
    if (extrasColumn === 'xai-credits') {
      const billing = (quota as XaiQuotaState).billing;
      if (!billing || billing.mode !== 'billing' || billing.monthlyLimitCents === null) return null;
      return <span className={styles.creditsAmount}>{formatXaiRemainingAmount(billing)}</span>;
    }
    return null;
  };

  return (
    <article className={styles.row} data-status={status}>
      <div className={styles.identity}>
        <PrivateText text={label.name} className={styles.name} showEmails={showEmails} />
        {label.detail && (
          <PrivateText text={label.detail} className={styles.detail} showEmails={showEmails} />
        )}
        <span className={styles.subline}>{subline.join(' · ')}</span>
      </div>

      {renderBody()}

      {extrasColumn && <div className={styles.extras}>{renderExtras()}</div>}

      <div className={styles.actions}>
        {showClaudeReset && (
          <button
            type="button"
            className={styles.iconAction}
            disabled={claudeReset.blocked}
            onClick={claudeReset.confirm}
            title={t(`claude_reset.${claudeReset.buttonLabel}`)}
            aria-label={t(`claude_reset.${claudeReset.buttonLabel}`)}
          >
            <IconZap size={15} className={claudeReset.busy ? styles.busy : undefined} />
          </button>
        )}
        {canResetCodex && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            title={t('codex_quota.reset_button')}
            aria-label={t('codex_quota.reset_button')}
          >
            <IconZap size={15} className={resetting ? styles.busy : undefined} />
          </button>
        )}
        {status !== 'idle' && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_single')}
            aria-label={t('auth_files.quota_refresh_single')}
          >
            <IconRefreshCw size={15} className={loading ? styles.spinning : undefined} />
          </button>
        )}
      </div>
    </article>
  );
}
