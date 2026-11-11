import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { maskCredentialName } from '../quotaOverview';
import { syncRevealState, type RevealState } from './revealState';
import styles from './PrivateText.module.scss';

export function PrivateText({
  text,
  className,
  showEmails,
}: {
  text: string;
  className: string;
  showEmails: boolean;
}) {
  const { t } = useTranslation();
  const [revealState, setRevealState] = useState<RevealState>({ revealed: false, showEmails });
  const synced = syncRevealState(revealState, showEmails);
  if (synced !== revealState) setRevealState(synced);
  const { revealed } = synced;
  if (showEmails || !text.includes('@')) {
    return (
      <span className={className} title={text}>
        {text}
      </span>
    );
  }
  const hint = t(revealed ? 'quota_overview.hide_email' : 'quota_overview.reveal_email');
  return (
    <button
      type="button"
      className={`${className} ${styles.private}`}
      title={hint}
      // While masked, announce the action instead of reading the bullets aloud.
      aria-label={revealed ? undefined : hint}
      onClick={() => setRevealState({ revealed: !revealed, showEmails })}
    >
      {revealed ? text : maskCredentialName(text)}
    </button>
  );
}
