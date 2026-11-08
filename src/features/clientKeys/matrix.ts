import type {
  ClientKeyPolicy,
  ModelCatalog,
  ModelColumn,
  ModelGroup,
  PolicyCredential,
  PolicyLists,
  PolicyPatch,
} from '@/types/clientKeys';
import { hasPathSeparator, isDotsOnlyName, isIndexLikeName } from './issueValidation';
import {
  allowsCredential,
  allowsModel,
  isUnrestrictedAllowlist,
  modelNames,
  policyMatches,
} from './policyMatching';

export type RowReadonlyReason = 'unnamed' | 'duplicate' | 'dots' | 'numeric' | 'slash';

export type CellLock =
  | { reason: 'pattern'; patterns: string[] }
  | { reason: 'allowlist' }
  | { reason: 'readonly'; why: RowReadonlyReason };

export type ModelCell =
  | { state: 'allowed'; unreachable: boolean; exactEntries: [] }
  | { state: 'blocked'; exactEntries: string[] }
  | { state: 'locked'; allowed: boolean; lock: CellLock; exactEntries: string[] };

export type CredentialCell =
  | { state: 'allowed'; exactEntries: [] }
  | { state: 'blocked'; exactEntries: string[] }
  | { state: 'locked'; allowed: boolean; lock: CellLock; exactEntries: string[] };

const sortText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function buildModelCatalog(
  credentials: PolicyCredential[],
  modelsByCredential: Record<string, string[] | null>,
  providerLabel: (provider: string) => string = (provider) => provider
): ModelCatalog {
  const entries = new Map<string, { id: string; providers: string[]; credentialNames: string[] }>();
  for (const credential of credentials) {
    const models = modelsByCredential[credential.name];
    if (!models) continue;
    for (const raw of models) {
      const id = raw.trim();
      if (!id) continue;
      const key = id.toLowerCase();
      let entry = entries.get(key);
      if (!entry) {
        entry = { id, providers: [], credentialNames: [] };
        entries.set(key, entry);
      }
      if (!entry.providers.includes(credential.provider)) entry.providers.push(credential.provider);
      if (!entry.credentialNames.includes(credential.name)) {
        entry.credentialNames.push(credential.name);
      }
    }
  }

  const byLabel = (a: string, b: string) => sortText(providerLabel(a), providerLabel(b));
  const groups = new Map<string, ModelColumn[]>();
  for (const entry of entries.values()) {
    const providers = [...entry.providers].sort(byLabel);
    const column: ModelColumn = {
      id: entry.id,
      provider: providers[0],
      providers,
      credentialNames: entry.credentialNames,
    };
    const columns = groups.get(column.provider) ?? [];
    columns.push(column);
    groups.set(column.provider, columns);
  }

  const sortedGroups: ModelGroup[] = [...groups.entries()]
    .sort(([a], [b]) => byLabel(a, b))
    .map(([provider, columns]) => ({
      provider,
      columns: columns.sort((a, b) => sortText(a.id, b.id)),
    }));
  return {
    groups: sortedGroups,
    ids: sortedGroups.flatMap((group) => group.columns.map((column) => column.id)),
  };
}

const isExactFor = (entry: string, names: readonly string[]) =>
  !entry.includes('*') && names.some((name) => entry.toLowerCase() === name.toLowerCase());

export function rowReadonlyReason(
  policy: ClientKeyPolicy,
  all: ClientKeyPolicy[]
): RowReadonlyReason | null {
  if (policy.name === '') return 'unnamed';
  if (all.filter((entry) => entry.name === policy.name).length > 1) return 'duplicate';
  if (isDotsOnlyName(policy.name)) return 'dots';
  if (hasPathSeparator(policy.name)) return 'slash';
  if (isIndexLikeName(policy.name)) return 'numeric';
  return null;
}

