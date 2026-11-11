import { useTranslation } from 'react-i18next';
import type { ResetGrantLine } from './resetGrantAvailability';

interface ClaudeResetGrantActionProps {
  line: ResetGrantLine;
  className: string;
  onUse: (grantId: string) => void;
}

export function ClaudeResetGrantAction({ line, className, onUse }: ClaudeResetGrantActionProps) {
  const { t } = useTranslation();
  const name = t(line.retry ? 'claude_reset.retry_grant' : 'claude_reset.use_grant', {
    label: line.label,
  });
  return (
    <button
      type="button"
      className={className}
      disabled={line.block !== null}
      onClick={() => onUse(line.id)}
      title={line.block ? t(`claude_reset.why_${line.block}`) : name}
      aria-label={name}
    >
      {t(line.retry ? 'claude_reset.retry_short' : 'claude_reset.use')}
    </button>
  );
}
