import { describe, expect, test } from 'bun:test';
import { classifyClientKeyError } from '../src/features/clientKeys/errors';
import type { ApiError } from '../src/types/api';

const apiError = (status: number, apiCode?: string, message = 'backend text'): ApiError => {
  const error = new Error(message) as ApiError;
  error.name = 'ApiError';
  error.status = status;
  error.apiCode = apiCode;
  return error;
};

describe('classifyClientKeyError', () => {
  test.each([
    [404, undefined, 'unsupported'],
    [404, 'not_found', 'not_found'],
    [403, undefined, 'forbidden'],
    [403, 'whatever', 'forbidden'],
    [409, 'name_exists', 'name_exists'],
    [409, 'last_client_key', 'last_client_key'],
    [409, 'ambiguous_name', 'ambiguous_name'],
    [400, 'invalid_ttl', 'invalid_ttl'],
    [400, 'invalid_expiry', 'invalid_expiry'],
    [400, 'invalid_body', 'invalid_body'],
    [400, 'invalid_config', 'invalid_config'],
    [500, 'write_failed', 'unknown'],
    [409, 'api_key_policies_present', 'unknown'],
  ] as const)('%p %p -> %p', (status, apiCode, kind) => {
    expect(classifyClientKeyError(apiError(status, apiCode))).toEqual({
      kind,
      message: 'backend text',
    });
  });

  test('an AbortError from the connection guard is connection_changed', () => {
    const error = new DOMException('The management connection changed.', 'AbortError');
    expect(classifyClientKeyError(error).kind).toBe('connection_changed');
  });

  test('non-API errors are unknown with their message', () => {
    expect(classifyClientKeyError(new Error('boom'))).toEqual({ kind: 'unknown', message: 'boom' });
    expect(classifyClientKeyError(null)).toEqual({ kind: 'unknown', message: '' });
  });
});
