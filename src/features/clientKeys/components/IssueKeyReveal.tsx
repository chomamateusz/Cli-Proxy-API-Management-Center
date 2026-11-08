import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconAlertTriangle, IconCopy } from '@/components/ui/icons';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './IssueKeyDialog.module.scss';

type CopyState = 'idle' | 'copied' | 'failed';

interface IssueKeyRevealProps {
  secret: string;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}

export function IssueKeyReveal({ secret, acknowledged, onAcknowledge }: IssueKeyRevealProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const copyId = useId();
  const warningId = useId();
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    document.getElementById(copyId)?.focus();
  }, [copyId]);

  const copy = async () => {
    setCopyState('idle');
    const copied = await copyToClipboard(secret);
    setCopyState(copied ? 'copied' : 'failed');
    if (!copied) {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
  };

  return (
    <div className={styles.reveal}>
      <Input
        id={inputId}
        label={t('client_keys.issue.secret_label')}
        value={secret}
        readOnly
        className={styles.secret}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className={styles.copyRow}>
        <Button
          id={copyId}
          variant="secondary"
          size="sm"
          aria-describedby={warningId}
          onClick={() => void copy()}
        >
          <span className={styles.buttonContent}>
            <IconCopy size={14} />
            {copyState === 'copied' ? t('client_keys.issue.copied') : t('client_keys.issue.copy')}
          </span>
        </Button>
        {copyState === 'failed' ? (
          <span className={styles.copyFailed}>{t('client_keys.issue.copy_failed')}</span>
        ) : null}
        <span className={styles.srOnly} aria-live="polite">
          {copyState === 'copied'
            ? t('client_keys.issue.copied')
            : copyState === 'failed'
              ? t('client_keys.issue.copy_failed')
              : ''}
        </span>
      </div>
      <div className={styles.warning}>
        <IconAlertTriangle size={16} />
        <p id={warningId}>{t('client_keys.issue.secret_warning')}</p>
      </div>
      <SelectionCheckbox
        checked={acknowledged}
        onChange={onAcknowledge}
        label={t('client_keys.issue.acknowledge')}
      />
    </div>
  );
}

export function IssueKeyRevealFooter({
  acknowledged,
  onDone,
}: {
  acknowledged: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button variant="primary" disabled={!acknowledged} onClick={onDone}>
      {t('client_keys.issue.done')}
    </Button>
  );
}