export function deriveModelCell(
  p: PolicyLists,
  column: ModelColumn,
  credentials: PolicyCredential[],
  rowReadonly: RowReadonlyReason | null
): ModelCell {
  const hits = policyMatches(p.excludedModels, modelNames(column.id));
  const exactEntries = hits.filter((entry) => isExactFor(entry, [column.id]));
  if (rowReadonly) {
    return {
      state: 'locked',
      allowed: allowsModel(p, column.id),
      lock: { reason: 'readonly', why: rowReadonly },
      exactEntries,
    };
  }
  const patterns = hits.filter((entry) => !exactEntries.includes(entry));
  if (patterns.length > 0) {
    return { state: 'locked', allowed: false, lock: { reason: 'pattern', patterns }, exactEntries };
  }
  if (
    !isUnrestrictedAllowlist(p.models) &&
    policyMatches(p.models, modelNames(column.id)).length === 0
  ) {
    return { state: 'locked', allowed: false, lock: { reason: 'allowlist' }, exactEntries };
  }
  if (hits.length > 0) return { state: 'blocked', exactEntries: hits };
  const offering = column.credentialNames.flatMap((name) => {
    const credential = credentials.find((entry) => entry.name === name);
    return credential ? [credential] : [];
  });
  return {
    state: 'allowed',
    unreachable:
      offering.length > 0 && offering.every((credential) => !allowsCredential(p, credential)),
    exactEntries: [],
  };
}

export function planModelToggle(cell: ModelCell, modelId: string): PolicyPatch | null {
  if (cell.state === 'allowed') return { add: { excludedModels: [modelId] } };
  if (cell.state === 'blocked') return { remove: { excludedModels: [...cell.exactEntries] } };
  return null;
}

export function deriveCredentialCell(
  p: PolicyLists,
  c: PolicyCredential,
  rowReadonly: RowReadonlyReason | null
): CredentialCell {
  const hits = policyMatches(p.excludedCredentials, c.identityNames);
  const exactEntries = hits.filter((entry) => isExactFor(entry, c.identityNames));
  if (rowReadonly) {
    return {
      state: 'locked',
      allowed: allowsCredential(p, c),
      lock: { reason: 'readonly', why: rowReadonly },
      exactEntries,
    };
  }
  const patterns = hits.filter((entry) => !exactEntries.includes(entry));
  if (patterns.length > 0) {
    return { state: 'locked', allowed: false, lock: { reason: 'pattern', patterns }, exactEntries };
  }
  if (
    !isUnrestrictedAllowlist(p.credentials) &&
    policyMatches(p.credentials, c.identityNames).length === 0
  ) {
    return { state: 'locked', allowed: false, lock: { reason: 'allowlist' }, exactEntries };
  }
  if (hits.length > 0) return { state: 'blocked', exactEntries: hits };
  return { state: 'allowed', exactEntries: [] };
}

export function planCredentialToggle(
  cell: CredentialCell,
  c: PolicyCredential
): PolicyPatch | null {
  if (cell.state === 'allowed') return { add: { excludedCredentials: [c.writeToken] } };
  if (cell.state === 'blocked') return { remove: { excludedCredentials: [...cell.exactEntries] } };
  return null;
}

export function isCellAllowed(cell: ModelCell | CredentialCell): boolean {
  return cell.state === 'allowed' || (cell.state === 'locked' && cell.allowed);
}

export function summarizeRow(
  p: PolicyLists,
  catalog: ModelCatalog
): { allowed: number; total: number } {
  return {
    allowed: catalog.ids.filter((id) => allowsModel(p, id)).length,
    total: catalog.ids.length,
  };
}

export function countPatterns(p: PolicyLists): number {
  return (
    p.models.filter((value) => value.includes('*') && value !== '*').length +
    p.excludedModels.filter((value) => value.includes('*')).length
  );
}

export function blockAllPattern(excluded: readonly string[]): string | null {
  return excluded.find((value) => /^\*+$/.test(value)) ?? null;
}

export function mergePolicies(
  fetched: ClientKeyPolicy[],
  local: ClientKeyPolicy[],
  stamps: ReadonlyMap<string, number>,
  since: number
): ClientKeyPolicy[] {
  return fetched.map((entry) => {
    if ((stamps.get(entry.name) ?? 0) <= since) return entry;
    const kept = local.find((candidate) => candidate.name === entry.name);
    return kept ? { ...kept, index: entry.index } : entry;
  });
}
