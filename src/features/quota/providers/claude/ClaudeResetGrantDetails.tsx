import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, parseIsoToMs } from '@/utils/quota';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import type { QuotaClassMap } from '../../types';
import { ClaudeResetGrantAction } from './ClaudeResetGrantAction';
import type { ResetGrantLine } from './resetGrantAvailability';

interface ClaudeResetGrantDetailsProps {
  lines: readonly ResetGrantLine[];
  classes: QuotaClassMap;
  actionClassName: string;
  onUse: (grantId: string) => void;
}

/** Match Codex's reset-credit details without treating a multi-reset grant as one credit. */
export function ClaudeResetGrantDetails({
  lines,
  classes,
  actionClassName,
  onUse,
}: ClaudeResetGrantDetailsProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  if (lines.length === 0) return null;

  return (
    <div className={classes.codexResetCredits}>
      <div className={classes.codexResetCreditsTitle}>
        {t('claude_reset.expiry_title', { timezone: resolveTimeZoneLabel() })}
      </div>
      {lines.map((line) => {
        const display = buildResetDisplay(
          null,
          parseIsoToMs(line.endsAt),
          now,
          i18n.resolvedLanguage
        );
        return (
          <div key={line.id} className={classes.codexResetCreditRow}>
            <span className={classes.codexResetCreditLabel}>
              {line.label}
              {line.resetsLeft !== null &&
                line.resetsTotal !== null &&
                ` · ${t('claude_reset.count', { left: line.resetsLeft, total: line.resetsTotal })}`}
            </span>
            <span className={classes.codexResetCreditTime}>
              {display ? (
                <QuotaResetLabel display={display} classes={classes} />
              ) : (
                <span className={classes.quotaReset}>{t('claude_reset.expiry_unknown')}</span>
              )}
            </span>
            <ClaudeResetGrantAction line={line} className={actionClassName} onUse={onUse} />
          </div>
        );
      })}
    </div>
  );
}
