import type { TFunction } from 'i18next';
import type { ClientKeyPolicy, PolicyListField } from '@/types/clientKeys';
import { blockAllPattern, rowReadonlyReason, type CredentialCell, type ModelCell } from './matrix';

export const CLIENT_KEYS_VIEWS = ['keys', 'matrix', 'credentials'] as const;
export type ClientKeysView = (typeof CLIENT_KEYS_VIEWS)[number];
export type PolicySheetSection = 'models' | 'credentials';
export type PatternOp = 'add' | 'remove';

export const clientKeysTabId = (view: ClientKeysView) => `client-keys-tab-${view}`;
export const clientKeysPanelId = (view: ClientKeysView) => `client-keys-panel-${view}`;

export const parseClientKeysView = (value: string | null): ClientKeysView =>
  CLIENT_KEYS_VIEWS.find((view) => view === value) ?? 'keys';

export const modelCellId = (keyName: string, modelId: string) =>
  `m\u0001${keyName}\u0001${modelId}`;

export const credentialCellId = (keyName: string, token: string) =>
  `c\u0001${keyName}\u0001${token}`;

export const patternCellId = (keyName: string, field: PolicyListField, value: string) =>
  `p\u0001${keyName}\u0001${field}\u0001${value}`;

const patternCellPrefix = (keyName: string, field: PolicyListField) =>
  patternCellId(keyName, field, '');

export function pendingPatternValues(
  cellIds: Iterable<string>,
  keyName: string,
  field: PolicyListField
): string[] {
  const prefix = patternCellPrefix(keyName, field);
  return [...cellIds].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
}

export function patternErrors(
  cellErrors: ReadonlyMap<string, string>,
  keyName: string,
  field: PolicyListField
): ReadonlyMap<string, string> {
  const prefix = patternCellPrefix(keyName, field);
  return new Map(
    [...cellErrors]
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, message]) => [id.slice(prefix.length), message])
  );
}

export function projectPatternList(
  values: readonly string[],
  pendingValues: readonly string[]
): string[] {
  const removing = new Set(pendingValues.filter((value) => values.includes(value)));
  const adding = pendingValues.filter((value) => !values.includes(value));
  return [...values.filter((value) => !removing.has(value)), ...adding];
}

export const keyLabelFor = (t: TFunction, policy: ClientKeyPolicy) =>
  policy.name || t('client_keys.matrix.unnamed_key', { index: policy.index + 1 });

export function blockAllBanners(t: TFunction, policies: ClientKeyPolicy[]) {
  return policies.flatMap((policy) => {
    const pattern = blockAllPattern(policy.excludedModels);
    return pattern
      ? [{ id: `${policy.index}-${policy.name}`, key: keyLabelFor(t, policy), pattern }]
      : [];
  });
}

export const policySelectValue = (policy: ClientKeyPolicy) => policy.name || `@${policy.index}`;

export function resolveSelectedPolicy(
  policies: ClientKeyPolicy[],
  selected: string | null
): ClientKeyPolicy | null {
  const match = policies.find((policy) => policySelectValue(policy) === selected);
  if (match) return match;
  return (
    policies.find((policy) => rowReadonlyReason(policy, policies) === null) ?? policies[0] ?? null
  );
}

export function cellStatePhrase(
  t: TFunction,
  cell: ModelCell | CredentialCell,
  pending: boolean,
  error: string | null
): string {
  const parts: string[] = [];
  if (cell.state === 'allowed') parts.push(t('client_keys.matrix.state_allowed'));
  else if (cell.state === 'blocked') parts.push(t('client_keys.matrix.state_blocked'));
  else if (cell.lock.reason === 'pattern') {
    parts.push(t('client_keys.matrix.state_pattern', { pattern: cell.lock.patterns[0] }));
  } else if (cell.lock.reason === 'allowlist') {
    parts.push(t('client_keys.matrix.state_allowlist'));
  } else {
    parts.push(t('client_keys.matrix.state_readonly'));
  }
  if (cell.state === 'allowed' && 'unreachable' in cell && cell.unreachable) {
    parts.push(t('client_keys.matrix.state_unreachable'));
  }
  if (pending) parts.push(t('client_keys.matrix.state_pending'));
  if (error) parts.push(t('client_keys.matrix.state_error', { message: error }));
  return parts.join(', ');
}

const WARNINGS = {
  models: {
    first: 'client_keys.sheet.first_allow_warning',
    last: 'client_keys.sheet.last_allow_warning',
    star: 'client_keys.sheet.star_removal_warning',
  },
  credentials: {
    first: 'client_keys.sheet.first_allow_cred_warning',
    last: 'client_keys.sheet.last_allow_cred_warning',
    star: 'client_keys.sheet.star_removal_cred_warning',
  },
  excludedModels: 'client_keys.sheet.block_all_warning',
  excludedCredentials: 'client_keys.sheet.block_all_cred_warning',
} as const;

export function policyGuardKey(
  field: PolicyListField,
  current: readonly string[],
  op: PatternOp,
  value: string
): string | null {
  if (field === 'excludedModels' || field === 'excludedCredentials') {
    return op === 'add' && /^\*+$/.test(value) ? WARNINGS[field] : null;
  }
  const keys = WARNINGS[field];
  if (op === 'add') return current.length === 0 && value !== '*' ? keys.first : null;
  const remaining = current.filter((entry) => entry !== value);
  if (remaining.length === 0) return keys.last;
  return current.includes('*') && !remaining.includes('*') ? keys.star : null;
}
