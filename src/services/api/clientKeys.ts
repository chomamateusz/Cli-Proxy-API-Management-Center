import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import type {
  ClientKeyPolicy,
  IssueKeyInput,
  IssuedKey,
  IssuedKeySecret,
  PolicyListField,
  PolicyLists,
  PolicyPatch,
} from '@/types/clientKeys';
import { isRecord } from '@/utils/helpers';
import { parseTimestampMs } from '@/utils/timestamp';

const FIELD_NAMES: Record<PolicyListField, string> = {
  models: 'models',
  excludedModels: 'excluded-models',
  credentials: 'credentials',
  excludedCredentials: 'excluded-credentials',
};

const POLICY_FIELDS = Object.keys(FIELD_NAMES) as PolicyListField[];

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

const readList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readInstantMs = (value: string): number | null => {
  const ms = parseTimestampMs(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

export const normalizeIssuedKey = (raw: unknown): IssuedKey | null => {
  if (!isRecord(raw)) return null;
  const name = readText(raw.name);
  if (!name) return null;
  const createdAt = readText(raw['created-at']);
  const expiresAt = readText(raw['expires-at']);
  return {
    name,
    issuedBy: readText(raw['issued-by']),
    createdAt,
    createdAtMs: readInstantMs(createdAt),
    expiresAt,
    expiresAtMs: readInstantMs(expiresAt),
    models: readList(raw.models),
    excludedModels: readList(raw['excluded-models']),
  };
};

export const normalizeClientKeyPolicy = (raw: unknown): ClientKeyPolicy | null => {
  if (!isRecord(raw)) return null;
  const index = raw.index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null;
  const expiresAt = readText(raw['expires-at']);
  return {
    index,
    name: readText(raw.name),
    issuedBy: readText(raw['issued-by']),
    expiresAt,
    expiresAtMs: readInstantMs(expiresAt),
    hasPolicy: raw.has_policy === true,
    models: readList(raw.models),
    excludedModels: readList(raw['excluded-models']),
    credentials: readList(raw.credentials),
    excludedCredentials: readList(raw['excluded-credentials']),
  };
};

const serializeLists = (
  lists: Partial<PolicyLists> | undefined
): Record<string, string[]> | null => {
  if (!lists) return null;
  const out: Record<string, string[]> = {};
  for (const field of POLICY_FIELDS) {
    const values = lists[field];
    if (values && values.length > 0) out[FIELD_NAMES[field]] = [...values];
  }
  return Object.keys(out).length > 0 ? out : null;
};

export const serializePolicyPatch = (patch: PolicyPatch): Record<string, unknown> | null => {
  for (const field of POLICY_FIELDS) {
    const removed = new Set(patch.remove?.[field] ?? []);
    if ((patch.add?.[field] ?? []).some((value) => removed.has(value))) {
      throw new RangeError(`The same ${field} value is both added and removed`);
    }
  }
  const add = serializeLists(patch.add);
  const remove = serializeLists(patch.remove);
  if (!add && !remove) return null;
  return { ...(add ? { add } : {}), ...(remove ? { remove } : {}) };
};

export const buildIssueBody = (input: IssueKeyInput): Record<string, unknown> => ({
  name: input.name,
  models: [...input.models],
  ...(input.ttl !== null ? { ttl: input.ttl } : {}),
});

const normalizeList = <T>(data: unknown, normalize: (raw: unknown) => T | null): T[] =>
  readArray(data).flatMap((entry) => {
    const item = normalize(entry);
    return item ? [item] : [];
  });

export const clientKeysApi = {
  async listIssued(): Promise<IssuedKey[]> {
    return normalizeList(await apiClient.get<unknown>('/issued-keys'), normalizeIssuedKey);
  },

  async issue(input: IssueKeyInput): Promise<IssuedKeySecret> {
    const assertConnection = guardConfigConnection();
    const data = await apiClient.post<unknown>('/issued-keys', buildIssueBody(input));
    assertConnection();
    const secret = isRecord(data) ? data.key : undefined;
    const key = normalizeIssuedKey(data);
    if (typeof secret !== 'string' || !secret || !key) throw new Error('missing key');
    return { key, secret };
  },

  async revoke(name: string): Promise<number> {
    const assertConnection = guardConfigConnection();
    const data = await apiClient.delete<unknown>(`/issued-keys/${encodeURIComponent(name)}`);
    assertConnection();
    const revoked = isRecord(data) ? data.revoked : undefined;
    return typeof revoked === 'number' && Number.isFinite(revoked) ? revoked : 0;
  },

  async listPolicies(): Promise<ClientKeyPolicy[]> {
    return normalizeList(
      await apiClient.get<unknown>('/client-key-policies'),
      normalizeClientKeyPolicy
    );
  },

  async patchPolicy(name: string, patch: PolicyPatch): Promise<ClientKeyPolicy> {
    const body = serializePolicyPatch(patch);
    if (!body) throw new RangeError('Empty policy patch');
    const assertConnection = guardConfigConnection();
    const data = await apiClient.patch<unknown>(
      `/client-key-policies/${encodeURIComponent(name)}`,
      body
    );
    assertConnection();
    const policy = normalizeClientKeyPolicy(data);
    if (!policy) throw new Error('Invalid policy response');
    return policy;
  },
};
