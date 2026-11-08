import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { IconLock, IconSearch } from '@/components/ui/icons';
import styles from './ModelMatrix.module.scss';

interface MatrixToolbarProps {
  filter: string;
  provider: string;
  providers: { value: string; label: string }[];
  onFilterChange: (value: string) => void;
  onProviderChange: (value: string) => void;
}

export function MatrixToolbar({
  filter,
  provider,
  providers,
  onFilterChange,
  onProviderChange,
}: MatrixToolbarProps) {
  const { t } = useTranslation();
  const providerLabelId = useId();
  return (
    <div className={styles.toolbar}>
      <div className={styles.filters}>
        <div className={styles.filterInput}>
          <Input
            label={t('client_keys.matrix.filter_label')}
            placeholder={t('client_keys.matrix.filter_placeholder')}
            value={filter}
            type="search"
            rightElement={<IconSearch size={14} />}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </div>
        <div className={`form-group ${styles.providerFilter}`}>
          <label id={providerLabelId}>{t('client_keys.matrix.provider_filter_label')}</label>
          <Select
            value={provider}
            options={[{ value: '', label: t('client_keys.matrix.provider_all') }, ...providers]}
            onChange={onProviderChange}
            ariaLabelledBy={providerLabelId}
          />
        </div>
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendAllowed}`} />
          {t('client_keys.matrix.legend_allowed')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} />
          {t('client_keys.matrix.legend_blocked')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.cellPattern}`}>
            <IconLock size={10} className={styles.lockIcon} />
          </span>
          {t('client_keys.matrix.legend_pattern')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.cellMuted}`}>
            <IconLock size={10} className={styles.lockIcon} />
          </span>
          {t('client_keys.matrix.legend_allowlist')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch}>
            <span className={styles.unreachableDot} />
          </span>
          {t('client_keys.matrix.legend_unreachable')}
        </span>
      </div>
    </div>
  );
}
