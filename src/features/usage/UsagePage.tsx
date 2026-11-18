import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRevealGroup } from '@/hooks/motion';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore } from '@/stores';
import type { ClientKeyUsageQuery } from '@/types/fleetUsage';
import { MINUTE_MS } from '@/utils/time/durations';
import { LiveTraffic } from './components/LiveTraffic';
import { UsageByKey } from './components/UsageByKey';
import { useClientKeyUsage } from './hooks/useClientKeyUsage';
import { useDocumentVisible } from './hooks/useDocumentVisible';
import { useRecentRequests } from './hooks/useRecentRequests';
import { buildAccountNames } from './recentRequests';
import { readUsageUiState, writeUsageUiState } from './uiState';
import { resolveSelection, seriesGranularityFor, type RangeSelection } from './usageRange';
import type { UsageMetric } from './usageSeries';
import styles from './UsagePage.module.scss';

const USAGE_REFRESH_MS = MINUTE_MS;

export function UsageDashboard() {
  const visible = useDocumentVisible();
  const [initialUi] = useState(readUsageUiState);
  const [metric, setMetric] = useState<UsageMetric>(initialUi.metric ?? 'total');
  const [selection, setSelection] = useState<RangeSelection>({
    kind: 'preset',
    preset: initialUi.preset ?? '24h',
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [keyFilter, setKeyFilter] = useState('');
  const [accountNames, setAccountNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [accountsRevision, setAccountsRevision] = useState(0);

  const refresh = useCallback(() => {
    setNowMs(Date.now());
    setAccountsRevision((revision) => revision + 1);
  }, []);
  useHeaderRefresh(refresh);

  useEffect(() => {
    if (!visible) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), USAGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    authFilesApi.list().then(
      (response) => {
        if (!cancelled) setAccountNames(buildAccountNames(response.files));
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [accountsRevision]);

  const [recordingSinceMs, setRecordingSinceMs] = useState<number | null>(null);
  const range = resolveSelection(selection, nowMs, recordingSinceMs);
  const waitingForSpan =
    selection.kind === 'preset' && selection.preset === 'all' && recordingSinceMs === null;
  const query: ClientKeyUsageQuery = {
    fromMs: waitingForSpan ? null : range.fromMs,
    toMs: range.toMs,
    series: waitingForSpan ? 'day' : seriesGranularityFor(range),
  };
  const usage = useClientKeyUsage(query, nowMs);
  const reportedSince = usage.report?.recordingSinceMs ?? null;
  if (reportedSince !== recordingSinceMs && usage.report) setRecordingSinceMs(reportedSince);

  const live = useRecentRequests({ active: visible && !paused, keyFilter });
  const keyOptions = useMemo(() => {
    const names = new Set<string>(usage.report?.keys.map((key) => key.name) ?? []);
    live.feed.rows.forEach((row) => names.add(row.key));
    if (keyFilter) names.add(keyFilter);
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [usage.report, live.feed.rows, keyFilter]);

  const changeMetric = (next: UsageMetric) => {
    setMetric(next);
    writeUsageUiState({ metric: next });
  };
  const changeSelection = (next: RangeSelection) => {
    setSelection(next);
    if (next.kind === 'preset') writeUsageUiState({ preset: next.preset });
  };

  return (
    <>
      <UsageByKey
        report={usage.report}
        loading={usage.loading}
        error={usage.error}
        nowMs={nowMs}
        range={range}
        selection={selection}
        onSelectionChange={changeSelection}
        metric={metric}
        onMetricChange={changeMetric}
        onRetry={refresh}
      />
      <LiveTraffic
        state={live}
        paused={paused}
        onTogglePause={() => setPaused((value) => !value)}
        keyFilter={keyFilter}
        keyOptions={keyOptions}
        onKeyFilterChange={setKeyFilter}
        accountNames={accountNames}
      />
    </>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div className={styles.page} ref={revealRef}>
      <header className={styles.header}>
        <h1 className={styles.title} data-reveal>
          {t('usage.title')}
        </h1>
        <p className={styles.subtitle}>{t('usage.subtitle')}</p>
      </header>
      {connected ? <UsageDashboard /> : <EmptyState title={t('usage.disconnected')} />}
    </div>
  );
}
