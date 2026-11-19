import { useTranslation } from 'react-i18next';
import type { ResetDisplay } from '@/utils/quota';
import type { QuotaClassMap } from '../types';
import { slotLabelKey, type QuotaSlotVariant } from '../quotaSlots';
import { QuotaMeter } from './QuotaMeter';
import styles from './QuotaSlot.module.scss';

export type QuotaSlotState = 'live' | 'off' | 'pending';

export interface QuotaSlotProps {
  variant: QuotaSlotVariant;
  state: QuotaSlotState;
  remainingPercent?: number | null;
  reset?: ResetDisplay | null;
  soon?: boolean;
  /** Replaces the reset line, for example a pooled bar's coverage. */
  note?: string;
  noteTitle?: string;
  classes: QuotaClassMap;
  index?: number;
  offLabelKey?: string;
  ariaLabel?: string;
}

export function QuotaSlot({
  variant,
  state,
  remainingPercent = null,
  reset = null,
  soon = false,
  note,
  noteTitle,
  classes,
  index,
  offLabelKey = 'quota_slots.not_available',
  ariaLabel,
}: QuotaSlotProps) {
  const { t } = useTranslation();
  const label = t(slotLabelKey(variant));
  const off = state === 'off';
  const value =
    state === 'live' && remainingPercent !== null ? `${Math.round(remainingPercent)}%` : null;

  return (
    <div
      className={styles.slot}
      data-state={state}
      role={off || ariaLabel ? 'group' : undefined}
      aria-label={off ? t(offLabelKey, { label }) : ariaLabel}
      title={soon ? t('quota_management.soonest_row_hint') : undefined}
    >
      <div className={styles.head} aria-hidden={off || undefined}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{off ? '—' : (value ?? '--')}</span>
      </div>
      {state === 'live' ? (
        <QuotaMeter percent={remainingPercent} classes={classes} index={index} />
      ) : (
        <div className={`${classes.quotaBar} ${styles.track}`} aria-hidden="true" />
      )}
      <div className={styles.foot} aria-hidden={off || undefined} title={noteTitle}>
        {note ? (
          <span className={styles.note}>{note}</span>
        ) : reset ? (
          <>
            <span className={styles.absolute}>{reset.absolute}</span>
            {reset.relative && (
              <span className={soon ? `${styles.relative} ${styles.soon}` : styles.relative}>
                {reset.relative}
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
