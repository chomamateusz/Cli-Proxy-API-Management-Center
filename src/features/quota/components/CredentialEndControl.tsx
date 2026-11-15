import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconPencil, IconX } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem, CredentialEndSource } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import { parseIsoToMs } from '@/utils/quota';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import {
  buildCredentialEndDisplay,
  formatEndAbsolute,
  localInputToMs,
  msToLocalInput,
  readCredentialEnd,
  toUtcSeconds,
} from '../credentialEnd';
import styles from './CredentialEndControl.module.scss';

export type CancelCredentialOutcome = 'scheduled' | 'no_billing_anchor';

export interface CredentialEndActions {
  save: (file: AuthFileItem, fleetEndsAt: string | null) => Promise<void>;
  cancel: (file: AuthFileItem) => Promise<CancelCredentialOutcome>;
  nextPeriod: (file: AuthFileItem) => Promise<void>;
}

export interface CredentialEndControlProps {
  file: AuthFileItem;
  subject: string;
  variant: 'card' | 'row';
  paidUntilMs?: number | null;
  cancellable?: boolean;
  unusedResets?: number;
  disabled?: boolean;
  actions: CredentialEndActions;
  nowMs?: number;
}

const SOURCE_KEYS: Record<CredentialEndSource, string> = {
  manual: 'credential_end.source_manual',
  'claude-anniversary': 'credential_end.source_claude_anniversary',
  'codex-api': 'credential_end.source_codex_api',
  'plan-ended': 'credential_end.source_plan_ended',
};

