export const KEY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const DOTS_ONLY = /^\.+$/;
const GO_ATOI = /^[+-]?\d+$/;
const GO_MAX_INT = 2n ** 63n - 1n;

export type KeyNameError = 'required' | 'slash' | 'invalid' | 'dots' | 'numeric' | 'taken';

export function isDotsOnlyName(name: string): boolean {
  return DOTS_ONLY.test(name);
}

// The policy routes fall back to strconv.Atoi(name) as a list index when no key has that name,
// so once such a key is gone a stale write would land on whichever key now sits at that index.
export function isIndexLikeName(name: string): boolean {
  if (!GO_ATOI.test(name)) return false;
  const value = BigInt(name);
  return value >= 0n && value <= GO_MAX_INT;
}

export function hasPathSeparator(name: string): boolean {
  return name.includes('/');
}

export function validateKeyName(
  value: string,
  existingNames: ReadonlySet<string>
): KeyNameError | null {
  if (value === '') return 'required';
  if (hasPathSeparator(value)) return 'slash';
  if (!KEY_NAME_PATTERN.test(value)) return 'invalid';
  // Dot-only names are path segments the :name routes cannot address, so the key could never be
  // revoked or edited afterwards.
  if (isDotsOnlyName(value)) return 'dots';
  if (isIndexLikeName(value)) return 'numeric';
  return existingNames.has(value) ? 'taken' : null;
}
