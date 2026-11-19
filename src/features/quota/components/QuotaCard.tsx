/**
 * Provider quota card: identity, loading/error state, quota body, and actions.
 * Claude observations remain visible while refreshing or after a failed read.
 *
 * Providers with a slot mapping render aligned limit slots (five-hour, weekly, weekly model)
 * with everything of variable height below them; the others keep their own quota body.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  ResolvedTheme,
  XaiQuotaState,
} from '@/types';
import {
  buildResetDisplay,
  formatInstantShort,
  parseIsoToMs,
  resolveQuotaErrorMessage,
  resolveResetMs,
} from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ClaudeResetGrantDetails } from '../providers/claude/ClaudeResetGrantDetails';
import { ClaudeResetGrantAction } from '../providers/claude/ClaudeResetGrantAction';
import type { ResetGrantLine } from '../providers/claude/resetGrantAvailability';
import { hasClaudeUsageData } from '../providers/claude/data';
import { getCodexPlanLabel } from '../providers/codex/planLabel';
import { formatUsdFromCents } from '../providers/xai/amounts';
import {
  XAI_SUPERGROK_HEAVY_LIMIT_CENTS,
  XAI_SUPERGROK_LIMIT_CENTS,
  planValueClassForTier,
  resolveClaudeCardTier,
  resolveCodexCardTier,
  resolveXaiCardTier,
} from '../cardTier';
import {
  canMarkCancelled,
  paidUntilMsFor,
  readCredentialEnd,
  unusedResetsForCredential,
} from '../credentialEnd';
import { collectQuotaRowInstants, pickUrgentRowId, resetCreditRowId } from '../resetSchedule';
import {
  PROVIDER_SLOTS,
  readQuotaSlots,
  type QuotaExtraLimit,
  type QuotaSlotId,
  type QuotaSlotVariant,
} from '../quotaSlots';
import type { RouterPlacement } from '../routerOrder';
import { CredentialEndControl, type CredentialEndActions } from './CredentialEndControl';
import { QuotaCardSection } from './QuotaCardSection';
import { QuotaMeter } from './QuotaMeter';
import { QuotaSlot } from './QuotaSlot';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCard.module.scss';

/** Bind the quota-page styles to the shared rendering contract. */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resetting: boolean;
  /** Initial cascade delay; null disables entrance motion for later mounts. */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
  canEditEnd: boolean;
  endActions: CredentialEndActions;
  nowMs?: number;
  /** Slot columns of the whole page; defaults to the provider's own slots. */
  slotColumns?: readonly QuotaSlotId[];
  /** Column label per slot, so a disabled slot reads like its column. */
  slotVariants?: Partial<Record<QuotaSlotId, QuotaSlotVariant>>;
  routerPlacement?: RouterPlacement | null;
};

const XAI_PLAN_KEYS: Record<number, string> = {
  [XAI_SUPERGROK_LIMIT_CENTS]: 'xai_quota.plan_supergrok',
  [XAI_SUPERGROK_HEAVY_LIMIT_CENTS]: 'xai_quota.plan_supergrok_heavy',
};

function RouterBadge({ placement }: { placement: RouterPlacement }) {
  const { t } = useTranslation();
  if (placement.kind === 'out') {
    return (
      <span className={styles.orderBadge} data-kind="out">
        {t(
          placement.reason === 'ended'
            ? 'credential_end.ended_badge'
            : `quota_router.out_${placement.reason}`
        )}
      </span>
    );
  }
  if (!placement.sampledProvider) {
    return (
      <span className={styles.orderBadge} data-kind="unranked">
        {t('quota_router.list_order')}
      </span>
    );
  }
  if (!placement.sampled) {
    return (
      <span className={styles.orderBadge} data-kind="unranked">
        {t('quota_router.no_reading')}
      </span>
    );
  }
  const next = placement.position === 1;
  return (
    <span
      className={styles.orderBadge}
      data-kind={next ? 'next' : 'ranked'}
      aria-label={t(next ? 'quota_router.position_next_label' : 'quota_router.position_label', {
        position: placement.position,
      })}
    >
      <span className={styles.orderNumber}>{placement.position}</span>
      {next && <span>{t('quota_router.next')}</span>}
      {placement.tier !== 'room' && (
        <span className={styles.orderTier}>{t(`quota_router.tier_${placement.tier}`)}</span>
      )}
    </span>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.metaItem}>
      <span className={styles.metaLabel}>{label}</span>
      {children}
    </span>
  );
}

