import { isRecord } from '@/utils/helpers';
import { isRangePreset, type RangePreset } from './usageRange';
import { isUsageMetric, type UsageMetric } from './usageSeries';

export interface UsageUiState {
  metric?: UsageMetric;
  preset?: RangePreset;
}

const USAGE_UI_STATE_KEY = 'usagePage.uiState';

export const readUsageUiState = (): UsageUiState => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(USAGE_UI_STATE_KEY) ?? 'null');
    if (!isRecord(parsed)) return {};
    return {
      metric: isUsageMetric(parsed.metric) ? parsed.metric : undefined,
      preset: isRangePreset(parsed.preset) ? parsed.preset : undefined,
    };
  } catch {
    return {};
  }
};

export const writeUsageUiState = (patch: UsageUiState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      USAGE_UI_STATE_KEY,
      JSON.stringify({ ...readUsageUiState(), ...patch })
    );
  } catch {
    return;
  }
};
