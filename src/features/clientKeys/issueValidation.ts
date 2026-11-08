export const KEY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const DOTS_ONLY = /^\.+$/;

export type KeyNameError = 'required' | 'invalid' | 'dots' | 'taken';

export function isDotsOnlyName(name: string): boolean {
  return DOTS_ONLY.test(name);
}

export function validateKeyName(
  value: string,
  existingNames: ReadonlySet<string>
): KeyNameError | null {
  if (value === '') return 'required';
  if (!KEY_NAME_PATTERN.test(value)) return 'invalid';
  // Dot-only names are path segments the :name routes cannot address, so the key could never be
  // revoked or edited afterwards.
  if (isDotsOnlyName(value)) return 'dots';
  return existingNames.has(value) ? 'taken' : null;
}
