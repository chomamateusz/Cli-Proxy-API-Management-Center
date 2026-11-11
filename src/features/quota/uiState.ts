import {
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  QUOTA_VIEWS,
  type QuotaSortMode,
  type QuotaTabId,
  type QuotaView,
} from './constants';
import {
  BURN_HORIZON_DAYS,
  BURN_LOOKBACKS,
  type BurnHorizonDays,
  type BurnLookback,
} from './burnForecast';
import type { QuotaProviderType } from './providers/types';

export type QuotaBurnUiState = {
  collapsed?: boolean;
  horizonDays?: BurnHorizonDays;
  lookback?: BurnLookback;
  /** Percent per hour typed by the user; absent means the measured rate is used. */
  manualRates?: Partial<Record<QuotaProviderType, number>>;
};

/** 额度页 UI 偏好：会话级持久化（sessionStorage），跨会话不携带。 */
export type QuotaUiState = {
  tab?: QuotaTabId;
  sortMode?: QuotaSortMode;
  showEmails?: boolean;
  showExtraBuckets?: boolean;
  burn?: QuotaBurnUiState;
};

const QUOTA_UI_STATE_KEY = 'quotaPage.uiState';
const QUOTA_VIEW_KEY = 'quotaPage.view';

const QUOTA_TAB_ID_SET = new Set<string>(['all', ...QUOTA_TAB_ORDER]);
const QUOTA_SORT_MODE_SET = new Set<string>(QUOTA_SORT_MODES);

export const isQuotaTabId = (value: unknown): value is QuotaTabId =>
  typeof value === 'string' && QUOTA_TAB_ID_SET.has(value);

export const isQuotaSortMode = (value: unknown): value is QuotaSortMode =>
  typeof value === 'string' && QUOTA_SORT_MODE_SET.has(value);

export const isQuotaView = (value: unknown): value is QuotaView =>
  typeof value === 'string' && (QUOTA_VIEWS as readonly string[]).includes(value);

const readManualRates = (value: unknown) => {
  if (!value || typeof value !== 'object') return undefined;
  const rates = Object.entries(value as Record<string, unknown>).filter(
    ([type, rate]) =>
      (QUOTA_TAB_ORDER as readonly string[]).includes(type) &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate >= 0
  );
  return rates.length > 0
    ? (Object.fromEntries(rates) as Partial<Record<QuotaProviderType, number>>)
    : undefined;
};

const readBurnUiState = (value: unknown): QuotaBurnUiState | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const burn = value as Record<string, unknown>;
  return {
    collapsed: burn.collapsed === true ? true : undefined,
    horizonDays: (BURN_HORIZON_DAYS as readonly unknown[]).includes(burn.horizonDays)
      ? (burn.horizonDays as BurnHorizonDays)
      : undefined,
    lookback: (BURN_LOOKBACKS as readonly unknown[]).includes(burn.lookback)
      ? (burn.lookback as BurnLookback)
      : undefined,
    manualRates: readManualRates(burn.manualRates),
  };
};

export const readQuotaUiState = (): QuotaUiState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(QUOTA_UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotaUiState;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      tab: isQuotaTabId(parsed.tab) ? parsed.tab : undefined,
      sortMode: isQuotaSortMode(parsed.sortMode) ? parsed.sortMode : undefined,
      showEmails: parsed.showEmails === true ? true : undefined,
      showExtraBuckets: parsed.showExtraBuckets === true ? true : undefined,
      burn: readBurnUiState(parsed.burn),
    };
  } catch {
    return null;
  }
};

/**
 * Merge into whatever is already stored.
 *
 * Callers write one preference at a time — the tab strip knows nothing about
 * the sort control — so a whole-object write would silently drop the other
 * field every time either one changed.
 */
export const writeQuotaUiState = (state: QuotaUiState) => {
  if (typeof window === 'undefined') return;
  try {
    const next = { ...readQuotaUiState(), ...state };
    window.sessionStorage.setItem(QUOTA_UI_STATE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};

export const readPersistedQuotaView = (): QuotaView => {
  if (typeof window === 'undefined') return 'overview';
  try {
    const stored = window.localStorage.getItem(QUOTA_VIEW_KEY);
    return isQuotaView(stored) ? stored : 'overview';
  } catch {
    return 'overview';
  }
};

export const writePersistedQuotaView = (view: QuotaView) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUOTA_VIEW_KEY, view);
  } catch {
    // ignore
  }
};
