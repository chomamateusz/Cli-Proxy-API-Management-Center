import { describe, expect, test } from 'bun:test';
import { KEY_NAME_PATTERN, validateKeyName } from '../src/features/clientKeys/issueValidation';

const existing = new Set(['Foo', 'mac-pro-m1']);

describe('validateKeyName', () => {
  test('requires a value', () => {
    expect(validateKeyName('', existing)).toBe('required');
  });

  test.each(['has space', 'slash/name', 'ünicode', 'a'.repeat(65), ' lead'])(
    '%p is invalid',
    (name) => {
      expect(validateKeyName(name, existing)).toBe('invalid');
    }
  );

  test('accepts 64 characters', () => {
    expect(validateKeyName('a'.repeat(64), existing)).toBeNull();
  });

  test.each(['.', '..', '...'])('%p is a dots-only name', (name) => {
    expect(validateKeyName(name, existing)).toBe('dots');
  });

  test('taken compares exact case only', () => {
    expect(validateKeyName('Foo', existing)).toBe('taken');
    expect(validateKeyName('foo', existing)).toBeNull();
  });

  test('pattern matches the backend regex', () => {
    expect(KEY_NAME_PATTERN.source).toBe('^[A-Za-z0-9._-]{1,64}$');
  });
});
