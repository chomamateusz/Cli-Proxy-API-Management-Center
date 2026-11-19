/** Mirrors `UseOrLoseSelector` in the proxy's sdk/cliproxy/auth/selector_use_or_lose.go. */

import type { AuthFileItem, ClaudeQuotaState, CodexQuotaState } from '@/types';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { isRecord } from '@/utils/helpers';
import type { QuotaTabId } from './constants';
import { readCredentialEnd } from './credentialEnd';
import { filterEntriesBySearch, filterEntriesByTab, type QuotaFileEntry } from './logic';
import type { QuotaProviderType } from './providers/types';

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const SHORT_WINDOW_MS = 5 * HOUR_MS;
const IDLE_SAMPLE_AGE_MS = 15 * 60 * 1000;

export const DEFAULT_SHORT_WINDOW_CAP_PCT = 95;

export const ROUTER_FAMILIES = ['all', 'fable'] as const;
export type RouterFamily = (typeof ROUTER_FAMILIES)[number];

export const isRouterFamily = (value: unknown): value is RouterFamily =>
  typeof value === 'string' && (ROUTER_FAMILIES as readonly string[]).includes(value);

export const ROUTER_SAMPLED_PROVIDERS: readonly QuotaProviderType[] = ['claude', 'codex'];

export interface RouterWindow {
  usedPercent: number | null;
  resetAtMs: number | null;
}

export interface RouterReadings {
  weekly: RouterWindow | null;
  fable: RouterWindow | null;
  short: RouterWindow | null;
  creditsAvailable: boolean;
  observedAtMs: number;
}

export interface RouterSettings {
  strategy: string;
  shortWindowCapPct: number;
  drainEndingCredentials: boolean;
}

export const DEFAULT_ROUTER_SETTINGS: RouterSettings = {
  strategy: 'round-robin',
  shortWindowCapPct: DEFAULT_SHORT_WINDOW_CAP_PCT,
  drainEndingCredentials: true,
};

export type RouterOutOfRotation = 'cooling' | 'disabled' | 'ended';

export interface RouterCandidate<T> {
  item: T;
  provider: QuotaProviderType;
  priority: number;
  endsAtMs: number | null;
  readings: RouterReadings | null;
  outOfRotation: RouterOutOfRotation | null;
}

export type RouterTier = 'room' | 'capped' | 'limited';

export type RouterPlacement =
  | {
      kind: 'ranked';
      position: number;
      tier: RouterTier;
      sampled: boolean;
      sampledProvider: boolean;
    }
  | { kind: 'out'; reason: RouterOutOfRotation };

export interface RankedCandidate<T> {
  candidate: RouterCandidate<T>;
  placement: RouterPlacement;
}

const STRATEGY_ALIASES: Record<string, string> = {
  'weighted-round-robin': 'weighted-round-robin',
  weightedroundrobin: 'weighted-round-robin',
  wrr: 'weighted-round-robin',
  'fill-first': 'fill-first',
  fillfirst: 'fill-first',
  ff: 'fill-first',
  'nearest-reset': 'nearest-reset',
  nearestreset: 'nearest-reset',
  nr: 'nearest-reset',
  'use-or-lose': 'use-or-lose',
  'most-used': 'most-used',
  mostused: 'most-used',
  mu: 'most-used',
};

/** Same normalization as the proxy: an unrecognised or absent strategy runs as round-robin. */
export const normalizeRouterStrategy = (value: unknown): string =>
  (typeof value === 'string' && STRATEGY_ALIASES[value.trim().toLowerCase()]) || 'round-robin';

const readPath = (root: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), root);

