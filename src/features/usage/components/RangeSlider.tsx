import { useTranslation } from 'react-i18next';
import styles from './RangeSlider.module.scss';

export interface RangeSliderProps {
  steps: number;
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
  formatStep: (step: number) => string;
}

export function RangeSlider({ steps, lo, hi, onChange, formatStep }: RangeSliderProps) {
  const { t } = useTranslation();
  const percent = (step: number) => (steps > 0 ? (step / steps) * 100 : 0);

  return (
    <div className={styles.range}>
      <div className={styles.track} />
      <div
        className={styles.fill}
        style={{ left: `${percent(lo)}%`, width: `${percent(hi) - percent(lo)}%` }}
      />
      <input
        type="range"
        min={0}
        max={steps}
        step={1}
        value={lo}
        aria-label={t('usage.range.start')}
        aria-valuetext={formatStep(lo)}
        onChange={(event) => onChange(Math.min(Number(event.target.value), hi - 1), hi)}
      />
      <input
        type="range"
        min={0}
        max={steps}
        step={1}
        value={hi}
        aria-label={t('usage.range.end')}
        aria-valuetext={formatStep(hi)}
        onChange={(event) => onChange(lo, Math.max(Number(event.target.value), lo + 1))}
      />
    </div>
  );
}
