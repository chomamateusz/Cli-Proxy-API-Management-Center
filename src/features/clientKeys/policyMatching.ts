import type { PolicyLists } from '@/types/clientKeys';

export interface CredentialIdentity {
  name: string;
  id: string;
  label: string;
  runtimeOnly: boolean;
}

// Verbatim port of sdk/access/key_policy.go: the backend neither trims patterns nor treats
// '?' or '[' specially, so the shared excluded-model matcher would disagree with the server.
export function wildcardMatch(pattern: string, value: string): boolean {
  const p0 = pattern.toLowerCase();
  const v0 = value.toLowerCase();
  let p = 0;
  let v = 0;
  let star = -1;
  let retry = 0;
  while (v < v0.length) {
    if (p < p0.length && p0[p] === '*') {
      star = p;
      retry = v;
      p += 1;
    } else if (p < p0.length && p0[p] === v0[v]) {
      p += 1;
      v += 1;
    } else if (star >= 0) {
      retry += 1;
      v = retry;
      p = star + 1;
    } else {
      return false;
    }
  }
  while (p < p0.length && p0[p] === '*') p += 1;
  return p === p0.length;
}

export function modelBaseName(model: string): string {
  const open = model.lastIndexOf('(');
  if (open < 0 || !model.endsWith(')')) return model;
  return model.slice(0, open);
}

export function modelNames(model: string): string[] {
  const requested = model.trim();
  return [requested, modelBaseName(requested).trim()];
}

export function policyMatches(patterns: readonly string[], names: readonly string[]): string[] {
  return patterns.filter((pattern) => names.some((name) => wildcardMatch(pattern, name)));
}

export function isUnrestrictedAllowlist(models: readonly string[]): boolean {
  return models.length === 0 || models.includes('*');
}

export function allowsModel(p: PolicyLists, model: string): boolean {
  const names = modelNames(model);
  if (policyMatches(p.excludedModels, names).length > 0) return false;
  return p.models.length === 0 || policyMatches(p.models, names).length > 0;
}

export function goBase(path: string): string {
  if (path === '') return '.';
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

const withoutJson = (base: string): string[] =>
  base.toLowerCase().endsWith('.json') ? [base, base.slice(0, -5)] : [base];

export function credentialFileName(c: CredentialIdentity): string {
  return !c.runtimeOnly || c.name !== c.id ? c.name : '';
}

export function credentialIdentityNames(c: CredentialIdentity): string[] {
  const names = [c.id, ...withoutJson(goBase(c.id))];
  const fileName = credentialFileName(c);
  if (fileName !== '') names.push(...withoutJson(goBase(fileName)));
  else if (c.label !== '') names.push(c.label);
  return names;
}

export function allowsCredential(p: PolicyLists, c: CredentialIdentity): boolean {
  const names = credentialIdentityNames(c);
  const allowed = p.credentials.length === 0 || policyMatches(p.credentials, names).length > 0;
  return allowed && policyMatches(p.excludedCredentials, names).length === 0;
}
