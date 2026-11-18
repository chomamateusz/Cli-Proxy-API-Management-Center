import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { getTypeLabel } from '@/features/authFiles/constants';
import { clientKeyErrorMessage, type ClassifiedClientKeyError } from '@/features/clientKeys/errors';
import type { ClientKeyUsageReport } from '@/types/fleetUsage';
import { HOUR_MS } from '@/utils/time/durations';
import {
  RANGE_PRESETS,
  rangeFromSlider,
  recordedSpan,
  sliderPosition,
  type RangePreset,
  type RangeSelection,
  type TimeRange,
} from '../usageRange';
import {
  ALL_PROVIDERS,
  OTHER_SEGMENT,
  USAGE_METRICS,
  assignColorSlots,
  buildChartBuckets,
  buildKeyTotals,
  providersIn,
  segmentOf,
  seriesKeyOrder,
  type UsageMetric,
} from '../usageSeries';
import { formatDateTime, seriesColor } from '../usageFormat';
import { RangeSlider } from './RangeSlider';
import { SegmentedControl } from './SegmentedControl';
import { UsageChart } from './UsageChart';
import { UsageTotalsTable } from './UsageTotalsTable';
import styles from './UsageByKey.module.scss';

const EMPTY_SLOTS: ReadonlyMap<string, number> = new Map();

export interface UsageByKeyProps {
  report: ClientKeyUsageReport | null;
  loading: boolean;
  error: ClassifiedClientKeyError | null;
  nowMs: number;
  range: TimeRange;
  selection: RangeSelection;
  onSelectionChange: (selection: RangeSelection) => void;
  metric: UsageMetric;
  onMetricChange: (metric: UsageMetric) => void;
  onRetry: () => void;
}