function ExtraLimitRows({ extras, nowMs }: { extras: readonly QuotaExtraLimit[]; nowMs: number }) {
  const { i18n } = useTranslation();
  return (
    <>
      {extras.map((extra, index) => {
        const reset = buildResetDisplay(
          extra.resetLabel,
          extra.resetAtMs,
          nowMs,
          i18n.resolvedLanguage
        );
        return (
          <div key={extra.id} className={styles.plainRow} data-kind="limit">
            <div className={styles.plainRowHead}>
              <span className={styles.plainLabel}>{extra.label}</span>
              <span className={styles.plainValue}>
                {extra.remainingPercent !== null
                  ? `${Math.round(extra.remainingPercent)}%`
                  : (extra.detail ?? '--')}
              </span>
            </div>
            {extra.remainingPercent !== null && (
              <QuotaMeter percent={extra.remainingPercent} classes={quotaClasses} index={index} />
            )}
            {(reset || (extra.detail && extra.remainingPercent !== null)) && (
              <div className={styles.plainMeta}>
                {extra.remainingPercent !== null && extra.detail && <span>{extra.detail}</span>}
                {reset && (
                  <span>
                    {reset.absolute}
                    {reset.relative ? ` · ${reset.relative}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ClaudeGrantRows({
  lines,
  nowMs,
  onUse,
}: {
  lines: readonly ResetGrantLine[];
  nowMs: number;
  onUse: (grantId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {lines.map((line) => {
        const display = buildResetDisplay(
          null,
          parseIsoToMs(line.endsAt),
          nowMs,
          i18n.resolvedLanguage
        );
        return (
          <div key={line.id} className={styles.plainRow}>
            <span className={styles.plainLabel}>
              {line.label}
              {line.resetsLeft !== null &&
                line.resetsTotal !== null &&
                ` · ${t('claude_reset.count', { left: line.resetsLeft, total: line.resetsTotal })}`}
            </span>
            <span className={styles.plainActionLine}>
              <span className={styles.plainMeta}>
                {display
                  ? `${display.absolute}${display.relative ? ` · ${display.relative}` : ''}`
                  : t('claude_reset.expiry_unknown')}
              </span>
              <ClaudeResetGrantAction
                line={line}
                className={`${styles.actionPill} ${styles.actionPillCompact}`}
                onUse={onUse}
              />
            </span>
          </div>
        );
      })}
    </>
  );
}

const UNUSABLE_GRANT_BLOCKS = new Set(['grant_expired', 'not_started', 'exhausted']);

const usableGrantCount = (lines: readonly ResetGrantLine[]) =>
  lines.filter(
    (line) =>
      (line.resetsLeft ?? 0) > 0 && !(line.block !== null && UNUSABLE_GRANT_BLOCKS.has(line.block))
  ).length;

export function QuotaCard(props: QuotaCardProps) {
  const {
    entry,
    quota,
    resolvedTheme,
    canRefresh,
    resetting,
    entranceDelayMs,
    onRefresh,
    onReset,
    canEditEnd,
    endActions,
    nowMs: nowProp,
    slotColumns,
    slotVariants,
    routerPlacement,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const tick = useNow(nowProp === undefined);
  const nowMs = nowProp ?? tick;
  const credentialEnd = readCredentialEnd(file, nowMs);
  const { ended } = credentialEnd;
  const retainedClaudeUsage =
    entry.type === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const displayName = getQuotaDisplayName(file);
  const ownSlots = PROVIDER_SLOTS[entry.type];
  const columns = ownSlots ? (slotColumns ?? ownSlots) : null;

  // Capture the entrance delay only at mount, without a render-time ref read.
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const providerType =
    entry.type === 'plugin'
      ? String(
          file.quotaProvider ?? file['quota_provider'] ?? file.provider ?? file.type ?? 'plugin'
        )
      : entry.type;
  const iconSrc = getAuthFileIcon(providerType, resolvedTheme);
  const typeLabel = getTypeLabel(t, providerType);
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const showClaudeReset = entry.type === 'claude' && (status === 'success' || status === 'error');
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  const hasReadings = status === 'success' || retainedClaudeUsage;
  const cardSlots = useMemo(
    () => (columns && hasReadings ? readQuotaSlots(t, entry.type, quota, locale) : null),
    [columns, hasReadings, t, entry.type, quota, locale]
  );
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants(entry.type, quota), nowMs),
    [entry.type, quota, nowMs]
  );

  const header = (
    <header className={styles.head}>
      <span
        className={styles.iconWrap}
        title={typeLabel}
        style={
          isThemeSurfaceIconProvider(providerType)
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
      <span className={styles.fileName} title={displayName}>
        {displayName}
      </span>
      {routerPlacement ? (
        <RouterBadge placement={routerPlacement} />
      ) : (
        ended && <span className={styles.endedBadge}>{t('credential_end.ended_badge')}</span>
      )}
    </header>
  );

  const endControl = (
    <CredentialEndControl
      file={file}
      subject={displayName}
      variant="card"
      paidUntilMs={paidUntilMsFor(entry.type, quota, file)}
      cancellable={canMarkCancelled(entry.type, file)}
      unusedResets={unusedResetsForCredential(
        entry.type,
        credentialEnd,
        quota,
        claudeReset.lines,
        nowMs
      )}
      disabled={!canEditEnd}
      actions={endActions}
      nowMs={nowMs}
    />
  );

  const refreshButton = (
    <button
      type="button"
      className={styles.actionPill}
      onClick={onRefresh}
      disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
      title={t('auth_files.quota_refresh_hint')}
    >
      <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
      {t('auth_files.quota_refresh_single')}
    </button>
  );

  const resetButton = showReset && (
    <button
      type="button"
      className={styles.actionPill}
      onClick={onReset}
      disabled={!canRefresh || loading || resetting}
      title={t('codex_quota.reset_button')}
    >
      <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
      {t('codex_quota.reset_button')}
    </button>
  );

  if (columns) {
    const claudeQuota = entry.type === 'claude' ? (quota as ClaudeQuotaState | undefined) : null;
    const codexQuota =
      entry.type === 'codex' && status === 'success' ? (quota as CodexQuotaState) : null;
    const xaiBilling =
      entry.type === 'xai' && status === 'success'
        ? ((quota as XaiQuotaState).billing ?? null)
        : null;

    const meta: ReactNode[] = [];
    if (claudeQuota?.planType) {
      meta.push(
        <MetaItem key="plan" label={t('claude_quota.plan_label')}>
          <span className={planValueClassForTier(resolveClaudeCardTier(claudeQuota.planType), quotaClasses)}>
            {t(`claude_quota.${claudeQuota.planType}`)}
          </span>
        </MetaItem>
      );
    }
    if (showClaudeReset) {
      meta.push(
        <MetaItem key="resets" label={t('claude_reset.remaining')}>
          <span className={styles.metaValue}>{claudeReset.count ?? '--'}</span>
        </MetaItem>
      );
    }
    if (codexQuota) {
      const planLabel = getCodexPlanLabel(t, codexQuota.planType);
      if (planLabel) {
        meta.push(
          <MetaItem key="plan" label={t('codex_quota.plan_label')}>
            <span
              className={planValueClassForTier(
                resolveCodexCardTier(codexQuota.planType),
                quotaClasses
              )}
            >
              {planLabel}
            </span>
          </MetaItem>
        );
      }
      const paidUntil = resolveResetMs([codexQuota.subscriptionActiveUntil ?? null]);
      if (paidUntil !== null) {
        meta.push(
          <MetaItem key="paid" label={t('codex_quota.expires_label')}>
            <span className={styles.metaValue}>{formatInstantShort(paidUntil)}</span>
          </MetaItem>
        );
      }
    }
    if (xaiBilling) {
      const planKey =
        xaiBilling.monthlyLimitCents === null ? undefined : XAI_PLAN_KEYS[xaiBilling.monthlyLimitCents];
      const planLabel =
        xaiBilling.planLabel ??
        (xaiBilling.mode === 'paid-health'
          ? t('xai_quota.plan_paid')
          : planKey
            ? t(planKey)
            : null);
      if (planLabel) {
        meta.push(
          <MetaItem key="plan" label={t('xai_quota.plan_label')}>
            <span className={planValueClassForTier(resolveXaiCardTier(xaiBilling), quotaClasses)}>
              {planLabel}
            </span>
          </MetaItem>
        );
      }
      if (xaiBilling.mode === 'billing' && (xaiBilling.onDemandCapCents ?? 0) <= 0) {
        meta.push(
          <MetaItem key="payg" label={t('xai_quota.pay_as_you_go_label')}>
            <span className={styles.metaValue}>{t('xai_quota.pay_as_you_go_disabled')}</span>
          </MetaItem>
        );
      }
    }

    const extras: QuotaExtraLimit[] = [...(cardSlots?.extras ?? [])];
    if (codexQuota && (codexQuota.creditsUnlimited || codexQuota.creditBalance != null)) {
      extras.push({
        id: 'credit-balance',
        label: t('codex_quota.credit_balance_label'),
        remainingPercent: null,
        resetAtMs: null,
        resetLabel: null,
        detail: codexQuota.creditsUnlimited
          ? t('codex_quota.credit_unlimited')
          : String(codexQuota.creditBalance),
      });
    }
    if (xaiBilling && typeof xaiBilling.prepaidBalanceCents === 'number' && xaiBilling.prepaidBalanceCents > 0) {
      extras.push({
        id: 'prepaid',
        label: t('xai_quota.prepaid'),
        remainingPercent: null,
        resetAtMs: null,
        resetLabel: null,
        detail: formatUsdFromCents(xaiBilling.prepaidBalanceCents),
      });
    }

    const codexCredits = (codexQuota?.rateLimitResetCredits ?? []).filter(
      (credit) => credit.status === 'available' || credit.status === undefined
    );
    const extraUsage = claudeQuota && hasReadings ? (claudeQuota.extraUsage ?? null) : null;
    const formatMinor = (value: number | null, currency: string | null) => {
      if (value === null) return '--';
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency ?? 'USD',
        }).format(value / 100);
      } catch {
        return `${(value / 100).toFixed(2)} ${currency ?? 'USD'}`;
      }
    };
    const extraUsageSummary = extraUsage
      ? extraUsage.isEnabled === false
        ? t('claude_quota.extra_usage_disabled')
        : t('quota_cards.spent_of_limit', {
            spent: formatMinor(extraUsage.usedCredits, extraUsage.currency),
            limit: formatMinor(extraUsage.monthlyLimit, extraUsage.currency),
          })
      : '';
    const extraUsageNotes = extraUsage
      ? [
          extraUsage.userDisabled ? t('claude_quota.extra_usage_user_disabled') : '',
          extraUsage.spendLimitReached ? t('claude_quota.extra_usage_spend_limit_reached') : '',
          extraUsage.disabledReason
            ? t('claude_quota.extra_usage_disabled_reason', { reason: extraUsage.disabledReason })
            : '',
        ].filter(Boolean)
      : [];

    const slotState = (slot: QuotaSlotId) => {
      if (!hasReadings) return 'pending' as const;
      return cardSlots?.slots[slot] ? ('live' as const) : ('off' as const);
    };

    return (
      <article
        className={`${styles.card} ${mountEntranceDelayMs === null ? '' : styles.cardEnter}`}
        style={entranceStyle}
        data-ended={ended ? 1 : 0}
        data-layout="slots"
      >
        {header}
        <div className={styles.metaRow}>{meta}</div>

        <div className={styles.body}>
          <div className={styles.slots} aria-busy={loading || undefined}>
            {columns.map((slot, index) => {
              const reading = cardSlots?.slots[slot];
              const state = slotState(slot);
              return (
                <QuotaSlot
                  key={slot}
                  variant={reading?.variant ?? slotVariants?.[slot] ?? slot}
                  state={state}
                  remainingPercent={reading?.remainingPercent ?? null}
                  reset={
                    reading
                      ? buildResetDisplay(reading.resetLabel, reading.resetAtMs, nowMs, locale)
                      : null
                  }
                  soon={Boolean(reading && reading.rowId === soonestRowId)}
                  classes={quotaClasses}
                  index={index}
                />
              );
            })}
          </div>
          {loading && (
            <div role="status" aria-busy="true" className={styles.statusLine}>
              {t(`${adapter.i18nPrefix}.loading`)}
            </div>
          )}
          {status === 'idle' && (
            <div className={styles.statusLine}>{t('quota_cards.not_loaded')}</div>
          )}
          {status === 'error' && (
            <div className={styles.errorStrip} role="alert">
              {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
            </div>
          )}
          {claudeQuota?.stale && (
            <div role="status" className={quotaClasses.codexResetCreditsError}>
              {t('claude_quota.stale_snapshot', {
                time: claudeQuota.observedAt
                  ? new Date(claudeQuota.observedAt).toLocaleString(locale)
                  : '--',
              })}
            </div>
          )}
          {showClaudeReset && claudeReset.message && (
            <div role="status" className={quotaClasses.codexResetCreditsError}>
              {t(`claude_reset.${claudeReset.message}`)}
            </div>
          )}
          {codexQuota?.rateLimitResetCreditsError && (
            <div className={quotaClasses.codexResetCreditsError}>
              {t('codex_quota.reset_credits_expiry_failed', {
                message: codexQuota.rateLimitResetCreditsError,
              })}
            </div>
          )}
        </div>

        {endControl}

        {(showClaudeReset && claudeReset.lines.length > 0) || codexCredits.length > 0 ||
        extraUsage || extras.length > 0 ? (
          <div className={styles.sections}>
            {showClaudeReset && claudeReset.lines.length > 0 && (
              <QuotaCardSection
                title={t('quota_cards.resets', { count: usableGrantCount(claudeReset.lines) })}
              >
                <ClaudeGrantRows
                  lines={claudeReset.lines}
                  nowMs={nowMs}
                  onUse={claudeReset.use}
                />
              </QuotaCardSection>
            )}
            {codexCredits.length > 0 && (
              <QuotaCardSection title={t('quota_cards.resets', { count: codexCredits.length })}>
                {codexCredits.map((credit, index) => {
                  const expiresAtMs = parseIsoToMs(credit.expiresAt);
                  const display = buildResetDisplay(
                    expiresAtMs === null ? credit.expiresAt : formatInstantShort(expiresAtMs),
                    expiresAtMs,
                    nowMs,
                    locale
                  );
                  return (
                    <div key={resetCreditRowId(credit, index)} className={styles.plainRow}>
                      <span className={styles.plainLabel}>
                        {t('codex_quota.reset_credit_number', { index: index + 1 })}
                      </span>
                      <span className={styles.plainMeta}>
                        {display
                          ? `${display.absolute}${display.relative ? ` · ${display.relative}` : ''}`
                          : '--'}
                      </span>
                    </div>
                  );
                })}
              </QuotaCardSection>
            )}
            {extraUsage && (
              <QuotaCardSection
                title={t('claude_quota.extra_usage_label')}
                summary={extraUsageSummary}
              >
                <div className={styles.plainRow}>
                  <span className={styles.plainLabel}>
                    {t('claude_quota.usage_spent_limit', {
                      spent: formatMinor(extraUsage.usedCredits, extraUsage.currency),
                      limit: formatMinor(extraUsage.monthlyLimit, extraUsage.currency),
                    })}
                  </span>
                  {extraUsage.utilization !== null && (
                    <span className={styles.plainMeta}>
                      {t('claude_quota.usage_utilization', { percent: extraUsage.utilization })}
                    </span>
                  )}
                </div>
                {extraUsageNotes.map((note) => (
                  <div key={note} className={styles.plainMeta}>
                    {note}
                  </div>
                ))}
              </QuotaCardSection>
            )}
            {extras.length > 0 && (
              <QuotaCardSection
                title={t('quota_cards.more_limits')}
                summary={String(extras.length)}
              >
                <ExtraLimitRows extras={extras} nowMs={nowMs} />
              </QuotaCardSection>
            )}
          </div>
        ) : null}

        <footer className={styles.actionRow}>
          {resetButton}
          {refreshButton}
        </footer>
      </article>
    );
  }

  // Claude banked resets join the plan chip row; their expiry list follows it.
  const claudePlanItems = showClaudeReset ? (
    <span className={quotaClasses.codexPlanItem}>
      <span className={quotaClasses.codexPlanLabel}>{t('claude_reset.remaining')}</span>
      <span className={quotaClasses.codexPlanValue}>{claudeReset.count ?? '--'}</span>
    </span>
  ) : undefined;
  const claudeAfterPlan = showClaudeReset ? (
    <>
      <ClaudeResetGrantDetails
        lines={claudeReset.lines}
        classes={quotaClasses}
        actionClassName={`${styles.actionPill} ${styles.actionPillCompact}`}
        onUse={claudeReset.use}
      />
      {claudeReset.message && (
        <div role="status" className={quotaClasses.codexResetCreditsError}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </>
  ) : undefined;

  return (
    <article
      className={`${styles.card} ${mountEntranceDelayMs === null ? '' : styles.cardEnter}`}
      style={entranceStyle}
      data-ended={ended ? 1 : 0}
    >
      {header}

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.idleBody}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={15} aria-hidden="true" className={styles.idleGlyph} />
            <span className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading && !retainedClaudeUsage ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <>
            <div className={styles.errorStrip} role="alert">
              {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
            </div>
            {!retainedClaudeUsage && claudeAfterPlan}
          </>
        ) : quota && !retainedClaudeUsage ? (
          <adapter.Body
            quota={quota}
            classes={quotaClasses}
            planItems={claudePlanItems}
            afterPlan={claudeAfterPlan}
          />
        ) : !retainedClaudeUsage ? (
          <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>
        ) : null}
        {loading && retainedClaudeUsage && (
          <div role="status" aria-busy="true" className={quotaClasses.quotaMessage}>
            {t(`${adapter.i18nPrefix}.loading`)}
          </div>
        )}
        {retainedClaudeUsage && quota && (
          <adapter.Body
            quota={quota}
            classes={quotaClasses}
            planItems={claudePlanItems}
            afterPlan={claudeAfterPlan}
          />
        )}
      </div>

      {endControl}

      {status !== 'idle' && (
        <footer className={styles.actionRow}>
          {resetButton}
          {refreshButton}
        </footer>
      )}
    </article>
  );
}
