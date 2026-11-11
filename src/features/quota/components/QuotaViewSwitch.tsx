import { useTranslation } from 'react-i18next';
import { QUOTA_VIEWS, type QuotaView } from '../constants';
import styles from './QuotaViewSwitch.module.scss';

export function QuotaViewSwitch({
  view,
  onChange,
}: {
  view: QuotaView;
  onChange: (view: QuotaView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.switch} role="group" aria-label={t('quota_overview.view_label')}>
      {QUOTA_VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.option}
          aria-pressed={view === option}
          onClick={() => onChange(option)}
        >
          {t(`quota_overview.view_${option}`)}
        </button>
      ))}
    </div>
  );
}
