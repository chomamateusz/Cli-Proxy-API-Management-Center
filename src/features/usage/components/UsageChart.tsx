import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SeriesGranularity } from '@/types/fleetUsage';
import {
  formatCompact,
  niceCeiling,
  timeTicks,
  type ChartBucket,
} from '../usageSeries';
import type { TimeRange } from '../usageRange';
import {
  formatBucketLabel,
  formatClock,
  formatDay,
  formatInteger,
  seriesColor,
} from '../usageFormat';
import styles from './UsageChart.module.scss';

const BOX = 1000;
const Y_FRACTIONS = [1, 0.75, 0.5, 0.25, 0];
const SEPARATED_BAR_LIMIT = 200;

export interface UsageChartProps {
  buckets: readonly ChartBucket[];
  segments: readonly string[];
  slots: ReadonlyMap<string, number>;
  granularity: SeriesGranularity;
  range: TimeRange;
  ariaLabel: string;
}

const barGapFraction = (count: number) =>
  count <= 60 ? 0.24 : count <= SEPARATED_BAR_LIMIT ? 0.12 : 0;

export function UsageChart({
  buckets,
  segments,
  slots,
  granularity,
  range,
  ariaLabel,
}: UsageChartProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const plotRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const count = buckets.length;
  const firstMs = buckets[0]?.startMs ?? range.fromMs;
  const lastMs = buckets[count - 1]?.endMs ?? range.toMs;
  const spanMs = Math.max(1, lastMs - firstMs);
  const ceiling = niceCeiling(buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0));
  const barWidth = BOX / Math.max(1, count);
  const gap = barWidth * barGapFraction(count);
  const leftPercent = (ms: number) => ((ms - firstMs) / spanMs) * 100;

  const pickBucket = (event: PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || count === 0) return;
    const fraction = Math.min(0.9999, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHoverIndex(Math.floor(fraction * count));
  };

  const hovered = hoverIndex === null ? null : (buckets[hoverIndex] ?? null);
  const hoveredRows = hovered
    ? segments
        .map((segment) => ({ segment, value: hovered.values.get(segment) ?? 0 }))
        .sort((left, right) => right.value - left.value)
    : [];
  const hoverCenter = hovered ? leftPercent((hovered.startMs + hovered.endMs) / 2) : 0;

  return (
    <div className={styles.chart}>
      <div className={styles.yAxis} aria-hidden="true">
        {Y_FRACTIONS.map((fraction) => (
          <span key={fraction} style={{ top: `${(1 - fraction) * 100}%` }}>
            {formatCompact(ceiling * fraction)}
          </span>
        ))}
      </div>
      <div
        ref={plotRef}
        className={styles.plot}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={pickBucket}
        onPointerDown={pickBucket}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setHoverIndex(null);
        }}
      >
        {Y_FRACTIONS.map((fraction) => (
          <span
            key={fraction}
            className={styles.gridLine}
            style={{ top: `${(1 - fraction) * 100}%` }}
          />
        ))}
        <svg
          className={styles.svg}
          viewBox={`0 0 ${BOX} ${BOX}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {hovered && (
            <rect
              className={styles.hoverColumn}
              x={(hoverIndex ?? 0) * barWidth}
              y={0}
              width={barWidth}
              height={BOX}
            />
          )}
          {buckets.map((bucket, index) => {
            let base = BOX;
            return segments.map((segment) => {
              const value = bucket.values.get(segment) ?? 0;
              if (value <= 0) return null;
              const height = (value / ceiling) * BOX;
              base -= height;
              return (
                <rect
                  key={`${bucket.startMs}-${segment}`}
                  className={
                    count <= SEPARATED_BAR_LIMIT ? styles.segmentSeparated : styles.segment
                  }
                  x={index * barWidth + gap / 2}
                  y={base}
                  width={Math.max(barWidth - gap, 0.5)}
                  height={height}
                  style={{ fill: seriesColor(segment, slots) }}
                />
              );
            });
          })}
        </svg>
        {hovered && (
          <div
            className={styles.tooltip}
            data-flip={hoverCenter > 50 ? 'true' : undefined}
            style={{ left: `${hoverCenter}%` }}
          >
            <span className={styles.tooltipTitle}>
              {formatBucketLabel(hovered.startMs, hovered.endMs, granularity, locale)}
            </span>
            {hoveredRows.map(({ segment, value }) => (
              <span key={segment} className={styles.tooltipRow}>
                <span
                  className={styles.swatch}
                  style={{ '--swatch': seriesColor(segment, slots) } as CSSProperties}
                />
                <span className={styles.tooltipName} title={segment}>
                  {segment}
                </span>
                <span className={styles.tooltipValue}>{formatInteger(value, locale)}</span>
              </span>
            ))}
            <span className={styles.tooltipTotal}>
              <span>{t('usage.chart.bucket_total')}</span>
              <span className={styles.tooltipValue}>{formatInteger(hovered.total, locale)}</span>
            </span>
          </div>
        )}
      </div>
      <div className={styles.xAxis} aria-hidden="true">
        {timeTicks({ fromMs: firstMs, toMs: lastMs }).map((tick) => {
          const left = leftPercent(tick.atMs);
          return (
            <span
              key={tick.atMs}
              data-day={tick.dayStart ? 'true' : undefined}
              data-edge={left < 4 ? 'start' : left > 94 ? 'end' : undefined}
              style={{ left: `${left}%` }}
            >
              {tick.dayStart ? formatDay(tick.atMs, locale) : formatClock(tick.atMs, locale)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
