import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import type { QuotaGroupKind } from '../quotaGroups';
import { slotLabelKey, type GroupPools } from '../quotaSlots';
import { ROUTER_FAMILIES, type RouterFamily } from '../routerOrder';
import type { QuotaProviderType } from '../providers/types';
import { QuotaSlot } from './QuotaSlot';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCardGroup.module.scss';

const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export interface QuotaCardGroupProps {
  kind: QuotaGroupKind;
  type: QuotaProviderType | null;
  accountCount: number;
  loadedCount: number;
  pools: GroupPools | null;
  resolvedTheme: ResolvedTheme;
  /** Null hides the router note. */
  routerStrategy: string | null;
  family?: { value: RouterFamily; onChange: (family: RouterFamily) => void } | null;
  children: ReactNode;
}

export function QuotaCardGroup({
  kind,
  type,
  accountCount,
  loadedCount,
  pools,
  resolvedTheme,
  routerStrategy,
  family,
  children,
}: QuotaCardGroupProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const title =
    kind === 'provider' && type
      ? getTypeLabel(t, type)
      : t(kind === 'others' ? 'quota_groups.all_others' : 'quota_groups.all_accounts');
  const iconSrc = type ? getAuthFileIcon(type, resolvedTheme) : null;
  const showPools = pools !== null && pools.pools.length > 0;

  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 id={headingId} className={styles.title}>
            <span
              className={styles.iconWrap}
              style={
                type && isThemeSurfaceIconProvider(type)
                  ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                  : undefined
              }
            >
              {iconSrc ? (
                <img src={iconSrc} alt="" className={styles.icon} />
              ) : (
                <IconFilterAll size={16} aria-hidden="true" />
              )}
            </span>
            {title}
          </h2>
          <span className={styles.counts}>
            {t('quota_groups.accounts', { count: accountCount })}
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            {t('quota_groups.loaded', { count: loadedCount, total: accountCount })}
          </span>
          {family && (
            <div
              className={styles.family}
              role="group"
              aria-label={t('quota_router.family_label')}
            >
              <span className={styles.familyLabel}>{t('quota_router.family_label')}</span>
              {ROUTER_FAMILIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={styles.familyOption}
                  aria-pressed={family.value === option}
                  onClick={() => family.onChange(option)}
                >
                  {t(`quota_router.family_${option}`)}
                </button>
              ))}
            </div>
          )}
        </div>
        {routerStrategy && (
          <p className={styles.note}>
            {routerStrategy === 'use-or-lose'
              ? t('quota_router.note')
              : t('quota_router.note_other', { strategy: routerStrategy })}
          </p>
        )}
        {showPools &&
          (loadedCount === 0 ? (
            <p className={styles.empty}>{t('quota_groups.nothing_loaded', {
                action: t('quota_management.refresh_all_credentials'),
              })}</p>
          ) : (
            <div
              className={styles.pools}
              style={{ '--pool-count': pools.pools.length } as CSSProperties}
            >
              {pools.pools.map((pool, index) => (
                <QuotaSlot
                  key={pool.slot}
                  variant={pool.variant}
                  state={pool.available && pool.covered > 0 ? 'live' : 'off'}
                  remainingPercent={pool.remainingPercent}
                  note={[
                    t('quota_groups.pool_covers', { covered: pool.covered, total: pool.total }),
                    pools.weighted ? t('quota_groups.weighted') : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  noteTitle={pools.weighted ? t('quota_groups.weighted_title') : undefined}
                  classes={quotaClasses}
                  index={index}
                  offLabelKey="quota_groups.pool_not_available"
                  ariaLabel={
                    pool.remainingPercent === null
                      ? undefined
                      : t('quota_groups.pool_label', {
                          label: t(slotLabelKey(pool.variant)),
                          percent: Math.round(pool.remainingPercent),
                          covered: pool.covered,
                          total: pool.total,
                        })
                  }
                />
              ))}
            </div>
          ))}
      </header>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}
