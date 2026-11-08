import type { TFunction } from 'i18next';

export type ClientKeyErrorKind =
  | 'unsupported'
  | 'not_found'
  | 'forbidden'
  | 'name_exists'
  | 'last_client_key'
  | 'ambiguous_name'
  | 'invalid_ttl'
  | 'invalid_expiry'
  | 'invalid_body'
  | 'invalid_config'
  | 'connection_changed'
  | 'unknown';

export interface ClassifiedClientKeyError {
  kind: ClientKeyErrorKind;
  message: string;
}

const CONFLICT_CODES = new Set(['name_exists', 'last_client_key', 'ambiguous_name']);
const BAD_REQUEST_CODES = new Set([
  'invalid_ttl',
  'invalid_expiry',
  'invalid_body',
  'invalid_config',
]);

const readField = (error: unknown, field: string): unknown =>
  typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[field]
    : undefined;

const readMessage = (error: unknown): string => {
  const message = readField(error, 'message');
  if (typeof message === 'string') return message;
  return typeof error === 'string' ? error : '';
};

export function classifyClientKeyError(error: unknown): ClassifiedClientKeyError {
  const message = readMessage(error);
  if (readField(error, 'name') === 'AbortError') return { kind: 'connection_changed', message };
  const status = readField(error, 'status');
  const rawCode = readField(error, 'apiCode');
  const apiCode = typeof rawCode === 'string' && rawCode ? rawCode : null;
  if (status === 404) {
    if (apiCode === null) return { kind: 'unsupported', message };
    if (apiCode === 'not_found') return { kind: 'not_found', message };
  }
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 409 && apiCode && CONFLICT_CODES.has(apiCode)) {
    return { kind: apiCode as ClientKeyErrorKind, message };
  }
  if (status === 400 && apiCode && BAD_REQUEST_CODES.has(apiCode)) {
    return { kind: apiCode as ClientKeyErrorKind, message };
  }
  return { kind: 'unknown', message };
}

export function clientKeyErrorMessage(
  t: TFunction,
  classified: ClassifiedClientKeyError,
  params: Record<string, string> = {}
): string {
  return t(`client_keys.errors.${classified.kind}`, {
    ...params,
    message: classified.message || t('common.unknown_error'),
  });
}