export function readRouterSettings(rawConfig: unknown): RouterSettings {
  const cap = readPath(rawConfig, ['routing', 'use-or-lose', 'short-window-cap-pct']);
  return {
    strategy: normalizeRouterStrategy(readPath(rawConfig, ['routing', 'strategy'])),
    shortWindowCapPct:
      typeof cap === 'number' && cap > 1 && cap <= 100 ? cap : DEFAULT_SHORT_WINDOW_CAP_PCT,
    drainEndingCredentials:
      readPath(rawConfig, ['routing', 'use-or-lose', 'drain-ending-credentials']) !== false,
  };
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

type ReadingWindow = {
  id: string;
  usedPercent: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
};

const toRouterWindow = (window: ReadingWindow | undefined): RouterWindow | null =>
  window ? { usedPercent: finite(window.usedPercent), resetAtMs: finite(window.resetAtMs) } : null;

const parseObserved = (value: unknown, fallbackMs: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

export function routerReadingsFor(
  type: QuotaProviderType,
  quota: unknown,
  nowMs: number
): RouterReadings | null {
  if (!isRecord(quota)) return null;
  if (type === 'claude') {
    const state = quota as unknown as ClaudeQuotaState;
    const windows = Array.isArray(state.windows) ? state.windows : [];
    if (windows.length === 0) return null;
    const find = (id: string) => windows.find((window) => window.id === id);
    return {
      weekly: toRouterWindow(find('seven-day')),
      fable: toRouterWindow(find('seven-day-fable')),
      short: toRouterWindow(find('five-hour')),
      creditsAvailable: false,
      observedAtMs: parseObserved(state.observedAt, nowMs),
    };
  }
  if (type === 'codex') {
    const state = quota as unknown as CodexQuotaState;
    if (state.status !== 'success') return null;
    const windows = Array.isArray(state.windows) ? state.windows : [];
    const byPeriod = (id: string, hours: number) =>
      windows.find((window) => window.id === id && window.periodHours === hours);
    const balance = Number(state.creditBalance ?? 0);
    return {
      weekly: toRouterWindow(byPeriod('weekly', 168)),
      fable: null,
      short: toRouterWindow(byPeriod('five-hour', 5)),
      creditsAvailable:
        state.creditsUnlimited === true || (Number.isFinite(balance) && balance > 0),
      observedAtMs: parseObserved(state.loadedAtMs, nowMs),
    };
  }
  return null;
}

export function routerOutOfRotation(file: AuthFileItem, nowMs: number): RouterOutOfRotation | null {
  if (readCredentialEnd(file, nowMs).ended) return 'ended';
  if (file.disabled === true) return 'disabled';
  if (file.cooldownSnapshot && summarizeCooldowns(file.cooldownSnapshot, nowMs).credentialWide) {
    return 'cooling';
  }
  return null;
}

interface Sample {
  resetAtMs: number | null;
  utilisation: number;
  sampled: boolean;
  capped: boolean;
  atLimit: boolean;
}

const hasUsage = (window: RouterWindow | null): window is RouterWindow & { usedPercent: number } =>
  window !== null && window.usedPercent !== null;

const windowUsable = (window: RouterWindow | null, observedAtMs: number, nowMs: number) => {
  if (!hasUsage(window) || observedAtMs + WEEK_MS <= nowMs) return false;
  if (window.resetAtMs !== null) return window.resetAtMs > nowMs;
  return window.usedPercent === 0 && observedAtMs + IDLE_SAMPLE_AGE_MS > nowMs;
};

const windowAtLimit = (window: RouterWindow | null, nowMs: number) =>
  hasUsage(window) &&
  window.resetAtMs !== null &&
  window.resetAtMs > nowMs &&
  window.usedPercent >= 100;

function sampleFor(
  candidate: RouterCandidate<unknown>,
  family: RouterFamily,
  settings: RouterSettings,
  nowMs: number
): Sample {
  const readings = candidate.readings;
  let weekly: RouterWindow | null = readings?.weekly ?? null;
  let atLimit = windowAtLimit(weekly, nowMs);
  if (readings && candidate.provider === 'claude' && family === 'fable') {
    const fable = readings.fable;
    if (readings.observedAtMs + WEEK_MS > nowMs) atLimit = atLimit || windowAtLimit(fable, nowMs);
    if (windowUsable(fable, readings.observedAtMs, nowMs)) weekly = fable;
  }
  const short = readings?.short ?? null;
  const shortActive =
    short !== null &&
    (short.resetAtMs !== null
      ? short.resetAtMs > nowMs
      : (readings?.observedAtMs ?? 0) + SHORT_WINDOW_MS > nowMs);
  const credits = readings?.creditsAvailable === true;
  let resetAtMs = weekly?.resetAtMs ?? null;
  if (
    settings.drainEndingCredentials &&
    candidate.endsAtMs !== null &&
    (resetAtMs === null || candidate.endsAtMs < resetAtMs)
  ) {
    resetAtMs = candidate.endsAtMs;
  }
  return {
    resetAtMs,
    utilisation: weekly?.usedPercent ?? 0,
    sampled: readings !== null && windowUsable(weekly, readings.observedAtMs, nowMs),
    capped:
      !credits && shortActive && hasUsage(short) && short.usedPercent >= settings.shortWindowCapPct,
    atLimit: !credits && (atLimit || windowAtLimit(weekly, nowMs)),
  };
}

const tierOf = (sample: Sample): RouterTier =>
  sample.atLimit ? 'limited' : sample.capped ? 'capped' : 'room';

/** The Go selector compares a zero reset time as earlier than any real one. */
const resetOrder = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;

function pickNext<T>(
  pool: readonly RouterCandidate<T>[],
  samples: Map<RouterCandidate<T>, Sample>
): RouterCandidate<T> {
  const room = pool.filter((candidate) => tierOf(samples.get(candidate)!) === 'room');
  const capped = pool.filter((candidate) => tierOf(samples.get(candidate)!) === 'capped');
  let ordered: readonly RouterCandidate<T>[] =
    room.length > 0 ? room : capped.length > 0 ? capped : pool;
  const bestPriority = Math.max(...ordered.map((candidate) => candidate.priority));
  ordered = ordered.filter((candidate) => candidate.priority === bestPriority);

  let earliest: number | null = null;
  for (const candidate of ordered) {
    const sample = samples.get(candidate)!;
    if (sample.sampled && sample.resetAtMs !== null) {
      earliest = earliest === null ? sample.resetAtMs : Math.min(earliest, sample.resetAtMs);
    }
  }
  let selected = ordered[0];
  let found = false;
  for (const candidate of ordered) {
    const sample = samples.get(candidate)!;
    if (
      !sample.sampled ||
      (earliest !== null && (sample.resetAtMs === null || sample.resetAtMs > earliest + HOUR_MS))
    ) {
      continue;
    }
    const best = samples.get(selected)!;
    if (
      !found ||
      sample.utilisation < best.utilisation ||
      (sample.utilisation === best.utilisation &&
        resetOrder(sample.resetAtMs) < resetOrder(best.resetAtMs))
    ) {
      selected = candidate;
      found = true;
    }
  }
  return selected;
}

const OUT_ORDER: readonly RouterOutOfRotation[] = ['cooling', 'disabled', 'ended'];

export function rankProviderByRouter<T>(
  candidates: readonly RouterCandidate<T>[],
  family: RouterFamily,
  settings: RouterSettings,
  nowMs: number
): RankedCandidate<T>[] {
  const inRotation = candidates.filter((candidate) => candidate.outOfRotation === null);
  const samples = new Map(
    inRotation.map((candidate) => [candidate, sampleFor(candidate, family, settings, nowMs)])
  );
  const ranked: RankedCandidate<T>[] = [];
  let remaining = [...inRotation];
  while (remaining.length > 0) {
    const next = pickNext(remaining, samples);
    const sample = samples.get(next)!;
    ranked.push({
      candidate: next,
      placement: {
        kind: 'ranked',
        position: ranked.length + 1,
        tier: tierOf(sample),
        sampled: sample.sampled,
        sampledProvider: ROUTER_SAMPLED_PROVIDERS.includes(next.provider),
      },
    });
    remaining = remaining.filter((candidate) => candidate !== next);
  }
  const out = OUT_ORDER.flatMap((reason) =>
    candidates
      .filter((candidate) => candidate.outOfRotation === reason)
      .map((candidate): RankedCandidate<T> => ({ candidate, placement: { kind: 'out', reason } }))
  );
  return [...ranked, ...out];
}

export function rankByRouter<T>(
  candidates: readonly RouterCandidate<T>[],
  family: RouterFamily,
  settings: RouterSettings,
  nowMs: number
): RankedCandidate<T>[] {
  const providers: QuotaProviderType[] = [];
  candidates.forEach((candidate) => {
    if (!providers.includes(candidate.provider)) providers.push(candidate.provider);
  });
  return providers.flatMap((provider) =>
    rankProviderByRouter(
      candidates.filter((candidate) => candidate.provider === provider),
      family,
      settings,
      nowMs
    )
  );
}

export interface RouterView {
  ranked: RankedCandidate<QuotaFileEntry>[];
  visible: QuotaFileEntry[];
}

export function buildRouterView(
  entries: readonly QuotaFileEntry[],
  describe: (entry: QuotaFileEntry) => Omit<RouterCandidate<QuotaFileEntry>, 'item' | 'provider'>,
  tab: QuotaTabId,
  search: string,
  family: RouterFamily,
  settings: RouterSettings,
  nowMs: number
): RouterView {
  const ranked = rankByRouter(
    entries.map((entry) => ({ item: entry, provider: entry.type, ...describe(entry) })),
    family,
    settings,
    nowMs
  );
  return {
    ranked,
    visible: filterEntriesBySearch(
      filterEntriesByTab(
        ranked.map((entry) => entry.candidate.item),
        tab
      ),
      search
    ),
  };
}