export function UsageByKey({
  report,
  loading,
  error,
  nowMs,
  range,
  selection,
  onSelectionChange,
  metric,
  onMetricChange,
  onRetry,
}: UsageByKeyProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [slots, setSlots] = useState<ReadonlyMap<string, number>>(EMPTY_SLOTS);

  const series = useMemo(() => report?.series ?? [], [report]);
  const orderedNames = useMemo(() => {
    const names = seriesKeyOrder(series, 'total');
    const seen = new Set(names);
    report?.keys.forEach((key) => {
      if (!seen.has(key.name)) names.push(key.name);
    });
    return names;
  }, [report, series]);

  const nextSlots = useMemo(() => assignColorSlots(slots, orderedNames), [slots, orderedNames]);
  if (nextSlots.size !== slots.size) setSlots(nextSlots);

  const providers = providersIn(report);
  const providerOptions = [ALL_PROVIDERS, ...providers];
  if (!providerOptions.includes(provider)) providerOptions.push(provider);

  const segments = useMemo(() => {
    const present = new Set(orderedNames.map((name) => segmentOf(name, nextSlots)));
    return [...present].sort(
      (left, right) => (nextSlots.get(left) ?? Infinity) - (nextSlots.get(right) ?? Infinity)
    );
  }, [orderedNames, nextSlots]);

  const buckets = useMemo(
    () =>
      report
        ? buildChartBuckets(series, {
            range: { fromMs: report.fromMs, toMs: report.toMs },
            granularity: report.granularity,
            metric,
            provider,
            slots: nextSlots,
            hidden,
          })
        : [],
    [report, series, metric, provider, nextSlots, hidden]
  );
  const totals = useMemo(
    () => (report ? buildKeyTotals(report.keys, metric, provider) : []),
    [report, metric, provider]
  );

  const metricLabel = t(`usage.metric.${metric}`);
  const segmentLabel = (segment: string) =>
    segment === OTHER_SEGMENT ? t('usage.chart.other') : segment;
  const visibleSegments = segments.filter((segment) => !hidden.has(segment));
  const toggleSegment = (segment: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(segment)) next.add(segment);
      return next;
    });

  const recordingSinceMs = report?.recordingSinceMs ?? null;
  const span = recordedSpan(recordingSinceMs, nowMs);
  const slider = sliderPosition(range, span);
  const activePreset = selection.kind === 'preset' ? selection.preset : null;
  const windowLabel = `${formatDateTime(range.fromMs, locale)} – ${formatDateTime(
    Math.min(range.toMs, nowMs),
    locale
  )}`;
  const hasData = buckets.some((bucket) => bucket.total > 0);

  const renderChart = () => {
    if (error && !report) {
      const message =
        error.kind === 'unsupported'
          ? t('usage.unsupported')
          : error.kind === 'forbidden'
            ? t('client_keys.forbidden_desc')
            : clientKeyErrorMessage(t, error);
      return (
        <EmptyState
          title={t('usage.load_failed')}
          description={message}
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('usage.retry')}
            </Button>
          }
        />
      );
    }
    if (!report) {
      return (
        <div role="status" className={styles.loading}>
          <span className={styles.srOnly}>{t('usage.loading')}</span>
          <Skeleton height={220} />
        </div>
      );
    }
    if (!hasData) {
      return (
        <EmptyState
          title={recordingSinceMs === null ? t('usage.empty_never') : t('usage.empty_range')}
        />
      );
    }
    return (
      <UsageChart
        buckets={buckets}
        segments={visibleSegments}
        slots={nextSlots}
        granularity={report.granularity}
        range={{ fromMs: report.fromMs, toMs: report.toMs }}
        segmentLabel={segmentLabel}
        ariaLabel={t('usage.chart.aria', { metric: metricLabel, range: windowLabel })}
      />
    );
  };

  return (
    <>
      <section className={styles.panel} aria-labelledby="usage-by-key-title">
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h2 id="usage-by-key-title" className={styles.title}>
              {t('usage.by_key.title')}
            </h2>
            <p className={styles.caption}>
              {recordingSinceMs === null
                ? t('usage.by_key.local_time')
                : t('usage.by_key.recording_since', {
                    since: formatDateTime(recordingSinceMs, locale),
                  })}
              {report && report.granularity === 'day' ? ` · ${t('usage.by_key.daily')}` : ''}
              {loading && report ? ` · ${t('usage.refreshing')}` : ''}
            </p>
          </div>
          {error && report && (
            <span className={styles.staleError} role="status">
              {t('usage.refresh_failed')}
            </span>
          )}
        </header>

        <div className={styles.toolbar}>
          <SegmentedControl<RangePreset>
            label={t('usage.range.label')}
            value={activePreset}
            options={RANGE_PRESETS.map((preset) => ({
              value: preset,
              label: t(`usage.range.${preset}`),
            }))}
            onChange={(preset) => onSelectionChange({ kind: 'preset', preset })}
          />
          <SegmentedControl<UsageMetric>
            label={t('usage.metric.label')}
            value={metric}
            options={USAGE_METRICS.map((value) => ({
              value,
              label: t(`usage.metric.${value}`),
            }))}
            onChange={onMetricChange}
          />
          {providers.length > 1 || provider !== ALL_PROVIDERS ? (
            <SegmentedControl<string>
              label={t('usage.provider.label')}
              value={provider}
              options={providerOptions.map((value) => ({
                value,
                label: value === ALL_PROVIDERS ? t('usage.provider.all') : getTypeLabel(t, value),
              }))}
              onChange={setProvider}
            />
          ) : null}
        </div>

        {segments.length > 0 && (
          <div className={styles.legend} role="group" aria-label={t('usage.chart.legend')}>
            {segments.map((segment) => (
              <button
                key={segment}
                type="button"
                className={styles.legendItem}
                aria-pressed={!hidden.has(segment)}
                title={segmentLabel(segment)}
                onClick={() => toggleSegment(segment)}
              >
                <span
                  className={styles.swatch}
                  style={{ '--swatch': seriesColor(segment, nextSlots) } as CSSProperties}
                />
                <span className={styles.legendName}>{segmentLabel(segment)}</span>
              </button>
            ))}
          </div>
        )}

        {renderChart()}

        {recordingSinceMs !== null && (
          <RangeSlider
            steps={slider.steps}
            lo={slider.lo}
            hi={slider.hi}
            formatStep={(step) => formatDateTime(span.fromMs + step * HOUR_MS, locale)}
            onChange={(lo, hi) =>
              onSelectionChange({ kind: 'custom', range: rangeFromSlider(lo, hi, span) })
            }
          />
        )}
        <p className={styles.window}>
          {t('usage.range.window')} <strong>{windowLabel}</strong>
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="usage-totals-title">
        <header className={styles.head}>
          <div className={styles.titleBlock}>
            <h2 id="usage-totals-title" className={styles.title}>
              {t('usage.totals.title')}
            </h2>
            <p className={styles.caption}>{t('usage.totals.sorted_by', { metric: metricLabel })}</p>
          </div>
        </header>
        {totals.length > 0 ? (
          <UsageTotalsTable rows={totals} metric={metric} slots={nextSlots} />
        ) : (
          <p className={styles.placeholder}>
            {report ? t('usage.empty_range') : t('usage.loading')}
          </p>
        )}
      </section>
    </>
  );
}
