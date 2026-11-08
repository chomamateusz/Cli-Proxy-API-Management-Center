export type PolicyListField = 'models' | 'excludedModels' | 'credentials' | 'excludedCredentials';

export interface PolicyLists {
  models: string[];
  excludedModels: string[];
  credentials: string[];
  excludedCredentials: string[];
}

export interface IssuedKey {
  name: string;
  issuedBy: string;
  createdAt: string;
  createdAtMs: number | null;
  expiresAt: string;
  expiresAtMs: number | null;
  models: string[];
  excludedModels: string[];
}

export interface ClientKeyPolicy extends PolicyLists {
  index: number;
  name: string;
  issuedBy: string;
  expiresAt: string;
  expiresAtMs: number | null;
  hasPolicy: boolean;
}

export interface IssueKeyInput {
  name: string;
  ttl: string | null;
  models: string[];
}

export interface IssuedKeySecret {
  key: IssuedKey;
  secret: string;
}

export type PolicyPatch = { add?: Partial<PolicyLists>; remove?: Partial<PolicyLists> };

export interface PolicyCredential {
  name: string;
  id: string;
  label: string;
  provider: string;
  displayName: string;
  secondaryName: string | null;
  runtimeOnly: boolean;
  disabled: boolean;
  writeToken: string;
  identityNames: string[];
}

export interface ModelColumn {
  id: string;
  provider: string;
  providers: string[];
  credentialNames: string[];
}

export interface ModelGroup {
  provider: string;
  columns: ModelColumn[];
}

export interface ModelCatalog {
  groups: ModelGroup[];
  ids: string[];
}