export function CredentialEndControl({
  file,
  subject,
  variant,
  paidUntilMs = null,
  cancellable = false,
  unusedResets = 0,
  disabled = false,
  actions,
  nowMs: nowProp,
}: CredentialEndControlProps) {
  const { t, i18n } = useTranslation();
  const tick = useNow(nowProp === undefined);
  const nowMs = nowProp ?? tick;
  const locale = i18n.resolvedLanguage;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { endsAtMs, state, ended, source, warnings } = readCredentialEnd(file, nowMs);
  const display =
    endsAtMs === null ? null : buildCredentialEndDisplay(endsAtMs, ended, nowMs, locale);
  const locked = disabled || saving || file.runtimeOnly === true;
  const offerPaidUntil = endsAtMs === null && paidUntilMs !== null && !editing;
  const offerCancel = cancellable && endsAtMs === null && !editing;
  const endDate = endsAtMs === null ? '' : formatEndAbsolute(endsAtMs, locale);
  const providerRenews =
    endsAtMs !== null && warnings.some((warning) => warning.code === 'provider_renews');
  const graceUntilMs = warnings
    .filter((warning) => warning.code === 'grace_period')
    .map((warning) => parseIsoToMs(warning.until))
    .find((ms): ms is number => ms !== null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const run = async (action: () => Promise<boolean | void>) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if ((await action()) !== false) setEditing(false);
    } catch (err: unknown) {
      setError(
        t('credential_end.save_failed', {
          message: getErrorMessage(err, t('common.unknown_error')),
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const save = (fleetEndsAt: string | null) => run(() => actions.save(file, fleetEndsAt));

  const startEditing = () => {
    setDraft(msToLocalInput(endsAtMs ?? paidUntilMs ?? nowMs));
    setError('');
    setEditing(true);
  };

  const markCancelled = () =>
    run(async () => {
      if ((await actions.cancel(file)) === 'scheduled') return true;
      startEditing();
      setNotice(t('credential_end.no_billing_anchor'));
      return false;
    });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ms = localInputToMs(draft);
    if (ms === null) {
      setError(t('credential_end.invalid'));
      return;
    }
    void save(toUtcSeconds(ms));
  };

  const stopEditing = () => {
    setEditing(false);
    setError('');
    setNotice('');
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      stopEditing();
    }
  };

  const relativeText = display
    ? display.ended
      ? t('credential_end.ended_ago', { relative: display.relative })
      : display.relative
    : '';

  return (
    <div
      className={styles.root}
      data-variant={variant}
      data-ended={ended ? 1 : 0}
      data-state={state}
      role="group"
      aria-label={t('credential_end.group_label', { name: subject })}
    >
      <div className={styles.line}>
        <span className={styles.label}>{t('credential_end.label')}</span>
        {display ? (
          <span className={styles.value}>
            <span className={styles.absolute}>{display.absolute}</span>
            <span className={styles.relative}>{relativeText}</span>
            {source && <span className={styles.source}>{t(SOURCE_KEYS[source])}</span>}
          </span>
        ) : (
          <span className={styles.unset}>{t('credential_end.not_set')}</span>
        )}
        <span className={styles.actions}>
          {offerCancel && (
            <button
              type="button"
              className={styles.action}
              disabled={locked}
              onClick={() => void markCancelled()}
              title={t('credential_end.cancelled_hint')}
            >
              {t('credential_end.cancelled')}
            </button>
          )}
          {offerPaidUntil && paidUntilMs !== null && (
            <button
              type="button"
              className={styles.action}
              disabled={locked}
              onClick={() => void save(toUtcSeconds(paidUntilMs))}
              title={t('credential_end.use_paid_until_hint', {
                date: formatEndAbsolute(paidUntilMs, locale),
              })}
            >
              {t('credential_end.use_paid_until')}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className={styles.iconAction}
              disabled={locked}
              onClick={startEditing}
              aria-label={t(endsAtMs === null ? 'credential_end.set' : 'credential_end.edit')}
              title={t(endsAtMs === null ? 'credential_end.set' : 'credential_end.edit')}
            >
              <IconPencil size={12} aria-hidden="true" />
            </button>
          )}
          {endsAtMs !== null && !editing && (
            <button
              type="button"
              className={styles.iconAction}
              disabled={locked}
              onClick={() => void save(null)}
              aria-label={t('credential_end.clear')}
              title={t('credential_end.clear')}
            >
              <IconX size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      {state === 'overdue' && (
        <div className={styles.banner} data-tone="warning" role="status">
          <IconAlertTriangle size={13} aria-hidden="true" className={styles.bannerIcon} />
          <span className={styles.bannerText}>
            {t('credential_end.overdue', { date: endDate })}
          </span>
          <span className={styles.bannerActions}>
            <button
              type="button"
              className={styles.action}
              disabled={locked}
              onClick={() => void save(null)}
            >
              {t('credential_end.overdue_not_cancelled')}
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={locked}
              onClick={() => void run(() => actions.nextPeriod(file))}
            >
              {t('credential_end.overdue_next_period')}
            </button>
            <button
              type="button"
              className={styles.action}
              disabled={locked || editing}
              onClick={startEditing}
            >
              {t('credential_end.overdue_set_date')}
            </button>
          </span>
        </div>
      )}
      {providerRenews && (
        <div className={styles.banner} data-tone="info" role="status">
          <span className={styles.bannerText}>{t('credential_end.provider_renews')}</span>
          <span className={styles.bannerActions}>
            <button
              type="button"
              className={styles.action}
              disabled={locked}
              onClick={() => void save(null)}
            >
              {t('credential_end.provider_renews_remove')}
            </button>
          </span>
        </div>
      )}
      {graceUntilMs !== undefined && (
        <div className={styles.banner} data-tone="warning" role="status">
          <IconAlertTriangle size={13} aria-hidden="true" className={styles.bannerIcon} />
          <span className={styles.bannerText}>
            {t('credential_end.grace_period', { date: formatEndAbsolute(graceUntilMs, locale) })}
          </span>
        </div>
      )}
      {unusedResets > 0 && (
        <div className={styles.note}>
          {t('credential_end.unused_resets', { count: unusedResets })}
        </div>
      )}
      {editing && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor={`${id}-input`} className={styles.srOnly}>
            {t('credential_end.input_label', { timezone: resolveTimeZoneLabel() })}
          </label>
          <input
            ref={inputRef}
            id={`${id}-input`}
            type="datetime-local"
            className={styles.input}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <span className={styles.zone}>{resolveTimeZoneLabel()}</span>
          <button type="submit" className={styles.action} disabled={saving}>
            {t('credential_end.save')}
          </button>
          <button type="button" className={styles.action} disabled={saving} onClick={stopEditing}>
            {t('credential_end.cancel')}
          </button>
        </form>
      )}
      {notice && <div className={styles.note}>{notice}</div>}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
