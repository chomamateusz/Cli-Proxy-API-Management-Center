import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPencil, IconX } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { AuthFileItem } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
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

export type SaveCredentialEnd = (file: AuthFileItem, fleetEndsAt: string | null) => Promise<void>;

export interface CredentialEndControlProps {
  file: AuthFileItem;
  subject: string;
  variant: 'card' | 'row';
  paidUntilMs?: number | null;
  disabled?: boolean;
  onSave: SaveCredentialEnd;
  /** Fixed clock for static rendering; defaults to the shared minute clock. */
  nowMs?: number;
}

export function CredentialEndControl({
  file,
  subject,
  variant,
  paidUntilMs = null,
  disabled = false,
  onSave,
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

  const { endsAtMs, ended } = readCredentialEnd(file, nowMs);
  const display =
    endsAtMs === null ? null : buildCredentialEndDisplay(endsAtMs, ended, nowMs, locale);
  const locked = disabled || saving || file.runtimeOnly === true;
  const offerPaidUntil = endsAtMs === null && paidUntilMs !== null && !editing;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async (fleetEndsAt: string | null) => {
    setSaving(true);
    setError('');
    try {
      await onSave(file, fleetEndsAt);
      setEditing(false);
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

  const startEditing = () => {
    setDraft(msToLocalInput(endsAtMs ?? paidUntilMs ?? nowMs));
    setError('');
    setEditing(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ms = localInputToMs(draft);
    if (ms === null) {
      setError(t('credential_end.invalid'));
      return;
    }
    void save(toUtcSeconds(ms));
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
      setError('');
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
      role="group"
      aria-label={t('credential_end.group_label', { name: subject })}
    >
      <div className={styles.line}>
        <span className={styles.label}>{t('credential_end.label')}</span>
        {display ? (
          <span className={styles.value}>
            <span className={styles.absolute}>{display.absolute}</span>
            <span className={styles.relative}>{relativeText}</span>
          </span>
        ) : (
          <span className={styles.unset}>{t('credential_end.not_set')}</span>
        )}
        <span className={styles.actions}>
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
          <button
            type="button"
            className={styles.action}
            disabled={saving}
            onClick={() => {
              setEditing(false);
              setError('');
            }}
          >
            {t('credential_end.cancel')}
          </button>
        </form>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
