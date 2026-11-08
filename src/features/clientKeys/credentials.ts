import { deriveAuthFileIdentity, stripJsonExtension } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types/authFile';
import type { PolicyCredential } from '@/types/clientKeys';
import { credentialFileName, credentialIdentityNames, goBase } from './policyMatching';

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

const readRuntimeOnly = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

export function toPolicyCredential(file: AuthFileItem): PolicyCredential {
  const name = readText(file.name);
  const matchIdentity = {
    name,
    id: readText(file.id) || name,
    label: readText(file.label),
    runtimeOnly: readRuntimeOnly(file.runtimeOnly),
  };
  const identity = deriveAuthFileIdentity(file);
  const visibleLabel = matchIdentity.label.trim();
  const useLabel = identity.kind === 'fileName' && visibleLabel !== '';
  const displayName = (useLabel ? visibleLabel : identity.primary) || name;
  const fileBase = stripJsonExtension(name);
  const labelSecondary = fileBase && fileBase !== displayName ? fileBase : null;
  return {
    ...matchIdentity,
    provider: readText(file.type).trim() || readText(file.provider).trim() || 'unknown',
    displayName,
    secondaryName: useLabel ? labelSecondary : identity.secondary,
    disabled: file.disabled === true,
    writeToken: credentialFileName(matchIdentity) === '' ? matchIdentity.id : goBase(name),
    identityNames: credentialIdentityNames(matchIdentity),
  };
}
